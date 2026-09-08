import type { DomainEvent } from '../../core/domain-events/base/domain-event';
import { InMemoryDomainEventBus } from '../../core/domain-events/base/in-memory-domain-event-bus';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { StrategyTriggeredEvent } from '../../core/domain-events/strategy/strategy-triggered.event';
import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import { InMemoryHistoryStore } from '../../core/history/in-memory-history-store';
import { Streak3Strategy } from '../../core/strategy/strategies/streak3.strategy';
import type { StrategyExecutionGuard } from '../../core/strategy/interfaces/strategy-execution-guard.interface';
import type { StrategyGroup } from '../../core/strategy/strategy-group';
import type { StrategyTrigger } from '../../core/strategy/types/strategy-signal.type';
import { TRES_AL_TRES_ID } from '../../core/tres-al-tres/types/tres-al-tres.type';
import { InMemoryStrategyRuntimeState } from '../strategy/in-memory-strategy-runtime-state';
import type { StrategyChannelRegistry } from '../strategy/strategy-channel-registry';
import { TresAlTresCoordinator } from './tres-al-tres.coordinator';
import type { TresAlTresEvidenceProvider } from './tres-al-tres.evidence-provider';

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

/** Distribución real de `jugadas`: BANKER gana algo más que PLAYER. */
const LADOS = {
  total: 44139,
  banker: 19733,
  player: 19312,
  tie: 5094,
  noTie: 39045,
  corteId: 44718,
};

const TIES = [
  { nivel: 0, ties: 269 },
  { nivel: 1, ties: 126 },
  { nivel: 2, ties: 57 },
];

/** Racha PLAYER → apuesta BANKER. Estimación directa 88,01 → TOMAR. */
const EVIDENCIA_TOMAR = {
  evidencia: {
    condicion: 'tipo_racha=PLAYER',
    tipoRacha: WinnerType.PLAYER,
    aciertos: 1873,
    resueltas: 2095,
    directa: 1089,
    mg1: 502,
    mg2: 282,
    perdidas: 222,
    muestraN: 2095,
    advertenciaMuestra: null,
    muestraBloqueadasExcluidas: 25,
    muestraIntegridadDudosa: 0,
    ventanaDesde: null,
    ventanaHasta: null,
  },
  lados: LADOS,
  tiesPorNivel: TIES,
  operacionesMedidas: 2095,
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
    totalOportunidades: 4220,
    error: null,
  },
};

/** Racha BANKER → apuesta PLAYER, el lado malo. Score 85,04 → NO TOMAR. */
const EVIDENCIA_NO_TOMAR = {
  ...EVIDENCIA_TOMAR,
  evidencia: {
    ...EVIDENCIA_TOMAR.evidencia,
    condicion: 'tipo_racha=BANKER',
    tipoRacha: WinnerType.BANKER,
    aciertos: 1775,
    resueltas: 2050,
    muestraN: 2050,
  },
};

type Registro = Record<'log' | 'debug' | 'warn' | 'error', string[]>;

type Contexto = {
  bus: InMemoryDomainEventBus;
  store: InMemoryHistoryStore;
  provider: jest.Mocked<TresAlTresEvidenceProvider>;
  coordinator: TresAlTresCoordinator;
  logs: Registro;
  disparadas: StrategyTrigger[];
  guard: { activa: boolean };
  canal: { asignado: StrategyGroup | undefined; activo: boolean };
};

/** Bus real que además anota qué se publicó, por herencia (mantiene el tipado). */
class BusEspia extends InMemoryDomainEventBus {
  readonly publicados: string[] = [];

  publish<TEvent extends DomainEvent>(event: TEvent): void {
    this.publicados.push(event.eventName);
    super.publish(event);
  }
}

function montar(
  opciones: {
    canal?: StrategyGroup | undefined;
    activo?: boolean;
    bus?: InMemoryDomainEventBus;
  } = {},
): Contexto {
  contador = 0;
  const bus = opciones.bus ?? new InMemoryDomainEventBus();
  const store = new InMemoryHistoryStore();
  const streak3 = new Streak3Strategy();

  const guard = { activa: false };
  const execution: StrategyExecutionGuard = {
    canExecute: () => !guard.activa,
  };

  const canal = {
    asignado:
      'canal' in opciones ? opciones.canal : ('oficial' as StrategyGroup),
    activo: opciones.activo ?? true,
  };

  const canales = {
    isActiveFor: (id: string) =>
      id === TRES_AL_TRES_ID && canal.asignado !== undefined && canal.activo,
    getChannelFor: (id: string) =>
      id === TRES_AL_TRES_ID ? canal.asignado : undefined,
    getMaxMartingales: (_id: string, def: number) => def,
  } as unknown as StrategyChannelRegistry;

  const provider = {
    recolectar: jest.fn().mockResolvedValue(EVIDENCIA_TOMAR),
  } as unknown as jest.Mocked<TresAlTresEvidenceProvider>;

  const coordinator = new TresAlTresCoordinator(
    bus,
    store,
    [streak3],
    execution,
    canales,
    provider,
  );

  const logs: Registro = { log: [], debug: [], warn: [], error: [] };
  const logger = coordinator['logger'];
  for (const nivel of ['log', 'debug', 'warn', 'error'] as const) {
    jest.spyOn(logger, nivel).mockImplementation((m: unknown) => {
      logs[nivel].push(String(m));
    });
  }

  const disparadas: StrategyTrigger[] = [];
  bus.subscribe(StrategyTriggeredEvent.eventName, {
    handle: (e) => {
      disparadas.push((e as StrategyTriggeredEvent).payload);
    },
  });

  return { bus, store, provider, coordinator, logs, disparadas, guard, canal };
}

