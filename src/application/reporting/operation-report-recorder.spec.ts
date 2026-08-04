import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { OperationLostEvent } from '../../core/domain-events/operation/operation-lost.event';
import { OperationOpenedEvent } from '../../core/domain-events/operation/operation-opened.event';
import { OperationWonEvent } from '../../core/domain-events/operation/operation-won.event';
import { OperationState } from '../../core/enums/operation-state.enum';
import { WinnerType } from '../../core/enums/winner-type.enum';
import type { OperationReportStore } from '../../core/reporting/interfaces/operation-report-store.interface';
import { OperationSnapshot } from '../../core/operation/types/operation-snapshot.type';
import { OperationReportRecorder } from './operation-report-recorder';

function buildSnapshot(
  overrides: Partial<OperationSnapshot> = {},
): OperationSnapshot {
  return {
    operationId: 'op-1',
    strategyId: 'streak-3',
    recommendedWinner: WinnerType.BANKER,
    currentState: OperationState.OPEN,
    currentMartingale: 0,
    maxMartingales: 2,
    openedAt: new Date('2026-08-01T15:00:00.000Z'),
    closedAt: undefined,
    reason: 'test',
    history: [],
    ...overrides,
  };
}

describe('OperationReportRecorder', () => {
  let domainEventBus: jest.Mocked<DomainEventBus>;
  let store: jest.Mocked<OperationReportStore>;
  let recorder: OperationReportRecorder;

  beforeEach(() => {
    domainEventBus = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      publish: jest.fn(),
      publishMany: jest.fn(),
      clear: jest.fn(),
    };
    store = {
      recordOpened: jest.fn(),
      recordClosed: jest.fn(),
      getOpenedBetween: jest.fn().mockReturnValue([]),
      getClosedBetween: jest.fn().mockReturnValue([]),
      clear: jest.fn(),
    };
    recorder = new OperationReportRecorder(domainEventBus, store);
  });

  function fire(eventName: string, event: unknown): void {
    recorder.onModuleInit();
    const handler = domainEventBus.subscribe.mock.calls.find(
      ([name]) => name === eventName,
    )![1];
    handler.handle(event);
  }

  it('subscribes to OperationOpened/Won/Lost on module init', () => {
    recorder.onModuleInit();

    expect(domainEventBus.subscribe).toHaveBeenCalledTimes(3);
    for (const eventName of [
      OperationOpenedEvent.eventName,
      OperationWonEvent.eventName,
      OperationLostEvent.eventName,
    ]) {
      expect(domainEventBus.subscribe).toHaveBeenCalledWith(
        eventName,
        expect.anything(),
      );
    }
  });

  it('unsubscribes using the same handler references on module destroy', () => {
    recorder.onModuleInit();

    recorder.onModuleDestroy();

    expect(domainEventBus.unsubscribe).toHaveBeenCalledTimes(3);
    for (const [eventName, handler] of domainEventBus.subscribe.mock.calls) {
      expect(domainEventBus.unsubscribe).toHaveBeenCalledWith(
        eventName,
        handler,
      );
    }
  });

  it('records only operationId/openedAt on OperationOpenedEvent', () => {
    const snapshot = buildSnapshot({ operationId: 'op-42' });

    fire(OperationOpenedEvent.eventName, new OperationOpenedEvent(snapshot));

    expect(store.recordOpened).toHaveBeenCalledWith({
      operationId: 'op-42',
      strategyId: snapshot.strategyId,
      openedAt: snapshot.openedAt,
    });
  });

  it('records a WON operation with its full closing data', () => {
    const snapshot = buildSnapshot({
      operationId: 'op-1',
      currentState: OperationState.WON,
      currentMartingale: 1,
      closedAt: new Date('2026-08-01T15:05:00.000Z'),
    });

    fire(OperationWonEvent.eventName, new OperationWonEvent(snapshot));

    expect(store.recordClosed).toHaveBeenCalledWith({
      operationId: 'op-1',
      strategyId: snapshot.strategyId,
      openedAt: snapshot.openedAt,
      closedAt: snapshot.closedAt,
      result: OperationState.WON,
      martingalesUsed: 1,
      maxMartingales: 2,
    });
  });

  it('records a LOST operation with its full closing data', () => {
    const snapshot = buildSnapshot({
      operationId: 'op-2',
      currentState: OperationState.LOST,
      currentMartingale: 2,
      closedAt: new Date('2026-08-01T15:10:00.000Z'),
    });

    fire(OperationLostEvent.eventName, new OperationLostEvent(snapshot));

    expect(store.recordClosed).toHaveBeenCalledWith({
      operationId: 'op-2',
      strategyId: snapshot.strategyId,
      openedAt: snapshot.openedAt,
      closedAt: snapshot.closedAt,
      result: OperationState.LOST,
      martingalesUsed: 2,
      maxMartingales: 2,
    });
  });

  it('falls back to now() if closedAt is somehow missing, defensively', () => {
    const snapshot = buildSnapshot({
      currentState: OperationState.WON,
      closedAt: undefined,
    });

    fire(OperationWonEvent.eventName, new OperationWonEvent(snapshot));

    const recorded = store.recordClosed.mock.calls[0][0];
    expect(recorded.closedAt).toBeInstanceOf(Date);
  });
});
