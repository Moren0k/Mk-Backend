import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RACHA3_PROCESSOR } from '../../core/constants/injection-tokens.constants';
import type { Racha3Processor } from '../../core/analytics/interfaces/racha3-processor.interface';
import type { Racha3RunResult } from '../../core/analytics/types/racha3-run.type';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';

/** Default si `ANALYTICS_INTERVAL_MS` no está definida: 60 segundos. */
export const DEFAULT_ANALYTICS_INTERVAL_MS = 60_000;

/**
 * Fallos de transporte consecutivos antes de escalar de `warn` a `error`.
 *
 * Supabase corta la conexión del pooler de forma esporádica (se observaron
 * siete cortes aislados en una sola sesión de trabajo), y cada corte se
 * recupera solo en el tick siguiente. Gritar en el primero llenaría el log
 * de ruido y volvería inútil el canal de errores justo cuando haga falta.
 * Con 5 fallos seguidos a un tick por minuto, escalar significa "hace cinco
 * minutos que no se puede procesar": eso ya no es un hipo.
 */
export const FALLOS_TRANSITORIOS_ANTES_DE_ESCALAR = 5;

/** Tope de caracteres del detalle de error que se lleva al log. */
const MAX_DETALLE = 200;

/**
 * Condensa un error en una línea informativa y acotada.
 *
 * No sirve `message.split('\n')[0]`: Prisma antepone líneas en blanco a sus
 * mensajes (`"\nInvalid `$queryRawUnsafe()` invocation:\n\n\nCan't reach
 * database server..."`), así que la primera línea es vacía y el log terminaba
 * mostrando un detalle en blanco — justo cuando el detalle es lo único que
 * importa. Se descartan las líneas vacías y se conservan las dos primeras
 * con contenido, que es donde Prisma pone la causa real.
 */
function resumirError(error: unknown): string {
  const mensaje = error instanceof Error ? error.message : String(error);
  const lineas = mensaje
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0);

  if (lineas.length === 0) {
    return 'sin detalle';
  }

  return lineas.slice(0, 2).join(' ').slice(0, MAX_DETALLE);
}

/**
 * Dispara `analytics_racha3_incremental()` cada cierto intervalo.
 *
 * Es un temporizador, nada más. NO contiene lógica analítica: no sabe qué
 * es una columna, ni una racha, ni una martingala. Toda la reconstrucción
 * vive en las funciones plpgsql y se verifica aparte contra la
 * implementación de referencia en TypeScript (`pnpm analytics:verify`).
 * Ese límite es intencional: si esta clase empezara a decidir algo sobre el
 * dominio, esa decisión quedaría fuera del alcance de la verificación
 * cruzada.
 *
 * Igual que `ReportCheckpointScheduler`, el intervalo es puramente técnico
 * ("cada tanto, sea la hora que sea"), así que un `setInterval` alcanza y no
 * hace falta alinear contra ningún límite de reloj.
 *
 * Sí implementa `OnModuleInit`, a diferencia de `GameEventCollector`: aquel
 * no puede arrancar solo porque depende de que TODOS los subscribers del
 * DomainEventBus ya estén suscritos, y el orden de los `onModuleInit` entre
 * módulos no es confiable. Este scheduler no toca el bus ni el motor de
 * alertas: su única dependencia es la conexión a Postgres, que se resuelve
 * de forma perezosa en cada tick. No hay ninguna carrera que evitar.
 *
 * Garantías que ofrece:
 *
 *  - **Nunca tumba el proceso.** Ningún desenlace de un tick propaga una
 *    excepción fuera de `runTick`.
 *  - **Un tick fallido nunca detiene el scheduler.** El `setInterval` sigue
 *    vivo pase lo que pase; el tick siguiente vuelve a intentar.
 *  - **Sin solapamiento.** Si un tick todavía corre cuando llega el
 *    siguiente, el nuevo se saltea. El SQL además toma
 *    `pg_advisory_xact_lock(42, 3)`, que cubre el solapamiento ENTRE
 *    procesos; esta bandera cubre el de DENTRO del proceso, que el lock no
 *    puede ver.
 *  - **Silencio cuando no pasa nada.** Una corrida sin jugadas nuevas no
 *    escribe nada en la base y solo deja rastro en `debug`.
 */