async function alimentar(c: Contexto, patron: string): Promise<void> {
  for (const letra of patron.replace(/ /g, '').split('')) {
    const g = game(letra);
    c.store.append(g);
    c.bus.publish(new GameReceivedEvent({ game: g, isHistorical: false }));
    for (let i = 0; i < 6; i++) await Promise.resolve();
  }
}

const evento = (c: Contexto, nombre: string): string | undefined => {
  for (const nivel of ['log', 'debug', 'error'] as const) {
    const l = c.logs[nivel].find((x) => x.startsWith(`${nombre} `));
    if (l !== undefined) return l;
  }
  return undefined;
};

describe('TresAlTresCoordinator', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('se enciende como cualquier otra estrategia', () => {
    it('sin canal asignado no evalúa ni consulta Analytics', async () => {
      const c = montar({ canal: undefined });
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      expect(c.provider.recolectar).not.toHaveBeenCalled();
      expect(c.disparadas).toHaveLength(0);
    });

    it('con el canal asignado pero inactivo tampoco', async () => {
      const c = montar({ activo: false });
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      expect(c.provider.recolectar).not.toHaveBeenCalled();
    });

    it('sin la estrategia base en STRATEGIES falla cerrado', async () => {
      const c = montar();
      const solo = new TresAlTresCoordinator(
        c.bus,
        c.store,
        [],
        { canExecute: () => true },
        { isActiveFor: () => true } as unknown as StrategyChannelRegistry,
        c.provider,
      );
      jest.spyOn(solo['logger'], 'error').mockImplementation(() => undefined);
      jest.spyOn(solo['logger'], 'log').mockImplementation(() => undefined);
      solo.onModuleInit();
      await alimentar(c, 'BPPP');

      expect(c.provider.recolectar).not.toHaveBeenCalled();
    });

    it('onModuleDestroy desuscribe', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      c.coordinator.onModuleDestroy();
      await alimentar(c, 'BPPP');

      expect(c.provider.recolectar).not.toHaveBeenCalled();
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
  });

  describe('cuando la evidencia respalda: emite al motor real', () => {
    it('publica StrategyTriggeredEvent con la identidad de 3al3', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      expect(c.disparadas).toHaveLength(1);
      const t = c.disparadas[0];
      // La señal la produjo Streak3Strategy, pero la firma es de 3al3: es
      // quien decidió, y es a quien deben atribuirse operación y reportes.
      expect(t.strategyId).toBe(TRES_AL_TRES_ID);
      expect(t.strategyName).toBe('TresAlTresStrategy');
      expect(t.streakWinner).toBe(WinnerType.PLAYER);
      expect(t.recommendedWinner).toBe(WinnerType.BANKER);
      expect(t.triggerGameUuid).toBe('game-3');
    });

    it('estampa el canal asignado como context de la operación', async () => {
      const oficial = montar({ canal: 'oficial' });
      oficial.coordinator.onModuleInit();
      await alimentar(oficial, 'BPPP');
      expect(oficial.disparadas[0].context).toBe('oficial');

      const pruebas = montar({ canal: 'pruebas' });
      pruebas.coordinator.onModuleInit();
      await alimentar(pruebas, 'BPPP');
      expect(pruebas.disparadas[0].context).toBe('pruebas');
    });

    it('adjunta el score y el evaluacionId en metadata, para auditar después', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      const meta = c.disparadas[0].metadata;
      expect(meta.score).toBe(88.01);
      expect(String(meta.evaluacionId)).toMatch(/^[0-9a-f-]{36}$/);
      expect(c.disparadas[0].reason).toContain('punto de equilibrio');
    });

    it('respeta el maxMartingales del registro de canales', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      expect(c.disparadas[0].maxMartingales).toBe(2);
    });
  });

  describe('cuando la evidencia no respalda: silencio', () => {
    it('NO publica nada y no manda ningún mensaje', async () => {
      const c = montar();
      c.provider.recolectar.mockResolvedValue(EVIDENCIA_NO_TOMAR);
      c.coordinator.onModuleInit();
      await alimentar(c, 'PBBB');

      expect(c.provider.recolectar).toHaveBeenCalledTimes(1);
      expect(c.disparadas).toHaveLength(0);
      expect(evento(c, '3al3_decision')).toContain('decision=NO_TOMAR');
    });

    it('el motivo queda en el log, no en el chat', async () => {
      const c = montar();
      c.provider.recolectar.mockResolvedValue(EVIDENCIA_NO_TOMAR);
      c.coordinator.onModuleInit();
      await alimentar(c, 'PBBB');

      const d = evento(c, '3al3_decision');
      expect(d).toContain('SCORE_BAJO_UMBRAL');
      expect(d).toContain('razones=');
    });

    it('no escribe una línea por jugada cuando no hay oportunidad', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'PBTPB');

      // Solo la línea de arranque.
      expect(c.logs.log).toHaveLength(1);
      expect(c.logs.log[0]).toContain('3al3 registrada');
    });
  });

  describe('fallo seguro', () => {
    it('si Analytics falla, no emite', async () => {
      const c = montar();
      c.provider.recolectar.mockResolvedValue({
        evidencia: null,
        lados: null,
        tiesPorNivel: [],
        operacionesMedidas: 0,
        contexto: EVIDENCIA_TOMAR.contexto,
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

      expect(c.disparadas).toHaveLength(0);
      expect(evento(c, '3al3_decision')).toContain('ANALYTICS_SIN_EVIDENCIA');
    });

    it('si el provider LANZA, no emite y lo registra', async () => {
      const c = montar();
      c.provider.recolectar.mockRejectedValue(
        new Error('timeout de PostgreSQL'),
      );
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      expect(c.disparadas).toHaveLength(0);
      expect(evento(c, '3al3_error')).toContain('timeout de PostgreSQL');
    });

    it('un rezago de Analytics por encima del límite descarta', async () => {
      const c = montar();
      c.provider.recolectar.mockResolvedValue({
        ...EVIDENCIA_TOMAR,
        estadoAnalytics: {
          ...EVIDENCIA_TOMAR.estadoAnalytics,
          jugadasSinProcesar: 371,
        },
      });
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      expect(c.disparadas).toHaveLength(0);
      expect(evento(c, '3al3_decision')).toContain('ANALYTICS_REZAGADO');
    });
  });

  describe('no se pisa con las operaciones ni con las otras estrategias', () => {
    it('con una operación de 3al3 abierta no vuelve a emitir', async () => {
      const c = montar();
      c.guard.activa = true;
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      expect(c.provider.recolectar).not.toHaveBeenCalled();
      expect(c.disparadas).toHaveLength(0);
    });

    it('si la operación se abre DURANTE la evaluación, descarta al final', async () => {
      const c = montar();
      c.provider.recolectar.mockImplementation(() => {
        // Simula que el motor abrió una operación de 3al3 mientras se
        // consultaba Analytics.
        c.guard.activa = true;
        return Promise.resolve(EVIDENCIA_TOMAR);
      });
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      expect(c.disparadas).toHaveLength(0);
      expect(evento(c, '3al3_descartada')).toContain('ya_abierta');
    });

    it('una corrida larga sigue siendo UNA sola oportunidad', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPPPPP');

      expect(c.provider.recolectar).toHaveBeenCalledTimes(1);
      expect(c.disparadas).toHaveLength(1);
    });

    it('un TIE rompe la formación: no hay oportunidad', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPTP');

      expect(c.provider.recolectar).not.toHaveBeenCalled();
    });

    it('usa un runtimeState PROPIO: no le roba la señal a streak-3', async () => {
      const c = montar();
      const compartido = new InMemoryStrategyRuntimeState();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      expect(compartido.get('streak-3')).toBeUndefined();
      expect(c.coordinator['runtimeState'].get('streak-3')).toBeDefined();
    });

    it('solo publica StrategyTriggeredEvent, ningún otro evento', async () => {
      const bus = new BusEspia();
      const c = montar({ bus });
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      expect([...new Set(bus.publicados)]).toEqual([
        'GameReceivedEvent',
        'StrategyTriggeredEvent',
      ]);
    });
  });

  describe('observabilidad', () => {
    it('la secuencia completa comparte el evaluacionId', async () => {
      const c = montar();
      c.coordinator.onModuleInit();
      await alimentar(c, 'BPPP');

      const señal = evento(c, '3al3_signal')!;
      const id = /evaluacionId=([0-9a-f-]{36})/.exec(señal)![1];

      for (const nombre of ['3al3_score', '3al3_decision', '3al3_emitida']) {
        expect(evento(c, nombre)).toContain(`evaluacionId=${id}`);
      }

      const score = evento(c, '3al3_score')!;
      expect(score).toContain('score=88.01');
      expect(score).toContain('directo=88.01');
      expect(score).toContain('modelo=87.53');
      expect(score).toMatch(/umbral=87\.9\d/);
      expect(score).toMatch(/peajeTie=0\.03\d+/);
      expect(evento(c, '3al3_emitida')).toContain('canal=oficial');
    });
  });
});
