import { OperationState } from '../enums/operation-state.enum';
import { calculateReportMetrics } from './report-metrics.calculator';
import { OperationClosedRecord } from './types/operation-closed-record.type';
import { OperationOpenedRecord } from './types/operation-opened-record.type';

function buildOpened(operationId: string): OperationOpenedRecord {
  return { operationId, openedAt: new Date('2026-08-01T15:00:00.000Z') };
}

function buildClosed(
  overrides: Partial<OperationClosedRecord> = {},
): OperationClosedRecord {
  return {
    operationId: 'op-1',
    openedAt: new Date('2026-08-01T15:00:00.000Z'),
    closedAt: new Date('2026-08-01T15:05:00.000Z'),
    result: OperationState.WON,
    martingalesUsed: 0,
    maxMartingales: 2,
    ...overrides,
  };
}

describe('calculateReportMetrics', () => {
  it('returns all zeros for an empty window', () => {
    expect(calculateReportMetrics([], [])).toEqual({
      alertsSent: 0,
      closedOperations: 0,
      won: 0,
      lost: 0,
      effectivenessPct: 0,
      directWins: 0,
      martingaleOneWins: 0,
      martingaleTwoWins: 0,
      martingalesExhausted: 0,
      distribution: {
        directPct: 0,
        martingaleOnePct: 0,
        martingaleTwoPct: 0,
        lostPct: 0,
      },
    });
  });

  it('counts alertsSent independently of closedOperations', () => {
    const opened = [
      buildOpened('op-1'),
      buildOpened('op-2'),
      buildOpened('op-3'),
    ];

    const metrics = calculateReportMetrics(opened, []);

    expect(metrics.alertsSent).toBe(3);
    expect(metrics.closedOperations).toBe(0);
  });

  it('classifies wins by martingalesUsed: direct, MG1, MG2', () => {
    const closed = [
      buildClosed({ operationId: 'a', martingalesUsed: 0 }),
      buildClosed({ operationId: 'b', martingalesUsed: 1 }),
      buildClosed({ operationId: 'c', martingalesUsed: 2 }),
    ];

    const metrics = calculateReportMetrics([], closed);

    expect(metrics.won).toBe(3);
    expect(metrics.directWins).toBe(1);
    expect(metrics.martingaleOneWins).toBe(1);
    expect(metrics.martingaleTwoWins).toBe(1);
  });

  it('counts a loss that exhausted every martingale', () => {
    const closed = [
      buildClosed({
        result: OperationState.LOST,
        martingalesUsed: 2,
        maxMartingales: 2,
      }),
    ];

    const metrics = calculateReportMetrics([], closed);

    expect(metrics.lost).toBe(1);
    expect(metrics.martingalesExhausted).toBe(1);
  });

  it('does not count a loss that stopped before the last martingale as "exhausted"', () => {
    const closed = [
      buildClosed({
        result: OperationState.LOST,
        martingalesUsed: 1,
        maxMartingales: 2,
      }),
    ];

    const metrics = calculateReportMetrics([], closed);

    expect(metrics.lost).toBe(1);
    expect(metrics.martingalesExhausted).toBe(0);
  });

  it('respects a per-operation maxMartingales different from 2', () => {
    const closed = [
      buildClosed({
        result: OperationState.LOST,
        martingalesUsed: 1,
        maxMartingales: 1,
      }),
    ];

    const metrics = calculateReportMetrics([], closed);

    expect(metrics.martingalesExhausted).toBe(1);
  });

  it('computes effectiveness as won / closedOperations, rounded to 2 decimals', () => {
    const closed = [
      buildClosed({ operationId: 'a', result: OperationState.WON }),
      buildClosed({ operationId: 'b', result: OperationState.WON }),
      buildClosed({ operationId: 'c', result: OperationState.LOST }),
    ];

    const metrics = calculateReportMetrics([], closed);

    expect(metrics.effectivenessPct).toBeCloseTo(66.67, 2);
  });

  it('computes the outcome distribution as percentages of closedOperations', () => {
    const closed = [
      buildClosed({ operationId: 'a', martingalesUsed: 0 }), // directa
      buildClosed({ operationId: 'b', martingalesUsed: 1 }), // MG1
      buildClosed({
        operationId: 'c',
        result: OperationState.LOST,
        martingalesUsed: 2,
      }), // perdida
      buildClosed({
        operationId: 'd',
        result: OperationState.LOST,
        martingalesUsed: 2,
      }), // perdida
    ];

    const metrics = calculateReportMetrics([], closed);

    expect(metrics.distribution.directPct).toBeCloseTo(25, 2);
    expect(metrics.distribution.martingaleOnePct).toBeCloseTo(25, 2);
    expect(metrics.distribution.martingaleTwoPct).toBeCloseTo(0, 2);
    expect(metrics.distribution.lostPct).toBeCloseTo(50, 2);
  });

  it('never divides by zero: all rates are 0 when there are no closed operations', () => {
    const metrics = calculateReportMetrics([buildOpened('op-1')], []);

    expect(metrics.effectivenessPct).toBe(0);
    expect(metrics.distribution.directPct).toBe(0);
    expect(metrics.distribution.lostPct).toBe(0);
  });
});