@Injectable()
export class Racha3IncrementalScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(Racha3IncrementalScheduler.name);

  private timer: NodeJS.Timeout | undefined;
  private ejecutando = false;
  private fallosTransitoriosSeguidos = 0;
  private yaEscalo = false;
  private avisoNoDisponible = false;

  constructor(
    @Inject(RACHA3_PROCESSOR) private readonly processor: Racha3Processor,
    private readonly errorTracker: EngineErrorTracker,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.configService.get<number>(
      'analytics.intervalMs',
      DEFAULT_ANALYTICS_INTERVAL_MS,
    );

    this.timer = setInterval(() => {
      void this.runTick();
    }, intervalMs);

    this.logger.log(
      `Procesamiento incremental de Racha 3 programado cada ${intervalMs / 1000}s.`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Un tick completo. Público para poder dispararlo desde una prueba o,
   * más adelante, desde un endpoint de administración, sin depender del
   * temporizador. Nunca lanza.
   */
  async runTick(): Promise<void> {
    if (this.ejecutando) {
      // Con un tick de 60 s y corridas de decenas de milisegundos esto no
      // debería pasar nunca; si pasa, es señal de que la base está lenta y
      // el tick siguiente ya lo va a reintentar igual.
      this.logger.debug('Tick omitido: el anterior todavía está corriendo.');
      return;
    }

    this.ejecutando = true;
    const iniciadoEn = Date.now();

    try {
      const resultado = await this.processor.procesarIncremental();
      this.reportar(resultado, Date.now() - iniciadoEn);
      this.fallosTransitoriosSeguidos = 0;
      this.yaEscalo = false;
    } catch (error) {
      this.manejarFalloDeTransporte(error, Date.now() - iniciadoEn);
    } finally {
      this.ejecutando = false;
    }
  }

  private reportar(resultado: Racha3RunResult, latenciaMs: number): void {
    if (resultado.tipo === 'NO_DISPONIBLE') {
      // Una sola vez: es un estado de configuración, no un incidente, y
      // repetirlo cada minuto solo ensucia el log.
      if (!this.avisoNoDisponible) {
        this.avisoNoDisponible = true;
        this.logger.warn(
          `Analytics de Racha 3 inactivo: ${resultado.motivo} El motor de alertas no se ve afectado.`,
        );
      }
      return;
    }

    this.avisoNoDisponible = false;

    if (resultado.tipo === 'ERROR_PROCESO') {
      // La función corrió y abortó su propio trabajo. No es red: es un
      // problema real de dominio (p. ej. una inserción retroactiva que
      // invalida el orden por id y exige un rebuild).
      const mensaje =
        `El procesamiento incremental de Racha 3 falló (ejecución ${resultado.ejecucionId}): ` +
        resultado.error;
      this.logger.error(mensaje);
      this.errorTracker.recordError(mensaje);
      return;
    }

    if (!resultado.huboCambios) {
      this.logger.debug(
        `Sin jugadas nuevas: nada que procesar (${latenciaMs} ms).`,
      );
      return;
    }

    void this.registrarCorridaProductiva(resultado, latenciaMs);
  }

  /**
   * Log estructurado de una corrida que sí movió datos. La lectura del
   * checkpoint es solo para observabilidad y va deliberadamente fuera del
   * camino crítico: si falla, la corrida sigue siendo un éxito.
   */
  private async registrarCorridaProductiva(
    resultado: Extract<Racha3RunResult, { tipo: 'OK' }>,
    latenciaMs: number,
  ): Promise<void> {
    const checkpoint = await this.processor.leerCheckpoint();

    this.logger.log(
      `Racha 3 procesada: ejecucion=${resultado.ejecucionId} ` +
        `rango=${resultado.desdeJugadaId}..${resultado.hastaJugadaId} ` +
        `jugadas=${resultado.jugadasLeidas} ` +
        `columnas=${resultado.columnasAfectadas} ` +
        `operaciones=${resultado.operacionesAfectadas} ` +
        `sql=${resultado.duracionMs}ms total=${latenciaMs}ms ` +
        `checkpoint=${checkpoint?.ultimaJugadaId ?? '?'} ` +
        `rebobinado=${checkpoint?.reprocesoDesdeJugadaId ?? '?'}`,
    );
  }

  /**
   * Fallo de transporte: la llamada ni siquiera llegó a devolver una fila.
   * Se tolera en silencio relativo (`warn`) mientras sea esporádico, y
   * recién se escala a `error` cuando deja de serlo. El checkpoint no puede
   * corromperse por esto: la función SQL corre en una única transacción, así
   * que un corte de conexión revierte todo su trabajo.
   */
  private manejarFalloDeTransporte(error: unknown, latenciaMs: number): void {
    this.fallosTransitoriosSeguidos += 1;
    const detalle = resumirError(error);

    if (
      this.fallosTransitoriosSeguidos < FALLOS_TRANSITORIOS_ANTES_DE_ESCALAR
    ) {
      this.logger.warn(
        `Tick de Racha 3 sin completar (fallo ${this.fallosTransitoriosSeguidos}, ` +
          `${latenciaMs} ms): ${detalle}. Se reintenta en el próximo tick.`,
      );
      return;
    }

    if (!this.yaEscalo) {
      this.yaEscalo = true;
      const mensaje =
        `El procesamiento incremental de Racha 3 lleva ${this.fallosTransitoriosSeguidos} ` +
        `intentos seguidos sin poder alcanzar la base: ${detalle}`;
      this.logger.error(mensaje);
      this.errorTracker.recordError(mensaje);
      return;
    }

    // Ya se gritó una vez: mientras siga caído, no se repite el error.
    this.logger.warn(
      `Racha 3 sigue sin poder procesarse (${this.fallosTransitoriosSeguidos} intentos): ${detalle}`,
    );
  }
}
