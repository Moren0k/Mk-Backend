import { Logger } from '@nestjs/common';

import { EngineMetricsService } from '../application/observability/engine-metrics.service';
import { StatisticsService } from '../application/statistics/statistics.service';
import { DistributionMetric } from '../application/metrics/distribution.metric';
import { MessageTracker } from '../application/notification/message-tracker';
import { NotificationCoordinator } from '../application/notification/notification.coordinator';
import { ActiveOperationRegistry } from '../application/operation/active-operation-registry';
import { OperationCoordinator } from '../application/operation/operation.coordinator';
import { InMemoryStrategyRuntimeState } from '../application/strategy/in-memory-strategy-runtime-state';
import { StrategyChannelRegistry } from '../application/strategy/strategy-channel-registry';
import { StrategyCoordinator } from '../application/strategy/strategy.coordinator';
import { DomainEvent } from '../core/domain-events/base/domain-event';
import { DomainEventHandler } from '../core/domain-events/base/domain-event-handler.interface';
import { InMemoryDomainEventBus } from '../core/domain-events/base/in-memory-domain-event-bus';
import { GameReceivedEvent } from '../core/domain-events/game/game-received.event';
import { NotificationFailedEvent } from '../core/domain-events/notification/notification-failed.event';
import { NotificationSentEvent } from '../core/domain-events/notification/notification-sent.event';
import { MartingaleOneReachedEvent } from '../core/domain-events/operation/martingale-one-reached.event';
import { MartingaleTwoReachedEvent } from '../core/domain-events/operation/martingale-two-reached.event';
import { OperationLostEvent } from '../core/domain-events/operation/operation-lost.event';
import { OperationOpenedEvent } from '../core/domain-events/operation/operation-opened.event';
import { OperationTieOccurredEvent } from '../core/domain-events/operation/operation-tie-occurred.event';
import { OperationWonEvent } from '../core/domain-events/operation/operation-won.event';
import { StrategyTriggeredEvent } from '../core/domain-events/strategy/strategy-triggered.event';
import { NotificationChannelType } from '../core/enums/notification-channel-type.enum';
import { OperationState } from '../core/enums/operation-state.enum';
import { WinnerType } from '../core/enums/winner-type.enum';
import { Game } from '../core/history/game.type';
import { InMemoryHistoryStore } from '../core/history/in-memory-history-store';
import { NotificationChannel } from '../core/interfaces/notification-channel.interface';
import { NotificationFactory } from '../core/notification/notification.factory';
import { Notification } from '../core/notification/notification.type';
import type { SendResult } from '../core/notification/types/send-result.type';
import { EngineErrorTracker } from '../core/observability/engine-error-tracker';
import { Streak4Strategy } from '../core/strategy/strategies/streak4.strategy';

/**
 * Prueba end-to-end del pipeline completo, SIN la API real: en vez de
 * GameEventCollector, este test hace exactamente lo que él haría
 * (`historyStore.append(game)` + `publish(new GameReceivedEvent(game))`)
 * para cada partida simulada, y deja correr el sistema real (Strategy,
 * Operation, Notification, Statistics, EngineMetrics) sobre un
 * DomainEventBus real. El único doble es el NotificationChannel (evita
 * tocar Telegram).
 */

