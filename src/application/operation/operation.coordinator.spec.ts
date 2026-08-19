import { Logger } from '@nestjs/common';

import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { MartingaleOneReachedEvent } from '../../core/domain-events/operation/martingale-one-reached.event';
import { OperationCancelledEvent } from '../../core/domain-events/operation/operation-cancelled.event';
import { OperationLostEvent } from '../../core/domain-events/operation/operation-lost.event';
import { OperationOpenedEvent } from '../../core/domain-events/operation/operation-opened.event';
import { OperationTieOccurredEvent } from '../../core/domain-events/operation/operation-tie-occurred.event';
import { OperationWonEvent } from '../../core/domain-events/operation/operation-won.event';
import { StrategyTriggeredEvent } from '../../core/domain-events/strategy/strategy-triggered.event';
import { OperationState } from '../../core/enums/operation-state.enum';
import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { StrategyTrigger } from '../../core/strategy/types/strategy-signal.type';
import { ActiveOperationRegistry } from './active-operation-registry';
import { OperationCoordinator } from './operation.coordinator';

function buildSignal(
  overrides: Partial<StrategyTrigger> = {},
): StrategyTrigger {
  return {
    triggered: true,
    strategyId: 'streak-3',
    context: 'oficial',
    strategyName: 'Streak3Strategy',
    triggeredAt: new Date('2026-08-01T00:00:00.000Z'),
    recommendedWinner: WinnerType.BANKER,
    streakWinner: WinnerType.PLAYER,
    maxMartingales: 2,
    triggerGameUuid: 'trigger-game',
    reason: 'Racha de 3 PLAYER consecutivos.',
    metadata: {},
    ...overrides,
  };
}

