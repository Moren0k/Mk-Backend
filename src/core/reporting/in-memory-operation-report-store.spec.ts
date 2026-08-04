import { OperationState } from '../enums/operation-state.enum';
import { InMemoryOperationReportStore } from './in-memory-operation-report-store';
import { OperationClosedRecord } from './types/operation-closed-record.type';
import { OperationOpenedRecord } from './types/operation-opened-record.type';

function buildOpened(openedAt: string): OperationOpenedRecord {
  return {
    operationId: `op-${openedAt}`,
    strategyId: 'streak-3',
    openedAt: new Date(openedAt),
  };
}

function buildClosed(closedAt: string): OperationClosedRecord {
  return {
    operationId: `op-${closedAt}`,
    strategyId: 'streak-3',
    openedAt: new Date(closedAt),
    closedAt: new Date(closedAt),
    result: OperationState.WON,
    martingalesUsed: 0,
    maxMartingales: 2,
  };
}

describe('InMemoryOperationReportStore', () => {
  let store: InMemoryOperationReportStore;

  beforeEach(() => {
    store = new InMemoryOperationReportStore();
  });

  it('returns nothing when empty', () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-02T00:00:00.000Z');

    expect(store.getOpenedBetween(from, to)).toEqual([]);
    expect(store.getClosedBetween(from, to)).toEqual([]);
  });

  it('filters opened records by [from, to)', () => {
    store.recordOpened(buildOpened('2026-08-01T13:00:00.000Z'));
    store.recordOpened(buildOpened('2026-08-01T14:00:00.000Z'));
    store.recordOpened(buildOpened('2026-08-01T15:00:00.000Z'));

    const result = store.getOpenedBetween(
      new Date('2026-08-01T13:00:00.000Z'),
      new Date('2026-08-01T14:00:00.000Z'),
    );

    expect(result).toHaveLength(1);
    expect(result[0].openedAt.toISOString()).toBe('2026-08-01T13:00:00.000Z');
  });

  it('includes the lower bound and excludes the upper bound', () => {
    store.recordOpened(buildOpened('2026-08-01T14:00:00.000Z'));

    expect(
      store.getOpenedBetween(
        new Date('2026-08-01T14:00:00.000Z'),
        new Date('2026-08-01T15:00:00.000Z'),
      ),
    ).toHaveLength(1);
    expect(
      store.getOpenedBetween(
        new Date('2026-08-01T13:00:00.000Z'),
        new Date('2026-08-01T14:00:00.000Z'),
      ),
    ).toHaveLength(0);
  });

  it('filters closed records by closedAt independently of openedAt', () => {
    store.recordClosed(buildClosed('2026-08-01T14:30:00.000Z'));

    const result = store.getClosedBetween(
      new Date('2026-08-01T14:00:00.000Z'),
      new Date('2026-08-01T15:00:00.000Z'),
    );

    expect(result).toHaveLength(1);
  });

  it('getAllOpened() returns every opened record ever recorded, regardless of time', () => {
    store.recordOpened(buildOpened('2026-08-01T13:00:00.000Z'));
    store.recordOpened(buildOpened('2026-08-03T09:00:00.000Z'));

    expect(store.getAllOpened()).toHaveLength(2);
  });

  it('getAllClosed() returns every closed record ever recorded, regardless of time', () => {
    store.recordClosed(buildClosed('2026-08-01T13:30:00.000Z'));
    store.recordClosed(buildClosed('2026-08-03T09:30:00.000Z'));

    expect(store.getAllClosed()).toHaveLength(2);
  });
});
