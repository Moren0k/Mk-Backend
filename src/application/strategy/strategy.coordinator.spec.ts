import { Logger } from '@nestjs/common';

import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { StrategyTriggeredEvent } from '../../core/domain-events/strategy/strategy-triggered.event';
import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import { HistoryStore } from '../../core/interfaces/history-store.interface';
import { HistorySnapshot } from '../../core/interfaces/history-snapshot.interface';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { StrategyExecutionGuard } from '../../core/strategy/interfaces/strategy-execution-guard.interface';
import { Strategy } from '../../core/strategy/interfaces/strategy.interface';
import { StrategyResult } from '../../core/strategy/types/strategy-result.type';
import { InMemoryStrategyRuntimeState } from './in-memory-strategy-runtime-state';
import { StrategyCoordinator } from './strategy.coordinator';

function buildGame(uuid: string): Game {
  return {
    uuid,
    winner: WinnerType.PLAYER,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function buildGameReceivedEvent(
  uuid: string,
  isHistorical = false,
): GameReceivedEvent {
  return new GameReceivedEvent({ game: buildGame(uuid), isHistorical });
}

function buildSnapshot(): jest.Mocked<HistorySnapshot> {
  return {
    getLatest: jest.fn(),
    getLast: jest.fn().mockReturnValue([]),
    getAll: jest.fn().mockReturnValue([]),
    size: jest.fn().mockReturnValue(0),
    isEmpty: jest.fn().mockReturnValue(true),
  };
}

function buildStrategy(
  id: string,
  result: StrategyResult,
  overrides: Partial<Strategy> = {},
): jest.Mocked<Strategy> {
  return {
    id,
    name: `Strategy-${id}`,
    description: 'test strategy',
    enabled: jest.fn().mockReturnValue(true),
    evaluate: jest.fn().mockReturnValue(result),
    ...overrides,
  };
}

const NO_SIGNAL: StrategyResult = { triggered: false };

describe('StrategyCoordinator', () => {
  let historyStore: jest.Mocked<HistoryStore>;
  let domainEventBus: jest.Mocked<DomainEventBus>;
  let snapshot: jest.Mocked<HistorySnapshot>;
  let errorTracker: EngineErrorTracker;
  let executionGuard: jest.Mocked<StrategyExecutionGuard>;
  let runtimeState: InMemoryStrategyRuntimeState;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    snapshot = buildSnapshot();
    executionGuard = { canExecute: jest.fn().mockReturnValue(true) };
    runtimeState = new InMemoryStrategyRuntimeState();

    historyStore = {
      append: jest.fn(),
      exists: jest.fn(),
      findByUuid: jest.fn(),
      getLatest: jest.fn(),
      getLast: jest.fn(),
      getAll: jest.fn(),
      size: jest.fn(),
      clear: jest.fn(),
      createSnapshot: jest.fn().mockReturnValue(snapshot),
    };

    domainEventBus = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      publish: jest.fn(),
      publishMany: jest.fn(),
      clear: jest.fn(),
    };

    errorTracker = new EngineErrorTracker();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function build(strategies: Strategy[]): StrategyCoordinator {
    return new StrategyCoordinator(
      historyStore,
      domainEventBus,
      strategies,
      errorTracker,
      executionGuard,
      runtimeState,
    );
  }

  it('subscribes to GameReceivedEvent on module init', () => {
    const coordinator = build([]);

    coordinator.onModuleInit();

    expect(domainEventBus.subscribe).toHaveBeenCalledWith(
      GameReceivedEvent.eventName,
      coordinator,
    );
  });

  it('unsubscribes from GameReceivedEvent on module destroy', () => {
    const coordinator = build([]);

    coordinator.onModuleDestroy();

    expect(domainEventBus.unsubscribe).toHaveBeenCalledWith(
      GameReceivedEvent.eventName,
      coordinator,
    );
  });

  it('builds a StrategyContext from the event payload and a fresh HistorySnapshot', () => {
    const strategy = buildStrategy('a', NO_SIGNAL);
    const coordinator = build([strategy]);
    const game = buildGame('current');

    coordinator.handle(new GameReceivedEvent({ game, isHistorical: false }));

    expect(historyStore.createSnapshot).toHaveBeenCalledTimes(1);
    expect(strategy.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        currentGame: game,
        historySnapshot: snapshot,
        execution: executionGuard,
        runtimeState,
        timestamp: expect.any(Date) as Date,
      }),
    );
  });

  it('runs every registered strategy', () => {
    const first = buildStrategy('first', NO_SIGNAL);
    const second = buildStrategy('second', NO_SIGNAL);
    const coordinator = build([first, second]);

    coordinator.handle(buildGameReceivedEvent('1'));

    expect(first.evaluate).toHaveBeenCalledTimes(1);
    expect(second.evaluate).toHaveBeenCalledTimes(1);
  });

  it('runs strategies in registration order', () => {
    const order: string[] = [];
    const first = buildStrategy('first', NO_SIGNAL, {
      evaluate: jest.fn().mockImplementation(() => {
        order.push('first');
        return NO_SIGNAL;
      }),
    });
    const second = buildStrategy('second', NO_SIGNAL, {
      evaluate: jest.fn().mockImplementation(() => {
        order.push('second');
        return NO_SIGNAL;
      }),
    });
    const coordinator = build([first, second]);

    coordinator.handle(buildGameReceivedEvent('1'));

    expect(order).toEqual(['first', 'second']);
  });

  it('skips disabled strategies entirely', () => {
    const disabled = buildStrategy('disabled', NO_SIGNAL, {
      enabled: jest.fn().mockReturnValue(false),
    });
    const coordinator = build([disabled]);

    coordinator.handle(buildGameReceivedEvent('1'));

    expect(disabled.evaluate).not.toHaveBeenCalled();
  });

  it('publishes a StrategyTriggeredEvent only for strategies that trigger', () => {
    const triggeringSignal: StrategyResult = {
      triggered: true,
      strategyId: 'winner',
      strategyName: 'WinnerStrategy',
      triggeredAt: new Date('2026-08-01T00:05:00.000Z'),
      recommendedWinner: WinnerType.BANKER,
      streakWinner: WinnerType.PLAYER,
      maxMartingales: 2,
      triggerGameUuid: '1',
      reason: 'test',
      metadata: {},
    };
    const triggering = buildStrategy('winner', triggeringSignal);
    const silent = buildStrategy('silent', NO_SIGNAL);
    const coordinator = build([triggering, silent]);

    coordinator.handle(buildGameReceivedEvent('1'));

    expect(domainEventBus.publish).toHaveBeenCalledTimes(1);
    expect(domainEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: StrategyTriggeredEvent.eventName,
        payload: triggeringSignal,
      }),
    );
  });

  it('publishes one StrategyTriggeredEvent per strategy that triggers', () => {
    const signalA: StrategyResult = {
      triggered: true,
      strategyId: 'a',
      strategyName: 'A',
      triggeredAt: new Date(),
      recommendedWinner: WinnerType.BANKER,
      streakWinner: WinnerType.PLAYER,
      maxMartingales: 2,
      triggerGameUuid: '1',
      reason: 'a',
      metadata: {},
    };
    const signalB: StrategyResult = {
      triggered: true,
      strategyId: 'b',
      strategyName: 'B',
      triggeredAt: new Date(),
      recommendedWinner: WinnerType.PLAYER,
      streakWinner: WinnerType.BANKER,
      maxMartingales: 2,
      triggerGameUuid: '1',
      reason: 'b',
      metadata: {},
    };
    const strategyA = buildStrategy('a', signalA);
    const strategyB = buildStrategy('b', signalB);
    const coordinator = build([strategyA, strategyB]);

    coordinator.handle(buildGameReceivedEvent('1'));

    expect(domainEventBus.publish).toHaveBeenCalledTimes(2);
  });

  it('logs the error and keeps evaluating the remaining strategies when one throws', () => {
    const failing = buildStrategy('failing', NO_SIGNAL, {
      evaluate: jest.fn().mockImplementation(() => {
        throw new Error('boom');
      }),
    });
    const healthy = buildStrategy('healthy', NO_SIGNAL);
    const coordinator = build([failing, healthy]);

    expect(() => coordinator.handle(buildGameReceivedEvent('1'))).not.toThrow();

    expect(healthy.evaluate).toHaveBeenCalledTimes(1);
    expect(domainEventBus.publish).not.toHaveBeenCalled();
    expect(errorTracker.getLastError()?.message).toContain('falló al evaluar');
  });

  it('does nothing when there are no registered strategies', () => {
    const coordinator = build([]);

    expect(() => coordinator.handle(buildGameReceivedEvent('1'))).not.toThrow();

    expect(domainEventBus.publish).not.toHaveBeenCalled();
  });

  it('never evaluates strategies for historical games (the initial backfill)', () => {
    const strategy = buildStrategy('a', NO_SIGNAL);
    const coordinator = build([strategy]);

    coordinator.handle(buildGameReceivedEvent('1', true));

    expect(strategy.evaluate).not.toHaveBeenCalled();
    expect(historyStore.createSnapshot).not.toHaveBeenCalled();
    expect(domainEventBus.publish).not.toHaveBeenCalled();
  });

  it('still evaluates strategies normally for live games (isHistorical: false)', () => {
    const strategy = buildStrategy('a', NO_SIGNAL);
    const coordinator = build([strategy]);

    coordinator.handle(buildGameReceivedEvent('1', false));

    expect(strategy.evaluate).toHaveBeenCalledTimes(1);
  });
});