function buildGame(uuid: string, winner: WinnerType): Game {
  return {
    uuid,
    winner,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

class FakeNotificationChannel implements NotificationChannel {
  readonly sent: Notification[] = [];
  readonly deleted: number[] = [];

  getChannelType(): NotificationChannelType {
    return NotificationChannelType.TELEGRAM;
  }

  name(): string {
    return 'FakeChannel';
  }

  enabled(): boolean {
    return true;
  }

  supports(): boolean {
    return true;
  }

  send(notification: Notification): Promise<SendResult> {
    this.sent.push(notification);
    return Promise.resolve({
      delivered: true,
      messageId: this.sent.length,
    });
  }

  deleteMessage(messageId: number): Promise<boolean> {
    this.deleted.push(messageId);
    return Promise.resolve(true);
  }
}

type Engine = {
  readonly historyStore: InMemoryHistoryStore;
  readonly domainEventBus: InMemoryDomainEventBus;
  readonly operationCoordinator: OperationCoordinator;
  readonly statisticsService: StatisticsService;
  readonly engineMetricsService: EngineMetricsService;
  readonly channel: FakeNotificationChannel;
  readonly publishedEvents: DomainEvent[];
};

function buildEngine(): Engine {
  const historyStore = new InMemoryHistoryStore();
  const domainEventBus = new InMemoryDomainEventBus();
  const errorTracker = new EngineErrorTracker();
  const activeOperationRegistry = new ActiveOperationRegistry();
  const strategyRuntimeState = new InMemoryStrategyRuntimeState();
  const strategyChannelRegistry = new StrategyChannelRegistry(
    activeOperationRegistry,
  );
  // Por default (2026-08-11) ninguna estrategia está asignada a ningún
  // canal: hay que configurarlo explícitamente, igual que haría un
  // operador real vía PATCH /api/v1/channels/oficial antes de operar.
  strategyChannelRegistry.assignStrategyToChannel('streak-4', 'oficial');
  strategyChannelRegistry.setActive('oficial', true);

  const strategyCoordinator = new StrategyCoordinator(
    historyStore,
    domainEventBus,
    [new Streak4Strategy()],
    errorTracker,
    activeOperationRegistry,
    strategyRuntimeState,
    strategyChannelRegistry,
  );
  const operationCoordinator = new OperationCoordinator(
    domainEventBus,
    errorTracker,
    activeOperationRegistry,
  );
  const channel = new FakeNotificationChannel();
  const distributionMetric = new DistributionMetric(historyStore);
  const messageTracker = new MessageTracker();
  const notificationCoordinator = new NotificationCoordinator(
    domainEventBus,
    [channel],
    new NotificationFactory(),
    errorTracker,
    distributionMetric,
    messageTracker,
  );
  const statisticsService = new StatisticsService(domainEventBus);
  const engineMetricsService = new EngineMetricsService(domainEventBus);

  // El recorder se suscribe ANTES que los coordinadores reales, para cada
  // tipo de evento: así refleja el orden real en que se llama a
  // `publish()`, y no se ve afectado por que un subscriber posterior
  // (p.ej. OperationCoordinator reaccionando a StrategyTriggeredEvent)
  // publique de forma síncrona un evento anidado antes de que el recorder
  // reciba su turno como subscriber tardío de ese mismo evento.
  const publishedEvents: DomainEvent[] = [];
  const recorder: DomainEventHandler = {
    handle: (event) => publishedEvents.push(event),
  };
  for (const eventName of [
    StrategyTriggeredEvent.eventName,
    OperationOpenedEvent.eventName,
    MartingaleOneReachedEvent.eventName,
    MartingaleTwoReachedEvent.eventName,
    OperationWonEvent.eventName,
    OperationLostEvent.eventName,
    OperationTieOccurredEvent.eventName,
    NotificationSentEvent.eventName,
    NotificationFailedEvent.eventName,
  ]) {
    domainEventBus.subscribe(eventName, recorder);
  }

  strategyCoordinator.onModuleInit();
  operationCoordinator.onModuleInit();
  notificationCoordinator.onModuleInit();
  statisticsService.onModuleInit();
  engineMetricsService.onModuleInit();

  return {
    historyStore,
    domainEventBus,
    operationCoordinator,
    statisticsService,
    engineMetricsService,
    channel,
    publishedEvents,
  };
}

/** Deja correr cualquier `.then()` pendiente (p.ej. el envío de Telegram). */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function feedGame(
  engine: Engine,
  game: Game,
  isHistorical = false,
): Promise<void> {
  engine.historyStore.append(game);
  engine.domainEventBus.publish(new GameReceivedEvent({ game, isHistorical }));
  await flushAsync();
}

describe('Full pipeline (e2e, no real API)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('streak -> signal -> operation -> MG1 -> MG2 -> victory, with every event in order', async () => {
    const engine = buildEngine();

    // Historia inicial (ruido, sin racha) + la racha de 4 (Streak4Strategy)
    // que dispara la señal.
    await feedGame(engine, buildGame('1', WinnerType.TIE));
    await feedGame(engine, buildGame('2', WinnerType.TIE));
    await feedGame(engine, buildGame('3', WinnerType.PLAYER));
    await feedGame(engine, buildGame('4', WinnerType.PLAYER));
    await feedGame(engine, buildGame('5', WinnerType.PLAYER));
    await feedGame(engine, buildGame('6', WinnerType.PLAYER)); // dispara la señal

    // Un TIE entre cada jugada real evita que Streak4Strategy vuelva a
    // disparar sobre las mismas 4 últimas PLAYER (ver comentario en la
    // etapa 8 sobre por qué se intercalan).
    await feedGame(engine, buildGame('7', WinnerType.TIE));
    await feedGame(engine, buildGame('8', WinnerType.PLAYER)); // MG1
    await feedGame(engine, buildGame('9', WinnerType.TIE));
    await feedGame(engine, buildGame('10', WinnerType.PLAYER)); // MG2
    await feedGame(engine, buildGame('11', WinnerType.TIE));
    await feedGame(engine, buildGame('12', WinnerType.BANKER)); // victoria

    expect(engine.publishedEvents.map((e) => e.eventName)).toEqual([
      StrategyTriggeredEvent.eventName,
      OperationOpenedEvent.eventName,
      NotificationSentEvent.eventName,
      OperationTieOccurredEvent.eventName,
      NotificationSentEvent.eventName,
      MartingaleOneReachedEvent.eventName,
      NotificationSentEvent.eventName,
      OperationTieOccurredEvent.eventName,
      NotificationSentEvent.eventName,
      MartingaleTwoReachedEvent.eventName,
      NotificationSentEvent.eventName,
      OperationTieOccurredEvent.eventName,
      NotificationSentEvent.eventName,
      OperationWonEvent.eventName,
      NotificationSentEvent.eventName,
    ]);

    // Estados: la operación quedó en WON y fue eliminada de las activas.
    const wonEvent = engine.publishedEvents.find(
      (e) => e.eventName === OperationWonEvent.eventName,
    )!;
    const snapshot = wonEvent.payload as {
      currentState: OperationState;
      currentMartingale: number;
      recommendedWinner: WinnerType;
      history: unknown[];
    };
    expect(snapshot.currentState).toBe(OperationState.WON);
    expect(snapshot.currentMartingale).toBe(2);
    expect(snapshot.recommendedWinner).toBe(WinnerType.BANKER);
    expect(snapshot.history).toHaveLength(3); // OPEN->MG1, MG1->MG2, MG2->WON
    expect(engine.operationCoordinator.activeCount()).toBe(0);

    // Notificaciones: 7 en total (abierta, 3 ties, MG1, MG2, ganada), todas entregadas.
    expect(engine.channel.sent).toHaveLength(7);

    // La primera notificación debe incluir la línea de distribución.
    expect(engine.channel.sent[0].message).toContain('🔵');
    expect(engine.channel.sent[0].message).toContain('🟡');
    expect(engine.channel.sent[0].message).toContain('🔴');

    // Estadísticas.
    const statistics = engine.statisticsService.getSnapshot();
    expect(statistics.totalGames).toBe(12);
    expect(statistics.playerWins).toBe(6);
    expect(statistics.bankerWins).toBe(1);
    expect(statistics.ties).toBe(5);
    expect(statistics.currentStreak).toEqual({
      winner: WinnerType.BANKER,
      length: 1,
    });

    // Métricas del motor.
    expect(engine.engineMetricsService.getSnapshot()).toEqual({
      gamesReceived: 12,
      signalsGenerated: 1,
      operationsOpened: 1,
      operationsWon: 1,
      operationsLost: 0,
      martingaleOneReachedCount: 1,
      martingaleTwoReachedCount: 1,
      notificationsSent: 7,
      notificationsFailed: 0,
    });
  });

  it('streak -> signal -> operation -> MG1 -> MG2 -> defeat, with every event, state, notification, statistic and metric verified', async () => {
    const engine = buildEngine();

    await feedGame(engine, buildGame('1', WinnerType.TIE));
    await feedGame(engine, buildGame('2', WinnerType.TIE));
    await feedGame(engine, buildGame('3', WinnerType.PLAYER));
    await feedGame(engine, buildGame('4', WinnerType.PLAYER));
    await feedGame(engine, buildGame('5', WinnerType.PLAYER));
    await feedGame(engine, buildGame('6', WinnerType.PLAYER)); // dispara la señal (recomienda BANKER)

    await feedGame(engine, buildGame('7', WinnerType.TIE));
    await feedGame(engine, buildGame('8', WinnerType.PLAYER)); // MG1
    await feedGame(engine, buildGame('9', WinnerType.TIE));
    await feedGame(engine, buildGame('10', WinnerType.PLAYER)); // MG2
    await feedGame(engine, buildGame('11', WinnerType.TIE));
    await feedGame(engine, buildGame('12', WinnerType.PLAYER)); // 3ª pérdida -> LOST

    // Eventos, en orden.
    expect(engine.publishedEvents.map((e) => e.eventName)).toEqual([
      StrategyTriggeredEvent.eventName,
      OperationOpenedEvent.eventName,
      NotificationSentEvent.eventName,
      OperationTieOccurredEvent.eventName,
      NotificationSentEvent.eventName,
      MartingaleOneReachedEvent.eventName,
      NotificationSentEvent.eventName,
      OperationTieOccurredEvent.eventName,
      NotificationSentEvent.eventName,
      MartingaleTwoReachedEvent.eventName,
      NotificationSentEvent.eventName,
      OperationTieOccurredEvent.eventName,
      NotificationSentEvent.eventName,
      OperationLostEvent.eventName,
      NotificationSentEvent.eventName,
    ]);

    // Estados.
    const lostEvent = engine.publishedEvents.find(
      (e) => e.eventName === OperationLostEvent.eventName,
    )!;
    const snapshot = lostEvent.payload as {
      currentState: OperationState;
      currentMartingale: number;
      history: unknown[];
    };
    expect(snapshot.currentState).toBe(OperationState.LOST);
    expect(snapshot.currentMartingale).toBe(2);
    expect(snapshot.history).toHaveLength(3);
    expect(engine.operationCoordinator.activeCount()).toBe(0);

    // Notificaciones.
    expect(engine.channel.sent).toHaveLength(7);
    expect(engine.channel.sent[6].severity).toBeDefined();
    expect(engine.channel.sent[0].message).toContain('🔵');

    // Estadísticas.
    const statistics = engine.statisticsService.getSnapshot();
    expect(statistics.totalGames).toBe(12);
    expect(statistics.playerWins).toBe(7);
    expect(statistics.bankerWins).toBe(0);
    expect(statistics.ties).toBe(5);
    expect(statistics.currentStreak).toEqual({
      winner: WinnerType.PLAYER,
      length: 1,
    });

    // Métricas.
    expect(engine.engineMetricsService.getSnapshot()).toEqual({
      gamesReceived: 12,
      signalsGenerated: 1,
      operationsOpened: 1,
      operationsWon: 0,
      operationsLost: 1,
      martingaleOneReachedCount: 1,
      martingaleTwoReachedCount: 1,
      notificationsSent: 7,
      notificationsFailed: 0,
    });
  });

  it('never opens operations or sends notifications for the historical backfill, but still counts it in Statistics/EngineMetrics', async () => {
    const engine = buildEngine();

    // Misma racha ganadora que el primer escenario, pero marcada como
    // `isHistorical: true` (como si viniera de la carga inicial del
    // collector, no del SSE en vivo).
    for (const [uuid, winner] of [
      ['1', WinnerType.TIE],
      ['2', WinnerType.TIE],
      ['3', WinnerType.PLAYER],
      ['4', WinnerType.PLAYER],
      ['5', WinnerType.PLAYER],
      ['6', WinnerType.PLAYER],
      ['7', WinnerType.TIE],
      ['8', WinnerType.PLAYER],
      ['9', WinnerType.TIE],
      ['10', WinnerType.PLAYER],
      ['11', WinnerType.TIE],
      ['12', WinnerType.BANKER],
    ] as const) {
      await feedGame(engine, buildGame(uuid, winner), true);
    }

    expect(engine.publishedEvents).toHaveLength(0);
    expect(engine.channel.sent).toHaveLength(0);
    expect(engine.operationCoordinator.activeCount()).toBe(0);

    // Statistics y EngineMetrics sí reflejan el historial completo: es
    // analítica descriptiva, no una decisión accionable.
    expect(engine.statisticsService.getSnapshot().totalGames).toBe(12);
    expect(engine.engineMetricsService.getSnapshot()).toEqual({
      gamesReceived: 12,
      signalsGenerated: 0,
      operationsOpened: 0,
      operationsWon: 0,
      operationsLost: 0,
      martingaleOneReachedCount: 0,
      martingaleTwoReachedCount: 0,
      notificationsSent: 0,
      notificationsFailed: 0,
    });
  });

  it('does not open a new operation on every consecutive matching game while one is already active for that strategy', async () => {
    const engine = buildEngine();

    // Racha de 4 PLAYER: dispara y abre una única Operation (recomienda
    // BANKER). Las siguientes PLAYER consecutivas siguen formando "una
    // racha de 4" sobre el historial, pero streak-4 ya tiene una operación
    // activa: StrategyExecutionGuard debe bloquear la señal, en vez de
    // abrir Operation #2 y #3 como antes de este fix.
    await feedGame(engine, buildGame('1', WinnerType.PLAYER));
    await feedGame(engine, buildGame('2', WinnerType.PLAYER));
    await feedGame(engine, buildGame('3', WinnerType.PLAYER));
    await feedGame(engine, buildGame('4', WinnerType.PLAYER)); // dispara Operation A
    expect(engine.operationCoordinator.activeCount()).toBe(1);

    await feedGame(engine, buildGame('5', WinnerType.PLAYER)); // Operation A -> MG1
    expect(engine.operationCoordinator.activeCount()).toBe(1);

    await feedGame(engine, buildGame('6', WinnerType.PLAYER)); // Operation A -> MG2
    expect(engine.operationCoordinator.activeCount()).toBe(1);

    await feedGame(engine, buildGame('7', WinnerType.PLAYER)); // Operation A -> LOST (3ª pérdida)
    expect(engine.operationCoordinator.activeCount()).toBe(0);

    const triggeredSoFar = engine.publishedEvents.filter(
      (e) => e.eventName === StrategyTriggeredEvent.eventName,
    );
    expect(triggeredSoFar).toHaveLength(1);
    expect(
      engine.publishedEvents.filter(
        (e) => e.eventName === OperationOpenedEvent.eventName,
      ),
    ).toHaveLength(1);

    // Operation A ya cerró (LOST), y StrategyExecutionGuard ya permitiría
    // ejecutar de nuevo. Pero la racha de PLAYER NUNCA se rompió (juegos
    // 1-8 son todos PLAYER): sigue siendo la MISMA racha que ya generó su
    // señal, así que streak-4 no debe volver a disparar. Este es el punto
    // que el fix anterior (solo concurrencia de operaciones) no cubría.
    await feedGame(engine, buildGame('8', WinnerType.PLAYER));

    expect(
      engine.publishedEvents.filter(
        (e) => e.eventName === StrategyTriggeredEvent.eventName,
      ),
    ).toHaveLength(1);
    expect(
      engine.publishedEvents.filter(
        (e) => e.eventName === OperationOpenedEvent.eventName,
      ),
    ).toHaveLength(1);
    expect(engine.operationCoordinator.activeCount()).toBe(0);

    // Un TIE rompe la racha: no cuenta como PLAYER ni como el inicio de
    // una nueva racha por sí mismo.
    await feedGame(engine, buildGame('9', WinnerType.TIE));
    expect(
      engine.publishedEvents.filter(
        (e) => e.eventName === StrategyTriggeredEvent.eventName,
      ),
    ).toHaveLength(1);

    // Ahora sí: una racha genuinamente nueva (BANKER, distinta a la que ya
    // se consumió) vuelve a habilitar la señal y abre Operation B.
    await feedGame(engine, buildGame('10', WinnerType.BANKER));
    await feedGame(engine, buildGame('11', WinnerType.BANKER));
    await feedGame(engine, buildGame('12', WinnerType.BANKER));
    await feedGame(engine, buildGame('13', WinnerType.BANKER));

    expect(
      engine.publishedEvents.filter(
        (e) => e.eventName === StrategyTriggeredEvent.eventName,
      ),
    ).toHaveLength(2);
    expect(
      engine.publishedEvents.filter(
        (e) => e.eventName === OperationOpenedEvent.eventName,
      ),
    ).toHaveLength(2);
    expect(engine.operationCoordinator.activeCount()).toBe(1);
  });
});
