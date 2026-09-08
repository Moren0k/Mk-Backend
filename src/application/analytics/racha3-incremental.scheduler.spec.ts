import { ConfigService } from '@nestjs/config';

import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import type { Racha3Processor } from '../../core/analytics/interfaces/racha3-processor.interface';
import type { Racha3RunResult } from '../../core/analytics/types/racha3-run.type';
import {
  DEFAULT_ANALYTICS_INTERVAL_MS,
  FALLOS_TRANSITORIOS_ANTES_DE_ESCALAR,
  Racha3IncrementalScheduler,
} from './racha3-incremental.scheduler';

const INTERVALO = DEFAULT_ANALYTICS_INTERVAL_MS;

/** Corrida que sí movió datos. */
const productiva = (ejecucionId = 1n): Racha3RunResult => ({
  tipo: 'OK',
  ejecucionId,
  desdeJugadaId: 100n,
  hastaJugadaId: 110n,
  jugadasLeidas: 11,
  columnasAfectadas: 6,
  operacionesAfectadas: 1,
  duracionMs: 87,
  huboCambios: true,
});

/** Corrida sin jugadas nuevas: no-op absoluto. */
const noOp = (ejecucionId = 2n): Racha3RunResult => ({
  tipo: 'OK',
  ejecucionId,
  desdeJugadaId: null,
  hastaJugadaId: 110n,
  jugadasLeidas: 0,
  columnasAfectadas: 0,
  operacionesAfectadas: 0,
  duracionMs: 0,
  huboCambios: false,
});

const errorDeProceso = (
  error = 'Inserción retroactiva detectada',
): Racha3RunResult => ({
  tipo: 'ERROR_PROCESO',
  ejecucionId: 3n,
  error,
  duracionMs: 12,
});

const falloDeRed = () =>
  new Error(
    "Can't reach database server at `aws-0-us-east-1.pooler.supabase.com:5432`\ndetalle irrelevante",
  );

