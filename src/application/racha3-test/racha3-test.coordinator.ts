import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { horaColombia } from '../../core/analytics/racha3-reference';
import {
  DOMAIN_EVENT_BUS,
  HISTORY_STORE,
  STRATEGIES,
} from '../../core/constants/injection-tokens.constants';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import type { DomainEventHandler } from '../../core/domain-events/base/domain-event-handler.interface';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import type { HistoryStore } from '../../core/interfaces/history-store.interface';
import { calcularRacha3TestScore } from '../../core/racha3-test/racha3-test-score.calculator';
import {
  Racha3TestSimulacion,
  RACHA3_TEST_MAX_MARTINGALAS,
} from '../../core/racha3-test/racha3-test-simulation';
import {
  Racha3TestEvaluacion,
  Racha3TestParametros,
  RACHA3_TEST_ID,
} from '../../core/racha3-test/types/racha3-test.type';
import type { Strategy } from '../../core/strategy/interfaces/strategy.interface';
import type { StrategyConfigProvider } from '../../core/strategy/interfaces/strategy-config-provider.interface';
import type { StrategyExecutionGuard } from '../../core/strategy/interfaces/strategy-execution-guard.interface';
import { createStrategyContext } from '../../core/strategy/types/strategy-context.type';
import type { StrategySignal } from '../../core/strategy/types/strategy-signal.type';
import { InMemoryStrategyRuntimeState } from '../strategy/in-memory-strategy-runtime-state';
import { Racha3TestDebugNotifier } from './racha3-test-debug.notifier';
import { Racha3TestEvidenceProvider } from './racha3-test.evidence-provider';
import { Racha3TestSimulationRegistry } from './racha3-test-simulation.registry';

/** Id de la estrategia real que se reutiliza SOLO para detectar la señal. */
const ESTRATEGIA_BASE_ID = 'streak-3';

export const RACHA3_TEST_DEFAULTS = {
  /** Límite inferior IC95 (Wilson) del histórico global al 2026-09-08. */
  umbralScore: 86.87,
  muestraMinima: 500,
  maxRezagoJugadas: 50,
} as const;

/**
 * Estrategia experimental Racha 3 Test.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ ES UN COORDINATOR Y NO UNA `Strategy`
 *
 * Dos razones independientes, las dos bloqueantes:
 *
 * 1. `Strategy.evaluate()` es SÍNCRONO y el `DomainEventBus` publica
 *    síncrono. No hay forma de esperar una consulta a PostgreSQL dentro de
 *    `evaluate()`, y esta estrategia necesita evidencia de Analytics.
 *
 * 2. `OperationCoordinator.onStrategyTriggered()` crea una `Operation` para
 *    CUALQUIER `StrategyTriggeredEvent`, sin filtrar por estrategia.
 *    Registrar `racha-3-test` en el token `STRATEGIES` habría creado
 *    operaciones REALES — exactamente lo que este experimento no debe hacer.
 *
 * Por eso se suscribe por su cuenta a `GameReceivedEvent`, igual que
 * `StrategyCoordinator` y `OperationCoordinator`, y NUNCA publica
 * `StrategyTriggeredEvent`.
 *
 * ─────────────────────────────────────────────────────────────────────
 * AISLAMIENTO RESPECTO DE `streak-3`
 *
 * La detección reutiliza la INSTANCIA REAL de `Streak3Strategy`, obtenida
 * del token `STRATEGIES` que `StrategyModule` ya exporta. No se duplica la
 * lógica: si alguien cambia cómo se detecta una racha, esta estrategia
 * cambia con ella y no queda describiendo un motor que ya no existe.
 *
 * Pero el CONTEXTO que se le pasa es completamente propio:
 *
 *   runtimeState  instancia nueva y privada. Es lo más delicado del diseño:
 *                 `StreakStrategyBase` guarda su anti-duplicación bajo la
 *                 clave `'streak-3'`, así que compartir el singleton habría
 *                 hecho que esta estrategia pisara el estado de la real y
 *                 le robara señales. Con instancia propia, cada una lleva su
 *                 propia cuenta.
 *   execution     guard propio, apoyado en la simulación virtual. Nunca
 *                 consulta `ActiveOperationRegistry`.
 *   config        `maxMartingales` fijo en 2. No lee
 *                 `StrategyChannelRegistry`, así que un override en runtime
 *                 sobre la estrategia real no perturba el experimento.
 *                 Cero estado mutable compartido.
 *
 * `historySnapshot` sí es común, y no puede ser de otra forma: es el
 * historial del juego. Es un snapshot inmutable, sólo lectura.
 *
 * ─────────────────────────────────────────────────────────────────────
 * QUÉ NO HACE
 *
 * No publica eventos de dominio, no crea `Operation` real, no toca el
 * registro de operaciones reales, no envía nada a los canales de
 * producción y no aparece en `GET /api/v1/strategies` (no está en
 * `STRATEGIES`). Arranca apagada: sin `RACHA3_TEST_ENABLED=true` no evalúa
 * ni una jugada.
 */
