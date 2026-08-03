import { OperationState } from '../enums/operation-state.enum';
import { calculateSummaryMetrics } from './summary-metrics.calculator';
import { OperationClosedRecord } from './types/operation-closed-record.type';
import { OperationOpenedRecord } from './types/operation-opened-record.type';

function buildOpened(
  operationId: string,
  openedAt: string,
): OperationOpenedRecord {
  return { operationId, openedAt: new Date(openedAt) };
}

function buildClosed(
  operationId: string,
  closedAt: string,
  overrides: Partial<OperationClosedRecord> = {},
): OperationClosedRecord {
  return {
    operationId,
    openedAt: new Date(closedAt),
    closedAt: new Date(closedAt),
    result: OperationState.WON,
    martingalesUsed: 0,
    maxMartingales: 2,
    ...overrides,
  };
}

describe('calculateSummaryMetrics', () => {
  const processStartedAt = new Date('2026-08-01T15:00:00.000Z'); // 10:00 Bogotá
  const now = new Date('2026-08-01T17:00:00.000Z'); // 2h después

  it('returns zeroed-out metrics for an empty history', () => {
    const metrics = calculateSummaryMetrics([], [], processStartedAt, now);

    expect(metrics.alertsSent).toBe(0);
    expect(metrics.won).toBe(0);
    expect(metrics.bestWinStreak).toBe(0);
    expect(metrics.worstLossStreak).toBe(0);
    expect(metrics.currentStreak).toEqual({ result: 'NONE', length: 0 });
    expect(metrics.totalMartingalesUsed).toBe(0);
    expect(metrics.avgMartingalesPerWin).toBe(0);
    expect(metrics.winLossRatio).toBe(0);
    expect(metrics.alertsPerHourAvg).toBe(0);
    expect(metrics.avgEffectivenessPerHour).toBe(0);
    expect(metrics.bestAlertsHour).toBeUndefined();
    expect(metrics.bestEffectivenessHour).toBeUndefined();
    expect(metrics.worstEffectivenessHour).toBeUndefined();
  });

  it('computes uptimeMs from processStartedAt to now', () => {
    const metrics = calculateSummaryMetrics([], [], processStartedAt, now);

    expect(metrics.uptimeMs).toBe(2 * 60 * 60 * 1000);
  });

  it('tracks the best win streak and worst loss streak across the full history', () => {
    const closed = [
      buildClosed('a', '2026-08-01T15:00:00.000Z', {
        result: OperationState.WON,
      }),
      buildClosed('b', '2026-08-01T15:05:00.000Z', {
        result: OperationState.WON,
      }),
      buildClosed('c', '2026-08-01T15:10:00.000Z', {
        result: OperationState.LOST,
      }),
      buildClosed('d', '2026-08-01T15:15:00.000Z', {
        result: OperationState.WON,
      }),
      buildClosed('e', '2026-08-01T15:20:00.000Z', {
        result: OperationState.WON,
      }),
      buildClosed('f', '2026-08-01T15:25:00.000Z', {
        result: OperationState.WON,
      }),
      buildClosed('g', '2026-08-01T15:30:00.000Z', {
        result: OperationState.LOST,
      }),
      buildClosed('h', '2026-08-01T15:35:00.000Z', {
        result: OperationState.LOST,
      }),
    ];

    const metrics = calculateSummaryMetrics([], closed, processStartedAt, now);

    expect(metrics.bestWinStreak).toBe(3);
    expect(metrics.worstLossStreak).toBe(2);
    expect(metrics.currentStreak).toEqual({ result: 'LOST', length: 2 });
  });

  it('is unaffected by input order: sorts closed records by closedAt internally', () => {
    const closed = [
      buildClosed('b', '2026-08-01T15:10:00.000Z', {
        result: OperationState.LOST,
      }),
      buildClosed('a', '2026-08-01T15:05:00.000Z', {
        result: OperationState.WON,
      }),
    ];

    const metrics = calculateSummaryMetrics([], closed, processStartedAt, now);

    expect(metrics.currentStreak).toEqual({ result: 'LOST', length: 1 });
  });

  it('sums martingalesUsed across every closed operation, won or lost', () => {
    const closed = [
      buildClosed('a', '2026-08-01T15:00:00.000Z', {
        result: OperationState.WON,
        martingalesUsed: 1,
      }),
      buildClosed('b', '2026-08-01T15:05:00.000Z', {
        result: OperationState.LOST,
        martingalesUsed: 2,
      }),
    ];

    const metrics = calculateSummaryMetrics([], closed, processStartedAt, now);

    expect(metrics.totalMartingalesUsed).toBe(3);
    expect(metrics.avgMartingalesPerWin).toBe(1);
  });

  it('computes winLossRatio as won/lost', () => {
    const closed = [
      buildClosed('a', '2026-08-01T15:00:00.000Z', {
        result: OperationState.WON,
      }),
      buildClosed('b', '2026-08-01T15:05:00.000Z', {
        result: OperationState.WON,
      }),
      buildClosed('c', '2026-08-01T15:10:00.000Z', {
        result: OperationState.LOST,
      }),
    ];

    const metrics = calculateSummaryMetrics([], closed, processStartedAt, now);

    expect(metrics.winLossRatio).toBe(2);
  });

  it('winLossRatio is Infinity when there are wins and zero losses', () => {
    const closed = [
      buildClosed('a', '2026-08-01T15:00:00.000Z', {
        result: OperationState.WON,
      }),
    ];

    const metrics = calculateSummaryMetrics([], closed, processStartedAt, now);

    expect(metrics.winLossRatio).toBe(Infinity);
  });

  it('computes percentages of wins by category (direct/MG1/MG2)', () => {
    const closed = [
      buildClosed('a', '2026-08-01T15:00:00.000Z', { martingalesUsed: 0 }),
      buildClosed('b', '2026-08-01T15:05:00.000Z', { martingalesUsed: 1 }),
      buildClosed('c', '2026-08-01T15:10:00.000Z', { martingalesUsed: 2 }),
      buildClosed('d', '2026-08-01T15:15:00.000Z', { martingalesUsed: 0 }),
    ];

    const metrics = calculateSummaryMetrics([], closed, processStartedAt, now);

    expect(metrics.directWinPctOfWins).toBeCloseTo(50, 2);
    expect(metrics.martingaleOneWinPctOfWins).toBeCloseTo(25, 2);
    expect(metrics.martingaleTwoWinPctOfWins).toBeCloseTo(25, 2);
  });

  it('computes alertsPerHourAvg over the elapsed uptime', () => {
    const opened = [
      buildOpened('a', '2026-08-01T15:10:00.000Z'),
      buildOpened('b', '2026-08-01T16:10:00.000Z'),
    ];

    const metrics = calculateSummaryMetrics(opened, [], processStartedAt, now);

    expect(metrics.alertsPerHourAvg).toBeCloseTo(1, 5); // 2 alertas / 2h
  });

  it('finds the hour with the most alerts across multiple days', () => {
    const opened = [
      buildOpened('a', '2026-08-01T15:10:00.000Z'), // 10:00 Bogotá, día 1
      buildOpened('b', '2026-08-01T15:40:00.000Z'), // mismo bucket
      buildOpened('c', '2026-08-02T15:10:00.000Z'), // 10:00 Bogotá, día 2
    ];

    const metrics = calculateSummaryMetrics(
      opened,
      [],
      processStartedAt,
      new Date('2026-08-03T00:00:00.000Z'),
    );

    expect(metrics.bestAlertsHour?.value).toBe(2);
    expect(metrics.bestAlertsHour?.label).toBe('01/08 10:00');
  });

  it('finds the best and worst effectiveness hour, ignoring hours with no closed operations', () => {
    const closed = [
      // 10:00 Bogotá: 2/2 = 100%
      buildClosed('a', '2026-08-01T15:00:00.000Z', {
        result: OperationState.WON,
      }),
      buildClosed('b', '2026-08-01T15:05:00.000Z', {
        result: OperationState.WON,
      }),
      // 11:00 Bogotá: 0/2 = 0%
      buildClosed('c', '2026-08-01T16:00:00.000Z', {
        result: OperationState.LOST,
      }),
      buildClosed('d', '2026-08-01T16:05:00.000Z', {
        result: OperationState.LOST,
      }),
    ];

    const metrics = calculateSummaryMetrics([], closed, processStartedAt, now);

    expect(metrics.bestEffectivenessHour?.value).toBe(100);
    expect(metrics.bestEffectivenessHour?.label).toBe('01/08 10:00');
    expect(metrics.worstEffectivenessHour?.value).toBe(0);
    expect(metrics.worstEffectivenessHour?.label).toBe('01/08 11:00');
    expect(metrics.avgEffectivenessPerHour).toBeCloseTo(50, 2);
  });
});