describe('Racha3IncrementalScheduler', () => {
  let processor: jest.Mocked<Racha3Processor>;
  let errorTracker: EngineErrorTracker;
  let scheduler: Racha3IncrementalScheduler;
  let logs: { nivel: string; mensaje: string }[];

  const crear = (intervalMs: number = INTERVALO) => {
    const configService = {
      get: jest.fn().mockReturnValue(intervalMs),
    } as unknown as ConfigService;

    const s = new Racha3IncrementalScheduler(
      processor,
      errorTracker,
      configService,
    );

    // Se captura el logger real en vez de silenciarlo: la política de
    // ruido (qué se grita, qué se susurra y qué no se dice) es justamente
    // lo que hay que verificar.
    logs = [];
    for (const nivel of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(s['logger'], nivel).mockImplementation((mensaje: unknown) => {
        logs.push({ nivel, mensaje: String(mensaje) });
      });
    }
    return s;
  };

  const niveles = (nivel: string) => logs.filter((l) => l.nivel === nivel);

  beforeEach(() => {
    jest.useFakeTimers();
    processor = {
      procesarIncremental: jest.fn(),
      leerCheckpoint: jest.fn().mockResolvedValue({
        ultimaJugadaId: 110n,
        reprocesoDesdeJugadaId: 105n,
        actualizadoEn: new Date(),
      }),
    };
    errorTracker = new EngineErrorTracker();
    scheduler = crear();
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('ciclo de vida', () => {
    it('no dispara ningún tick antes de arrancar', () => {
      jest.advanceTimersByTime(INTERVALO * 3);
      expect(processor.procesarIncremental).not.toHaveBeenCalled();
    });

    it('dispara un tick por intervalo una vez arrancado', async () => {
      processor.procesarIncremental.mockResolvedValue(noOp());
      scheduler.onModuleInit();

      for (let i = 0; i < 3; i++) {
        jest.advanceTimersByTime(INTERVALO);
        await Promise.resolve();
      }

      expect(processor.procesarIncremental).toHaveBeenCalledTimes(3);
    });

    it('onModuleDestroy detiene el intervalo y no quedan ticks pendientes', async () => {
      processor.procesarIncremental.mockResolvedValue(noOp());
      scheduler.onModuleInit();

      jest.advanceTimersByTime(INTERVALO);
      await Promise.resolve();
      expect(processor.procesarIncremental).toHaveBeenCalledTimes(1);

      scheduler.onModuleDestroy();
      jest.advanceTimersByTime(INTERVALO * 5);
      await Promise.resolve();

      expect(processor.procesarIncremental).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('onModuleDestroy es idempotente', () => {
      scheduler.onModuleInit();
      scheduler.onModuleDestroy();
      expect(() => scheduler.onModuleDestroy()).not.toThrow();
    });

    it('respeta el intervalo configurado', async () => {
      processor.procesarIncremental.mockResolvedValue(noOp());
      scheduler = crear(5_000);
      scheduler.onModuleInit();

      jest.advanceTimersByTime(4_999);
      await Promise.resolve();
      expect(processor.procesarIncremental).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await Promise.resolve();
      expect(processor.procesarIncremental).toHaveBeenCalledTimes(1);
    });
  });

  describe('desenlaces de un tick', () => {
    it('una corrida productiva se registra con su rango, filas y checkpoint', async () => {
      processor.procesarIncremental.mockResolvedValue(productiva());

      await scheduler.runTick();

      const [linea] = niveles('log');
      expect(linea.mensaje).toContain('rango=100..110');
      expect(linea.mensaje).toContain('jugadas=11');
      expect(linea.mensaje).toContain('columnas=6');
      expect(linea.mensaje).toContain('operaciones=1');
      expect(linea.mensaje).toContain('checkpoint=110');
      expect(linea.mensaje).toContain('rebobinado=105');
      expect(errorTracker.getLastError()).toBeUndefined();
    });

    it('una corrida sin jugadas nuevas no ensucia el log ni registra error', async () => {
      processor.procesarIncremental.mockResolvedValue(noOp());

      await scheduler.runTick();

      expect(niveles('log')).toHaveLength(0);
      expect(niveles('warn')).toHaveLength(0);
      expect(niveles('error')).toHaveLength(0);
      expect(niveles('debug')).toHaveLength(1);
      // Un no-op ni siquiera consulta el checkpoint.
      expect(processor.leerCheckpoint).not.toHaveBeenCalled();
      expect(errorTracker.getLastError()).toBeUndefined();
    });

    it('un fallo de dominio se grita de inmediato y queda en el error tracker', async () => {
      processor.procesarIncremental.mockResolvedValue(errorDeProceso());

      await scheduler.runTick();

      expect(niveles('error')).toHaveLength(1);
      expect(niveles('error')[0].mensaje).toContain(
        'Inserción retroactiva detectada',
      );
      expect(errorTracker.getLastError()?.message).toContain(
        'Inserción retroactiva detectada',
      );
    });

    it('la persistencia deshabilitada avisa una sola vez, no en cada tick', async () => {
      processor.procesarIncremental.mockResolvedValue({
        tipo: 'NO_DISPONIBLE',
        motivo: 'DATABASE_URL ausente.',
      });

      for (let i = 0; i < 5; i++) await scheduler.runTick();

      expect(niveles('warn')).toHaveLength(1);
      expect(niveles('error')).toHaveLength(0);
      // No es un incidente del motor: nunca debe aparecer en /healthz.
      expect(errorTracker.getLastError()).toBeUndefined();
    });
  });

  describe('tolerancia a fallos transitorios del pooler', () => {
    it('los primeros fallos se susurran, sin tocar el error tracker', async () => {
      processor.procesarIncremental.mockRejectedValue(falloDeRed());

      for (let i = 0; i < FALLOS_TRANSITORIOS_ANTES_DE_ESCALAR - 1; i++) {
        await scheduler.runTick();
      }

      expect(niveles('warn')).toHaveLength(
        FALLOS_TRANSITORIOS_ANTES_DE_ESCALAR - 1,
      );
      expect(niveles('error')).toHaveLength(0);
      expect(errorTracker.getLastError()).toBeUndefined();
    });

    it('escala a error al alcanzar el umbral, y una sola vez', async () => {
      processor.procesarIncremental.mockRejectedValue(falloDeRed());

      for (let i = 0; i < FALLOS_TRANSITORIOS_ANTES_DE_ESCALAR + 4; i++) {
        await scheduler.runTick();
      }

      expect(niveles('error')).toHaveLength(1);
      expect(errorTracker.getLastError()?.message).toContain(
        'intentos seguidos',
      );
      // Mientras sigue caído no vuelve a gritar: solo susurra.
      expect(niveles('warn').length).toBeGreaterThan(0);
    });

    it('conserva la causa real aunque el mensaje empiece con líneas en blanco', async () => {
      // Forma EXACTA de un PrismaClientInitializationError: la primera línea
      // es vacía, así que quedarse con `split("\n")[0]` dejaba el log sin
      // ningún detalle (verificado contra la base real durante F5).
      processor.procesarIncremental.mockRejectedValue(
        new Error(
          '\nInvalid `prisma.$queryRawUnsafe()` invocation:\n\n\n' +
            "Can't reach database server at `aws-0-us-east-1.pooler.supabase.com:5432`\n\n" +
            'Please make sure your database server is running.',
        ),
      );

      await scheduler.runTick();

      const [aviso] = niveles('warn');
      expect(aviso.mensaje).toContain("Can't reach database server");
      expect(aviso.mensaje).not.toContain('): .');
    });

    it('tolera un error sin mensaje utilizable sin dejar el log en blanco', async () => {
      processor.procesarIncremental.mockRejectedValue(new Error('\n\n  \n'));

      await scheduler.runTick();

      expect(niveles('warn')[0].mensaje).toContain('sin detalle');
    });

    it('el contador se reinicia tras una corrida exitosa', async () => {
      processor.procesarIncremental.mockRejectedValue(falloDeRed());
      for (let i = 0; i < FALLOS_TRANSITORIOS_ANTES_DE_ESCALAR + 1; i++) {
        await scheduler.runTick();
      }
      expect(niveles('error')).toHaveLength(1);

      processor.procesarIncremental.mockResolvedValue(productiva());
      await scheduler.runTick();

      // Vuelve a caerse: como ya se recuperó en el medio, arranca de cero y
      // no grita hasta volver a acumular el umbral completo.
      processor.procesarIncremental.mockRejectedValue(falloDeRed());
      for (let i = 0; i < FALLOS_TRANSITORIOS_ANTES_DE_ESCALAR - 1; i++) {
        await scheduler.runTick();
      }
      expect(niveles('error')).toHaveLength(1);

      await scheduler.runTick();
      expect(niveles('error')).toHaveLength(2);
    });

    it('un tick que lanza nunca propaga la excepción', async () => {
      processor.procesarIncremental.mockRejectedValue(falloDeRed());
      await expect(scheduler.runTick()).resolves.toBeUndefined();
    });

    it('un fallo al leer el checkpoint no invalida una corrida exitosa', async () => {
      processor.procesarIncremental.mockResolvedValue(productiva());
      processor.leerCheckpoint.mockResolvedValue(undefined);

      await scheduler.runTick();

      expect(niveles('error')).toHaveLength(0);
      expect(niveles('log')[0].mensaje).toContain('checkpoint=?');
    });
  });

  describe('solapamiento', () => {
    it('omite el tick si el anterior sigue corriendo', async () => {
      let resolver: (v: Racha3RunResult) => void = () => {};
      processor.procesarIncremental.mockImplementation(
        () => new Promise<Racha3RunResult>((r) => (resolver = r)),
      );

      const primero = scheduler.runTick();
      await Promise.resolve();

      await scheduler.runTick();
      await scheduler.runTick();
      expect(processor.procesarIncremental).toHaveBeenCalledTimes(1);

      resolver(noOp());
      await primero;

      // Liberado el anterior, el siguiente tick vuelve a entrar.
      processor.procesarIncremental.mockResolvedValue(noOp());
      await scheduler.runTick();
      expect(processor.procesarIncremental).toHaveBeenCalledTimes(2);
    });

    it('la bandera se libera aunque el tick falle', async () => {
      processor.procesarIncremental.mockRejectedValue(falloDeRed());
      await scheduler.runTick();

      processor.procesarIncremental.mockResolvedValue(noOp());
      await scheduler.runTick();

      expect(processor.procesarIncremental).toHaveBeenCalledTimes(2);
    });
  });

  describe('secuencia completa: arranque -> tick -> caida -> recuperacion -> apagado', () => {
    it('el scheduler sobrevive a la caída y sigue procesando después', async () => {
      const avanzar = async () => {
        jest.advanceTimersByTime(INTERVALO);
        // Dos vueltas de microtareas: la del propio tick y la del
        // `leerCheckpoint` que dispara una corrida productiva.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      };

      // 1. arranque
      processor.procesarIncremental.mockResolvedValue(productiva(10n));
      scheduler.onModuleInit();

      // 2. tick productivo
      await avanzar();
      expect(
        niveles('log').filter((l) => l.mensaje.includes('Racha 3 procesada')),
      ).toHaveLength(1);

      // 3. la base se cae durante varios ticks
      processor.procesarIncremental.mockRejectedValue(falloDeRed());
      for (let i = 0; i < FALLOS_TRANSITORIOS_ANTES_DE_ESCALAR; i++)
        await avanzar();
      expect(niveles('error')).toHaveLength(1);
      expect(errorTracker.getLastError()).toBeDefined();

      // 4. recuperación: el intervalo nunca se perdió
      processor.procesarIncremental.mockResolvedValue(productiva(11n));
      await avanzar();
      expect(
        niveles('log').filter((l) => l.mensaje.includes('Racha 3 procesada')),
      ).toHaveLength(2);

      // 5. siguiente tick exitoso, ya en régimen normal
      processor.procesarIncremental.mockResolvedValue(noOp(12n));
      await avanzar();

      // El scheduler siguió vivo todo el tiempo: 1 + 5 + 1 + 1 llamadas.
      expect(processor.procesarIncremental).toHaveBeenCalledTimes(
        2 + FALLOS_TRANSITORIOS_ANTES_DE_ESCALAR + 1,
      );

      // 6. apagado limpio
      scheduler.onModuleDestroy();
      const llamadasAlApagar = processor.procesarIncremental.mock.calls.length;
      jest.advanceTimersByTime(INTERVALO * 10);
      await Promise.resolve();

      expect(processor.procesarIncremental).toHaveBeenCalledTimes(
        llamadasAlApagar,
      );
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
