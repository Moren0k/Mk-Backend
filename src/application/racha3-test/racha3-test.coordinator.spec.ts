import { ConfigService } from '@nestjs/config';

import type { DomainEvent } from '../../core/domain-events/base/domain-event';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { InMemoryDomainEventBus } from '../../core/domain-events/base/in-memory-domain-event-bus';
import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import { InMemoryHistoryStore } from '../../core/history/in-memory-history-store';
import { Streak3Strategy } from '../../core/strategy/strategies/streak3.strategy';
import { InMemoryStrategyRuntimeState } from '../strategy/in-memory-strategy-runtime-state';
import { Racha3TestCoordinator } from './racha3-test.coordinator';
import { Racha3TestDebugNotifier } from './racha3-test-debug.notifier';
import { Racha3TestEvidenceProvider } from './racha3-test.evidence-provider';
import { Racha3TestSimulationRegistry } from './racha3-test-simulation.registry';

const LETRA: Readonly<Record<string, WinnerType>> = {
  P: WinnerType.PLAYER,
  B: WinnerType.BANKER,
  T: WinnerType.TIE,
};

const INICIO = new Date('2026-09-01T15:00:00.000Z');
let contador = 0;

function game(letra: string): Game {
  const i = contador++;
  return {
    uuid: `game-${i}`,
    winner: LETRA[letra],
    score: 0,
    playedAt: new Date(INICIO.getTime() + i * 33_000),
  };
}

/** Evidencia de PLAYER con score 87.83 (sobre el umbral 86.87). */
const EVIDENCIA_BUENA = {
  evidencia: {
    condicion: 'tipo_racha=PLAYER',
    tipoRacha: WinnerType.PLAYER,
    aciertos: 1802,
    resueltas: 2019,
    directa: 1048,
    mg1: 483,
    mg2: 271,
    perdidas: 217,
    muestraN: 2019,
    advertenciaMuestra: null,
    muestraBloqueadasExcluidas: 25,
    muestraIntegridadDudosa: 0,
    ventanaDesde: null,
    ventanaHasta: null,
  },
  contexto: {
    horaColombia: 10,
    diaSemana: 2,
    distanciaActual: 7,
    distanciaExacta: true,
    bucketDistancia: '6-10',
    hazardBucket: 0.1326,
    frecuenciaHistoricaBucket: 0.3819,
    columnaConCortePorGap: null,
  },
  estadoAnalytics: {
    disponible: true,
    checkpointExiste: true,
    jugadasSinProcesar: 1,
    totalOportunidades: 4119,
    error: null,
  },
};

/** Evidencia de BANKER con score 85.04 (bajo el umbral). */
const EVIDENCIA_BAJA = {
  ...EVIDENCIA_BUENA,
  evidencia: {
    ...EVIDENCIA_BUENA.evidencia,
    condicion: 'tipo_racha=BANKER',
    tipoRacha: WinnerType.BANKER,
    aciertos: 1775,
    resueltas: 2050,
    muestraN: 2050,
  },
};

type Contexto = {
  bus: InMemoryDomainEventBus;
  store: InMemoryHistoryStore;
  registry: Racha3TestSimulationRegistry;
  provider: jest.Mocked<Racha3TestEvidenceProvider>;
  notifier: jest.Mocked<Racha3TestDebugNotifier>;
  streak3: Streak3Strategy;
  coordinator: Racha3TestCoordinator;
  logs: Registro;
};

/** Líneas capturadas por nivel. */
type Registro = Record<'log' | 'debug' | 'warn' | 'error', string[]>;

/**
 * Bus real que además anota qué se publicó. Se usa por herencia en vez de
 * un `jest.spyOn` sobre `publish` para no perder el tipado del método
 * genérico al reenviar al original.
 */
class BusEspia extends InMemoryDomainEventBus {
  readonly publicados: string[] = [];

  publish<TEvent extends DomainEvent>(event: TEvent): void {
    this.publicados.push(event.eventName);
    super.publish(event);
  }
}