function buildGame(uuid: string, winner: WinnerType): Game {
  return {
    uuid,
    winner,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('OperationCoordinator', () => {
  let domainEventBus: jest.Mocked<DomainEventBus>;
  let errorTracker: EngineErrorTracker;
  let coordinator: OperationCoordinator;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    domainEventBus = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      publish: jest.fn(),
      publishMany: jest.fn(),
      clear: jest.fn(),
    };

    errorTracker = new EngineErrorTracker();
    coordinator = new OperationCoordinator(
      domainEventBus,
      errorTracker,
      new ActiveOperationRegistry(),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('subscribes to StrategyTriggeredEvent and GameReceivedEvent on module init', () => {
    coordinator.onModuleInit();

    expect(domainEventBus.subscribe).toHaveBeenCalledWith(
      StrategyTriggeredEvent.eventName,
      expect.anything(),
    );
    expect(domainEventBus.subscribe).toHaveBeenCalledWith(
      GameReceivedEvent.eventName,
      expect.anything(),
    );
  });

  it('unsubscribes both handlers on module destroy, using the exact same references used to subscribe', () => {
    coordinator.onModuleInit();
    const [firstSubscribeCall, secondSubscribeCall] =
      domainEventBus.subscribe.mock.calls;

    coordinator.onModuleDestroy();

    expect(domainEventBus.unsubscribe).toHaveBeenCalledWith(
      firstSubscribeCall[0],
      firstSubscribeCall[1],
    );
    expect(domainEventBus.unsubscribe).toHaveBeenCalledWith(
      secondSubscribeCall[0],
      secondSubscribeCall[1],
    );
  });

  function triggerStrategy(overrides: Partial<StrategyTrigger> = {}): void {
    coordinator.onModuleInit();
    const handler = domainEventBus.subscribe.mock.calls.find(
      ([eventName]) => eventName === StrategyTriggeredEvent.eventName,
    )![1];
    handler.handle(new StrategyTriggeredEvent(buildSignal(overrides)));
  }

  function receiveGame(winner: WinnerType, uuid = 'game'): void {
    const handler = domainEventBus.subscribe.mock.calls.find(
      ([eventName]) => eventName === GameReceivedEvent.eventName,
    )![1];
    handler.handle(
      new GameReceivedEvent({
        game: buildGame(uuid, winner),
        isHistorical: false,
      }),
    );
  }

  it('creates an Operation and publishes OperationOpenedEvent when a strategy triggers', () => {
    triggerStrategy();

    expect(domainEventBus.publish).toHaveBeenCalledTimes(1);
    expect(domainEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: OperationOpenedEvent.eventName }),
    );
    expect(coordinator.activeCount()).toBe(1);
  });

  it('supports multiple simultaneous operations', () => {
    triggerStrategy({ strategyId: 'a' });
    triggerStrategy({ strategyId: 'b' });

    expect(coordinator.activeCount()).toBe(2);
  });

  it('exposes a read-only snapshot of every active operation via getActiveSnapshots', () => {
    triggerStrategy({ strategyId: 'a', recommendedWinner: WinnerType.BANKER });
    triggerStrategy({ strategyId: 'b', recommendedWinner: WinnerType.PLAYER });

    const snapshots = coordinator.getActiveSnapshots();

    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((s) => s.strategyId).sort()).toEqual(['a', 'b']);
  });

  it('getActiveSnapshots no longer reports an operation once it finishes', () => {
    triggerStrategy({ recommendedWinner: WinnerType.BANKER });

    receiveGame(WinnerType.BANKER);

    expect(coordinator.getActiveSnapshots()).toHaveLength(0);
  });

  it('updates every active operation with each new GameReceivedEvent', () => {
    triggerStrategy({ recommendedWinner: WinnerType.BANKER });
    triggerStrategy({ recommendedWinner: WinnerType.PLAYER });
    domainEventBus.publish.mockClear();

    receiveGame(WinnerType.BANKER);

    // The first operation (recommends BANKER) wins; the second (recommends
    // PLAYER) loses its first round and advances to MG1.
    expect(domainEventBus.publish).toHaveBeenCalledTimes(2);
    expect(domainEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: OperationWonEvent.eventName }),
    );
    expect(domainEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: MartingaleOneReachedEvent.eventName,
      }),
    );
    expect(coordinator.activeCount()).toBe(1);
  });

  it('removes an operation from the active set once it reaches a final state', () => {
    triggerStrategy({ recommendedWinner: WinnerType.BANKER });

    receiveGame(WinnerType.BANKER);

    expect(coordinator.activeCount()).toBe(0);
  });

  it('publishes MartingaleOneReachedEvent, MartingaleTwoReachedEvent and OperationLostEvent as the operation progresses', () => {
    triggerStrategy({
      recommendedWinner: WinnerType.BANKER,
      maxMartingales: 2,
    });
    domainEventBus.publish.mockClear();

    receiveGame(WinnerType.PLAYER, '1');
    expect(domainEventBus.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventName: MartingaleOneReachedEvent.eventName,
      }),
    );

    receiveGame(WinnerType.PLAYER, '2');
    expect(domainEventBus.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventName: 'MartingaleTwoReachedEvent',
      }),
    );

    receiveGame(WinnerType.PLAYER, '3');
    expect(domainEventBus.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventName: OperationLostEvent.eventName }),
    );
    expect(coordinator.activeCount()).toBe(0);
  });

  it('publishes OperationTieOccurredEvent for a TIE, and keeps the operation active', () => {
    triggerStrategy({ recommendedWinner: WinnerType.BANKER });
    domainEventBus.publish.mockClear();

    receiveGame(WinnerType.TIE);

    expect(domainEventBus.publish).toHaveBeenCalledTimes(1);
    expect(domainEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: OperationTieOccurredEvent.eventName,
      }),
    );
    expect(coordinator.activeCount()).toBe(1);
  });

  describe('cancel()', () => {
    it('cancels an active operation, publishes OperationCancelledEvent, and removes it from the active set', () => {
      triggerStrategy();
      const operationId = coordinator.getActiveSnapshots()[0].operationId;
      domainEventBus.publish.mockClear();

      const snapshot = coordinator.cancel(
        operationId,
        'cancelada desde la API',
      );

      expect(snapshot?.currentState).toBe(OperationState.CANCELLED);
      expect(domainEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: OperationCancelledEvent.eventName,
        }),
      );
      expect(coordinator.activeCount()).toBe(0);
    });

    it('returns undefined for an operationId that is not active', () => {
      const result = coordinator.cancel('does-not-exist', 'motivo');

      expect(result).toBeUndefined();
      expect(domainEventBus.publish).not.toHaveBeenCalled();
    });
  });

  it('logs the error, discards only the failing operation, and keeps updating the others', () => {
    // OperationState only defines MG1/MG2. An operation configured with
    // maxMartingales=3 will make Operation.update() throw on its 3rd loss
    // (see MARTINGALE_STATE_BY_COUNT in operation.entity.ts) — this is how
    // we force a genuine internal failure without faking bad input data.
    triggerStrategy({
      strategyId: 'healthy-before',
      recommendedWinner: WinnerType.PLAYER,
      maxMartingales: 2,
    });
    triggerStrategy({
      strategyId: 'broken',
      recommendedWinner: WinnerType.PLAYER,
      maxMartingales: 3,
    });
    triggerStrategy({
      strategyId: 'healthy-after',
      recommendedWinner: WinnerType.PLAYER,
      maxMartingales: 2,
    });
    domainEventBus.publish.mockClear();

    // Three consecutive losses for everyone: healthy operations reach LOST
    // normally on the 3rd loss; the broken one throws instead.
    receiveGame(WinnerType.BANKER, '1');
    receiveGame(WinnerType.BANKER, '2');

    expect(() => receiveGame(WinnerType.BANKER, '3')).not.toThrow();

    expect(domainEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: OperationLostEvent.eventName }),
    );
    // Both healthy operations finished (LOST) and were removed; the broken
    // one was discarded after failing. Nothing should remain active.
    expect(coordinator.activeCount()).toBe(0);
    expect(errorTracker.getLastError()?.message).toContain(
      'falló al actualizarse',
    );
  });
});