@Injectable()
export class Racha3TestCoordinator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Racha3Test');

  /** Estado de anti-duplicación PROPIO. Nunca el singleton compartido. */
  private readonly runtimeState = new InMemoryStrategyRuntimeState();

  private readonly execution: StrategyExecutionGuard = {
    canExecute: () => this.simulaciones.puedeEmitir(),
  };

  /** `maxMartingales` fijo: el experimento no debe moverse por la API. */
  private readonly config: StrategyConfigProvider = {
    getMaxMartingales: () => RACHA3_TEST_MAX_MARTINGALAS,
  };

  private readonly handler: DomainEventHandler<GameReceivedEvent> = {
    handle: (event) => this.onGameReceived(event),
  };

  private readonly parametros: Racha3TestParametros;
  private readonly habilitada: boolean;
  private estrategiaBase: Strategy | undefined;

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
    @Inject(HISTORY_STORE) private readonly historyStore: HistoryStore,
    @Inject(STRATEGIES) private readonly strategies: readonly Strategy[],
    private readonly simulaciones: Racha3TestSimulationRegistry,
    private readonly evidencia: Racha3TestEvidenceProvider,
    private readonly debug: Racha3TestDebugNotifier,
    configService: ConfigService,
  ) {
    this.habilitada = configService.get<boolean>('racha3Test.enabled', false);
    this.parametros = {
      umbralScore: configService.get<number>(
        'racha3Test.umbralScore',
        RACHA3_TEST_DEFAULTS.umbralScore,
      ),
      muestraMinima: configService.get<number>(
        'racha3Test.muestraMinima',
        RACHA3_TEST_DEFAULTS.muestraMinima,
      ),
      maxRezagoJugadas: configService.get<number>(
        'racha3Test.maxRezagoJugadas',
        RACHA3_TEST_DEFAULTS.maxRezagoJugadas,
      ),
    };
  }

  onModuleInit(): void {
    if (!this.habilitada) {
      this.logger.log(
        'Racha 3 Test DESHABILITADA (RACHA3_TEST_ENABLED). No se suscribe a nada.',
      );
      return;
    }

    this.estrategiaBase = this.strategies.find(
      (s) => s.id === ESTRATEGIA_BASE_ID,
    );

    if (this.estrategiaBase === undefined) {
      // Falla cerrado: sin la estrategia base no hay detección posible, y
      // reimplementarla acá sería justamente la duplicación que se evita.
      this.logger.error(
        `No se encontró la estrategia base "${ESTRATEGIA_BASE_ID}" en el token STRATEGIES. ` +
          'Racha 3 Test queda inactiva.',
      );
      return;
    }

    this.domainEventBus.subscribe(GameReceivedEvent.eventName, this.handler);
    this.logger.log(
      `Racha 3 Test ACTIVA (experimental, sin operaciones reales). ` +
        `umbral=${this.parametros.umbralScore} ` +
        `muestraMinima=${this.parametros.muestraMinima} ` +
        `maxRezago=${this.parametros.maxRezagoJugadas}`,
    );
  }

  onModuleDestroy(): void {
    this.domainEventBus.unsubscribe(GameReceivedEvent.eventName, this.handler);
  }

  /**
   * El orden importa y replica al motor real: `StrategyCoordinator` evalúa
   * la señal ANTES de que `OperationCoordinator` actualice las operaciones
   * con esa misma jugada. Por eso la jugada que cierra una operación todavía
   * ve el hueco ocupado. Invertir estos dos pasos cambiaría qué
   * oportunidades se consideran bloqueadas.
   */
  private onGameReceived(event: GameReceivedEvent): void {
    if (event.payload.isHistorical) {
      return;
    }

    const game = event.payload.game;
    const señal = this.detectar(game);
    this.actualizarSimulacion(game);

    if (señal === undefined) {
      // Sin oportunidad confirmada no se emite DEBUG: sería un mensaje por
      // jugada (~2.600 al día) para decir que no pasó nada.
      return;
    }

    // Reserva sincrónica del hueco: la evaluación que sigue es asíncrona y,
    // sin reservar, una segunda señal podría colarse durante la consulta a
    // Analytics y abrir dos simulaciones a la vez.
    this.simulaciones.reservar();
    void this.evaluar(señal, game);
  }

  private detectar(game: Game): StrategySignal | undefined {
    if (this.estrategiaBase === undefined) {
      return undefined;
    }

    const contexto = createStrategyContext(
      game,
      this.historyStore.createSnapshot(),
      this.execution,
      this.runtimeState,
      this.config,
      new Date(),
    );

    try {
      const resultado = this.estrategiaBase.evaluate(contexto);
      return resultado.triggered ? resultado : undefined;
    } catch (error) {
      this.logger.warn(
        `La detección de Racha 3 Test falló y se descarta esta jugada: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private actualizarSimulacion(game: Game): void {
    const resolucion = this.simulaciones.actualizar(game);

    if (resolucion === undefined) {
      return;
    }

    this.logger.log(
      `racha3_test_simulacion_resuelta evaluacionId=${resolucion.evaluacionId} ` +
        `resultado=${resolucion.resultado} jugadas=${resolucion.jugadasEvaluadas} ` +
        `ties=${resolucion.ties} score=${resolucion.score ?? 'n/d'}`,
    );
    this.debug.notificarResolucion(resolucion);
  }

  /**
   * Evaluación asíncrona: recolecta evidencia, calcula el score, decide y
   * notifica. Nunca lanza — un fallo acá no puede afectar al motor.
   */
  private async evaluar(señal: StrategySignal, game: Game): Promise<void> {
    const evaluacionId = randomUUID();
    const evaluadaEn = new Date();

    try {
      const hora = horaColombia(game.playedAt);
      const dia = diaSemanaColombia(game.playedAt);
      const longitud = longitudDeLaRacha(señal.reason);

      this.logger.log(
        `racha3_test_signal evaluacionId=${evaluacionId} ` +
          `triggerGameUuid=${game.uuid} tipoRacha=${señal.streakWinner} ` +
          `apuesta=${señal.recommendedWinner} horaColombia=${hora}`,
      );

      const recolectada = await this.evidencia.recolectar(
        señal.streakWinner,
        game.playedAt,
        hora,
        dia,
      );

      const score = calcularRacha3TestScore({
        evidencia: recolectada.evidencia,
        contexto: recolectada.contexto,
        estadoAnalytics: recolectada.estadoAnalytics,
        // La reserva propia no cuenta como operación abierta: el hueco lo
        // reservó esta misma evaluación.
        operacionVirtualAbierta: this.simulaciones.hayOperacionAbierta(),
        parametros: this.parametros,
      });

      this.logger.log(
        `racha3_test_score evaluacionId=${evaluacionId} score=${score.score ?? 'null'} ` +
          `umbral=${score.umbral} nivel=${score.nivel} ` +
          `muestraN=${score.componentes.muestra.muestraN} ` +
          `tasaObservada=${score.componentes.historico.tasaObservada?.toFixed(6) ?? 'n/d'} ` +
          `icInferior=${score.componentes.intervalo?.limiteInferior.toFixed(6) ?? 'n/d'} ` +
          `rezago=${recolectada.estadoAnalytics.jugadasSinProcesar}`,
      );

      const evaluacion: Racha3TestEvaluacion = {
        evaluacionId,
        evaluadaEn,
        strategy: RACHA3_TEST_ID,
        triggerGameUuid: game.uuid,
        triggerGameEn: game.playedAt,
        tipoRacha: señal.streakWinner,
        ganadorRacha: señal.streakWinner,
        apuestaSugerida: señal.recommendedWinner,
        longitudRacha: longitud,
        evidencia: recolectada.evidencia,
        estadoAnalytics: recolectada.estadoAnalytics,
        score,
        decision: score.tomar ? 'TOMAR' : 'NO_TOMAR',
      };

      this.logger.log(
        `racha3_test_decision evaluacionId=${evaluacionId} decision=${evaluacion.decision} ` +
          `gatesDisparados=[${score.gates
            .filter((g) => g.disparado)
            .map((g) => g.gate)
            .join(',')}]`,
      );

      if (score.tomar) {
        // Operación VIRTUAL. No es una apuesta y no pasa por
        // OperationCoordinator ni por ActiveOperationRegistry.
        this.simulaciones.abrir(
          new Racha3TestSimulacion(
            evaluacionId,
            señal.streakWinner,
            señal.recommendedWinner,
            game.uuid,
            score.score,
            evaluadaEn,
          ),
        );
      } else {
        // NO TOMAR no crea simulación: sólo observabilidad.
        this.simulaciones.liberarReserva();
      }

      this.logger.debug(
        `racha3_test_debug evaluacionId=${evaluacionId} enviando mensaje`,
      );
      this.debug.notificarEvaluacion(evaluacion);
    } catch (error) {
      // Cualquier fallo libera el hueco y NO abre simulación: un error nunca
      // puede terminar en una decisión favorable.
      this.simulaciones.liberarReserva();
      this.logger.error(
        `racha3_test_error evaluacionId=${evaluacionId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Día de la semana (0=domingo) en hora de Colombia.
 *
 * Se formatea la fecha EN la zona y se reconstruye a mediodía UTC, en vez de
 * usar `getDay()` sobre el instante: `getDay()` devolvería el día de la zona
 * de la máquina, que en un servidor puede no ser Bogotá.
 */
function diaSemanaColombia(instante: Date): number {
  const fecha = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);

  return new Date(`${fecha}T12:00:00Z`).getUTCDay();
}

/**
 * La longitud de la racha viaja dentro de `reason` ("Racha de N resultados
 * consecutivos de X"), que es lo único que expone `StrategySignal`. Se
 * extrae para el DEBUG; si el formato cambiara, se degrada a 3 (el mínimo
 * que define una Racha 3) en vez de fallar.
 */
function longitudDeLaRacha(reason: string): number {
  const m = /Racha de (\d+)/.exec(reason);
  return m === null ? 3 : Number.parseInt(m[1], 10);
}

/** Reexportado para los tests: el tipo `WinnerType` se usa en los fixtures. */
export type { WinnerType };