function montar(
  opciones: {
    enabled?: boolean;
    umbral?: number;
    bus?: InMemoryDomainEventBus;
  } = {},
): Contexto {
  contador = 0;
  const bus = opciones.bus ?? new InMemoryDomainEventBus();
  const store = new InMemoryHistoryStore();
  const registry = new Racha3TestSimulationRegistry();
  const streak3 = new Streak3Strategy();

  const provider = {
    recolectar: jest.fn().mockResolvedValue(EVIDENCIA_BUENA),
  } as unknown as jest.Mocked<Racha3TestEvidenceProvider>;

  const notifier = {
    notificarEvaluacion: jest.fn(),
    notificarResolucion: jest.fn(),
  } as unknown as jest.Mocked<Racha3TestDebugNotifier>;

  const config = {
    get: jest.fn((clave: string, def?: unknown) => {
      if (clave === 'racha3Test.enabled') return opciones.enabled ?? true;
      if (clave === 'racha3Test.umbralScore') return opciones.umbral ?? 86.87;
      if (clave === 'racha3Test.muestraMinima') return 500;
      if (clave === 'racha3Test.maxRezagoJugadas') return 50;
      return def;
    }),
  } as unknown as ConfigService;

  const coordinator = new Racha3TestCoordinator(
    bus,
    store,
    [streak3],
    registry,
    provider,
    notifier,
    config,
  );

  const logs = capturarLogs(coordinator);

  return {
    bus,
    store,
    registry,
    provider,
    notifier,
    streak3,
    coordinator,
    logs,
  };
}

/**
 * Silencia el logger y guarda lo que escribió, por nivel. Se capturan las
 * líneas en vez de inspeccionar `mock.calls` porque la firma de
 * `Logger.log` es `(message: any, ...)` y leerla de ahí propagaría `any`.
 */
function capturarLogs(coordinator: Racha3TestCoordinator): Registro {
  const registro: Registro = { log: [], debug: [], warn: [], error: [] };
  const logger = coordinator['logger'];

  const espiar = (nivel: keyof Registro): void => {
    jest.spyOn(logger, nivel).mockImplementation((mensaje: unknown) => {
      registro[nivel].push(String(mensaje));
    });
  };

  espiar('log');
  espiar('debug');
  espiar('warn');
  espiar('error');

  return registro;
}

/** Todas las líneas que el coordinator escribió en un nivel dado. */
function lineas(c: Contexto, nivel: keyof Registro): string[] {
  return c.logs[nivel];
}

/** La primera línea que empieza por el evento estructurado pedido. */
function evento(c: Contexto, nombre: string): string | undefined {
  for (const nivel of ['log', 'debug', 'error'] as const) {
    const encontrada = lineas(c, nivel).find((l) => l.startsWith(`${nombre} `));
    if (encontrada !== undefined) return encontrada;
  }
  return undefined;
}

/** Publica un patrón de jugadas como eventos en vivo y espera las microtareas. */
async function alimentar(c: Contexto, patron: string): Promise<void> {
  for (const letra of patron.replace(/ /g, '').split('')) {
    const g = game(letra);
    c.store.append(g);
    c.bus.publish(new GameReceivedEvent({ game: g, isHistorical: false }));
    // Deja correr la evaluación asíncrona (recolectar + score + notificar).
    for (let i = 0; i < 6; i++) await Promise.resolve();
  }
}

