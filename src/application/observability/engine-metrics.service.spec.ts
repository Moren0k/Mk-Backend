import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { NotificationFailedEvent } from '../../core/domain-events/notification/notification-failed.event';
import { NotificationSentEvent } from '../../core/domain-events/notification/notification-sent.event';
import { MartingaleOneReachedEvent } from '../../core/domain-events/operation/martingale-one-reached.event';
import { MartingaleTwoReachedEvent } from '../../core/domain-events/operation/martingale-two-reached.event';
import { OperationLostEvent } from '../../core/domain-events/operation/operation-lost.event';
import { OperationOpenedEvent } from '../../core/domain-events/operation/operation-opened.event';
import { OperationWonEvent } from '../../core/domain-events/operation/operation-won.event';
import { StrategyTriggeredEvent } from '../../core/domain-events/strategy/strategy-triggered.event';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { OperationState } from '../../core/enums/operation-state.enum';
import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import { OperationSnapshot } from '../../core/operation/types/operation-snapshot.type';
import { StrategySignal } from '../../core/strategy/types/strategy-signal.type';
import { EngineMetricsService } from './engine-metrics.service';

function buildGame(): Game {
  return {
    uuid: '1',
    winner: WinnerType.PLAYER,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function buildSignal(): StrategySignal {
  return {
    triggered: true,
    strategyId: 'streak-3',
    strategyName: 'Streak3Strategy',
    triggeredAt: new Date(),
    recommendedWinner: WinnerType.BANKER,
    maxMartingales: 2,
    triggerGameUuid: '1',
    reason: 'test',
    metadata: {},
  };
}

function buildSnapshot(): OperationSnapshot {
  return {
    operationId: 'op-1',
    strategyId: 'streak-3',
    recommendedWinner: WinnerType.BANKER,
    currentState: OperationState.OPEN,
    currentMartingale: 0,
    maxMartingales: 2,
    openedAt: new Date(),
    closedAt: undefined,
    reason: 'test',
    history: [],
  };
}

describe('EngineMetricsService', () => {
  let domainEventBus: jest.Mocked<DomainEventBus>;
  let service: EngineMetricsService;

  beforeEach(() => {
    domainEventBus = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      publish: jest.fn(),
      publishMany: jest.fn(),
      clear: jest.fn(),
    };
    service = new EngineMetricsService(domainEventBus);
  });

  function fire(eventName: string, event: unknown): void {
    service.onModuleInit();
    const handler = domainEventBus.subscribe.mock.calls.find(
      ([name]) => name === eventName,
    )![1];
    handler.handle(event);
  }

  it('subscribes to all 9 relevant events on module init', () => {
    service.onModuleInit();

    const expectedEvents = [
      GameReceivedEvent.eventName,
      StrategyTriggeredEvent.eventName,
      OperationOpenedEvent.eventName,
      OperationWonEvent.eventName,
      OperationLostEvent.eventName,
      MartingaleOneReachedEvent.eventName,
      MartingaleTwoReachedEvent.eventName,
      NotificationSentEvent.eventName,
      NotificationFailedEvent.eventName,
    ];

    expect(domainEventBus.subscribe).toHaveBeenCalledTimes(9);
    for (const eventName of expectedEvents) {
      expect(domainEventBus.subscribe).toHaveBeenCalledWith(
        eventName,
        expect.anything(),
      );
    }
  });

  it('unsubscribes all 9 handlers on module destroy, using the same references', () => {
    service.onModuleInit();

    service.onModuleDestroy();

    expect(domainEventBus.unsubscribe).toHaveBeenCalledTimes(9);
    for (const [eventName, handler] of domainEventBus.subscribe.mock.calls) {
      expect(domainEventBus.unsubscribe).toHaveBeenCalledWith(
        eventName,
        handler,
      );
    }
  });

  it('counts each event type independently', () => {
    fire(
      GameReceivedEvent.eventName,
      new GameReceivedEvent({ game: buildGame(), isHistorical: false }),
    );
    fire(
      GameReceivedEvent.eventName,
      new GameReceivedEvent({ game: buildGame(), isHistorical: true }),
    );
    fire(
      StrategyTriggeredEvent.eventName,
      new StrategyTriggeredEvent(buildSignal()),
    );
    fire(
      OperationOpenedEvent.eventName,
      new OperationOpenedEvent(buildSnapshot()),
    );
    fire(OperationWonEvent.eventName, new OperationWonEvent(buildSnapshot()));
    fire(OperationLostEvent.eventName, new OperationLostEvent(buildSnapshot()));
    fire(
      MartingaleOneReachedEvent.eventName,
      new MartingaleOneReachedEvent(buildSnapshot()),
    );
    fire(
      MartingaleTwoReachedEvent.eventName,
      new MartingaleTwoReachedEvent(buildSnapshot()),
    );
    fire(
      NotificationSentEvent.eventName,
      new NotificationSentEvent({
        notificationId: 'n1',
        channel: NotificationChannelType.TELEGRAM,
      }),
    );
    fire(
      NotificationFailedEvent.eventName,
      new NotificationFailedEvent({
        notificationId: 'n2',
        channel: NotificationChannelType.TELEGRAM,
        reason: 'boom',
      }),
    );

    expect(service.getSnapshot()).toEqual({
      gamesReceived: 2,
      signalsGenerated: 1,
      operationsOpened: 1,
      operationsWon: 1,
      operationsLost: 1,
      martingaleOneReachedCount: 1,
      martingaleTwoReachedCount: 1,
      notificationsSent: 1,
      notificationsFailed: 1,
    });
  });
});