describe('Racha3TestCoordinator', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('ciclo de vida y encendido', () => {
    it('deshabilitada no se suscribe a nada', async () => {
      const c = montar({ enabled: false });
      c.coordinator.onModuleInit();
      await alimentar(c, 'PPP');
      expect(c.provider.recolectar).not.toHaveBeenCalled();
      expect(c.notifier.notificarEvaluacion).not.toHaveBeenCalled();
    });

    it('sin la estrategia base en STRATEGIES falla cerrado', async () => {
      const c = montar();
      // Se monta sin streak-3 disponible.
      const coordinator = new Racha3TestCoordinator(
        c.bus,
        c.store,
        [],
        c.registry,
        c.provider,
        c.notifier,
        { get: jest.fn(() => true) } as unknown as ConfigService,
      );
      jest
        .spyOn(coordinator['logger'], 'error')
        .mockImplementation(() => undefined);
      jest
        .spyOn(coordinator['logger'], 'log')
        .mockImplementation(() => undefined);
      coordinator.onModuleInit();
      await alimentar(c, 'PPP');
      expect(c.provider.recolectar).not.toHaveBeenCalled();
    });

    it('onModuleDestroy desuscribe', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      c.coordinator.onModuleDestroy();
      await alimentar(c, 'PPP');
      expect(c.provider.recolectar).not.toHaveBeenCalled();
    });
  });

  describe('detección', () => {
    it('una racha PLAYER de 3 dispara UNA evaluación y sugiere BANKER', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      expect(c.provider.recolectar).toHaveBeenCalledTimes(1);
      expect(c.provider.recolectar.mock.calls[0][0]).toBe(WinnerType.PLAYER);

      const ev = c.notifier.notificarEvaluacion.mock.calls[0][0];
      expect(ev.tipoRacha).toBe(WinnerType.PLAYER);
      expect(ev.apuestaSugerida).toBe(WinnerType.BANKER);
      expect(ev.decision).toBe('TOMAR');
    });

    it('una racha BANKER sugiere PLAYER', async () => {
      const c = montar();
      c.provider.recolectar.mockResolvedValue(EVIDENCIA_BAJA);
      c.coordinator.onModuleInit();
      await alimentar(c, 'PBBB');

      expect(c.provider.recolectar.mock.calls[0][0]).toBe(WinnerType.BANKER);
      const ev = c.notifier.notificarEvaluacion.mock.calls[0][0];
      expect(ev.apuestaSugerida).toBe(WinnerType.PLAYER);
    });

    it('un TIE rompe la formación: no hay oportunidad', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPTP');
      expect(c.provider.recolectar).not.toHaveBeenCalled();
    });

    it('una corrida larga sigue siendo UNA sola oportunidad', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPPPPP');
      expect(c.provider.recolectar).toHaveBeenCalledTimes(1);
    });

    it('ignora las jugadas históricas', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      for (const l of 'PPP') {
        const g = game(l);
        c.store.append(g);
        c.bus.publish(new GameReceivedEvent({ game: g, isHistorical: true }));
        await Promise.resolve();
      }
      expect(c.provider.recolectar).not.toHaveBeenCalled();
    });

    it('no emite DEBUG cuando no hay oportunidad (evita un mensaje por jugada)', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'PBTPB');
      expect(c.notifier.notificarEvaluacion).not.toHaveBeenCalled();
    });
  });

  describe('decisión y simulación', () => {
    it('TOMAR abre una operación VIRTUAL', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');
      expect(c.registry.hayOperacionAbierta()).toBe(true);
    });

    it('NO TOMAR no crea ninguna simulación', async () => {
      const c = montar();
      c.provider.recolectar.mockResolvedValue(EVIDENCIA_BAJA);
      c.coordinator.onModuleInit();
      await alimentar(c, 'PBBB');

      const ev = c.notifier.notificarEvaluacion.mock.calls[0][0];
      expect(ev.decision).toBe('NO_TOMAR');
      expect(c.registry.hayOperacionAbierta()).toBe(false);
      expect(c.registry.estadoActual().evaluacionEnCurso).toBe(false);
    });

    it('la simulación se resuelve y notifica el resultado', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      // PPP dispara; la B siguiente gana la directa.
      await alimentar(c, 'BPPPB');

      expect(c.notifier.notificarResolucion).toHaveBeenCalledTimes(1);
      const r = c.notifier.notificarResolucion.mock.calls[0][0];
      expect(r.resultado).toBe('DIRECTA');
      expect(c.registry.hayOperacionAbierta()).toBe(false);
    });

    it('mientras la simulación está abierta, no se emite otra señal', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      // PPP dispara y abre simulación; T rompe la racha; PPP volvería a
      // formar una, pero la simulación previa sigue abierta (el TIE no la
      // cierra).
      await alimentar(c, 'BPPPTPPP');
      expect(c.provider.recolectar).toHaveBeenCalledTimes(1);
    });
  });

  describe('fallo seguro', () => {
    it('si Analytics falla, NO TOMAR y sin simulación', async () => {
      const c = montar();
      c.provider.recolectar.mockResolvedValue({
        evidencia: null,
        contexto: EVIDENCIA_BUENA.contexto,
        estadoAnalytics: {
          disponible: false,
          checkpointExiste: false,
          jugadasSinProcesar: 0,
          totalOportunidades: 0,
          error: "Can't reach database server",
        },
      });
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      const ev = c.notifier.notificarEvaluacion.mock.calls[0][0];
      expect(ev.decision).toBe('NO_TOMAR');
      expect(ev.score.score).toBeNull();
      expect(c.registry.hayOperacionAbierta()).toBe(false);
    });

    it('si el provider LANZA, no abre simulación y libera la reserva', async () => {
      const c = montar();
      c.provider.recolectar.mockRejectedValue(
        new Error('timeout de PostgreSQL'),
      );
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      expect(c.registry.hayOperacionAbierta()).toBe(false);
      expect(c.registry.estadoActual().evaluacionEnCurso).toBe(false);
      expect(c.notifier.notificarEvaluacion).not.toHaveBeenCalled();
    });

    it('un rezago de Analytics por encima del límite descarta', async () => {
      const c = montar();
      c.provider.recolectar.mockResolvedValue({
        ...EVIDENCIA_BUENA,
        estadoAnalytics: {
          ...EVIDENCIA_BUENA.estadoAnalytics,
          jugadasSinProcesar: 371,
        },
      });
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      const ev = c.notifier.notificarEvaluacion.mock.calls[0][0];
      expect(ev.decision).toBe('NO_TOMAR');
      expect(
        ev.score.gates.find((g) => g.gate === 'ANALYTICS_REZAGADO')?.disparado,
      ).toBe(true);
      expect(c.registry.hayOperacionAbierta()).toBe(false);
    });
  });

  describe('trazabilidad del DEBUG', () => {
    it('la evaluación lleva todos los campos exigidos', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      const ev = c.notifier.notificarEvaluacion.mock.calls[0][0];
      expect(ev.evaluacionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(ev.strategy).toBe('racha-3-test');
      expect(ev.triggerGameUuid).toBe('game-3');
      expect(ev.longitudRacha).toBe(3);
      expect(ev.evaluadaEn).toBeInstanceOf(Date);
      expect(ev.score.traza.length).toBeGreaterThan(5);
      expect(ev.score.componentes.contexto.peso).toBe(0);
      expect(ev.score.componentes.contexto.horaColombia).toBe(10);
      expect(ev.estadoAnalytics.jugadasSinProcesar).toBe(1);
    });

    it('el score en el DEBUG es reproducible con la traza', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      const s = c.notifier.notificarEvaluacion.mock.calls[0][0].score;
      expect(s.score).toBe(87.83);
      expect(s.componentes.historico.aciertos).toBe(1802);
      expect(s.componentes.historico.resueltas).toBe(2019);
      expect(100 * (s.componentes.intervalo?.limiteInferior ?? 0)).toBeCloseTo(
        87.83,
        2,
      );
    });
  });

  describe('logs estructurados (F9.13)', () => {
    it('una decisión TOMAR emite la secuencia completa con el mismo id', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      const señal = evento(c, 'racha3_test_signal');
      const score = evento(c, 'racha3_test_score');
      const decision = evento(c, 'racha3_test_decision');
      const debug = evento(c, 'racha3_test_debug');

      for (const linea of [señal, score, decision, debug]) {
        expect(linea).toBeDefined();
      }

      // El evaluacionId es el id de correlación: une las cuatro líneas de la
      // misma oportunidad, y después la línea de la resolución.
      const id = /evaluacionId=([0-9a-f-]{36})/.exec(señal!)![1];
      for (const linea of [score, decision, debug]) {
        expect(linea).toContain(`evaluacionId=${id}`);
      }

      expect(señal).toContain('tipoRacha=PLAYER');
      expect(señal).toContain('apuesta=BANKER');
      expect(señal).toContain('triggerGameUuid=game-3');
      expect(señal).toMatch(/horaColombia=\d+/);

      // El score trae la cadena verificable a mano: conteos → tasa → IC.
      expect(score).toContain('score=87.83');
      expect(score).toContain('umbral=86.87');
      expect(score).toContain('nivel=SOBRE_UMBRAL');
      expect(score).toContain('muestraN=2019');
      expect(score).toMatch(/tasaObservada=0\.892\d+/);
      // 0,878258 → ×100 → 87,8258 → redondeado a 87,83. La cadena queda
      // verificable a mano desde el log.
      expect(score).toMatch(/icInferior=0\.87825\d/);
      expect(score).toContain('rezago=1');

      expect(decision).toContain('decision=TOMAR');
      expect(decision).toContain('gatesDisparados=[]');
    });

    it('la resolución de la simulación cierra la correlación', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPPB');

      const id = /evaluacionId=([0-9a-f-]{36})/.exec(
        evento(c, 'racha3_test_signal')!,
      )![1];
      const resuelta = evento(c, 'racha3_test_simulacion_resuelta');

      expect(resuelta).toContain(`evaluacionId=${id}`);
      expect(resuelta).toContain('resultado=DIRECTA');
      expect(resuelta).toContain('jugadas=1');
      expect(resuelta).toContain('ties=0');
      expect(resuelta).toContain('score=87.83');
    });

    it('un NO TOMAR nombra el gate que lo descartó', async () => {
      const c = montar();
      c.provider.recolectar.mockResolvedValue(EVIDENCIA_BAJA);
      c.coordinator.onModuleInit();
      await alimentar(c, 'PBBB');

      const decision = evento(c, 'racha3_test_decision');
      expect(decision).toContain('decision=NO_TOMAR');
      expect(decision).toContain('gatesDisparados=[SCORE_BAJO_UMBRAL]');
      expect(evento(c, 'racha3_test_score')).toContain('nivel=BAJO_UMBRAL');
    });

    it('un fallo emite racha3_test_error con el id, no una decisión', async () => {
      const c = montar();
      c.provider.recolectar.mockRejectedValue(
        new Error('timeout de PostgreSQL'),
      );
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      const error = evento(c, 'racha3_test_error');
      expect(error).toMatch(/evaluacionId=[0-9a-f-]{36}/);
      expect(error).toContain('timeout de PostgreSQL');
      expect(evento(c, 'racha3_test_decision')).toBeUndefined();
    });

    it('no escribe una línea por jugada cuando no hay oportunidad', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'PBTPB');

      // Solo la línea de arranque de onModuleInit.
      expect(lineas(c, 'log')).toHaveLength(1);
      expect(lineas(c, 'log')[0]).toContain('Racha 3 Test ACTIVA');
    });
  });

  describe('AISLAMIENTO respecto de streak-3 (producción)', () => {
    it('NO publica StrategyTriggeredEvent: OperationCoordinator nunca ve una señal suya', async () => {
      const c = montar();
      const espia = { handle: jest.fn() };
      c.bus.subscribe('StrategyTriggeredEvent', espia);
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      expect(c.notifier.notificarEvaluacion).toHaveBeenCalledTimes(1);
      expect(espia.handle).not.toHaveBeenCalled();
    });

    it('no publica NINGÚN evento de dominio', async () => {
      const bus = new BusEspia();
      const c = montar({ bus });
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPPB');

      // Solo los GameReceivedEvent que publica la propia prueba.
      expect([...new Set(bus.publicados)]).toEqual(['GameReceivedEvent']);
    });

    it('usa un runtimeState PROPIO: no pisa el estado de la estrategia real', async () => {
      const c = montar();
      const compartido = new InMemoryStrategyRuntimeState();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      // El singleton que usaría StrategyCoordinator sigue virgen: si el
      // coordinator experimental lo hubiera usado, tendría la clave escrita
      // y la estrategia real habría perdido su próxima señal.
      expect(compartido.get('streak-3')).toBeUndefined();
      expect(c.coordinator['runtimeState'].get('streak-3')).toBeDefined();
      expect(c.coordinator['runtimeState']).not.toBe(compartido);
    });

    it('su guard no consulta el registro de operaciones reales', () => {
      const c = montar();
      // El guard del coordinator se apoya solo en su registry virtual.
      expect(c.coordinator['execution'].canExecute('streak-3')).toBe(true);
      c.registry.reservar();
      expect(c.coordinator['execution'].canExecute('streak-3')).toBe(false);
    });

    it('su maxMartingales es fijo en 2 y no lee configuración mutable', () => {
      const c = montar();
      expect(c.coordinator['config'].getMaxMartingales('streak-3', 99)).toBe(2);
    });

    it('la estrategia real sigue detectando igual con su propio estado', () => {
      // Se corre Streak3Strategy con un runtimeState independiente sobre el
      // mismo historial y debe seguir detectando la racha: la instancia es
      // compartida, pero no guarda estado interno.
      const c = montar();
      c.coordinator.onModuleInit();

      for (const l of 'BPPP') {
        c.store.append(game(l));
      }

      const propio = new InMemoryStrategyRuntimeState();
      const resultado = c.streak3.evaluate({
        currentGame: c.store.getLatest()!,
        historySnapshot: c.store.createSnapshot(),
        execution: { canExecute: () => true },
        runtimeState: propio,
        config: { getMaxMartingales: (_id, def) => def },
        timestamp: new Date(),
      });

      expect(resultado.triggered).toBe(true);
      expect(c.streak3.id).toBe('streak-3');
    });
  });
});
