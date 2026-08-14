import type { SummaryReportResult } from '../../../core/reporting/types/summary-report-result.type';
import type { SummaryMetricsSnapshot } from '../../../core/reporting/types/summary-metrics-snapshot.type';
import { toReportsSummaryVm } from './reports-summary.mapper';

function buildChannelSnapshot(
  overrides: Partial<SummaryMetricsSnapshot> = {},
): SummaryMetricsSnapshot {
  return {
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
    uptimeMs: 3_600_000,
    bestWinStreak: 0,
    worstLossStreak: 0,
    currentStreak: { result: 'NONE', length: 0 },
    totalMartingalesUsed: 0,
    avgMartingalesPerWin: 0,
    directWinPctOfWins: 0,
    martingaleOneWinPctOfWins: 0,
    martingaleTwoWinPctOfWins: 0,
    winLossRatio: 0,
    alertsPerHourAvg: 0,
    avgEffectivenessPerHour: 0,
    ...overrides,
  };
}

describe('toReportsSummaryVm', () => {
  it('projects won/lost/alertsSent per channel and hoists uptimeMs to the root', () => {
    const result: SummaryReportResult = {
      oficial: buildChannelSnapshot({ won: 5, lost: 2, alertsSent: 7 }),
      pruebas: buildChannelSnapshot({
        won: 1,
        lost: 3,
        alertsSent: 4,
        uptimeMs: 3_600_000,
      }),
    };

    expect(toReportsSummaryVm(result)).toEqual({
      uptimeMs: 3_600_000,
      oficial: { won: 5, lost: 2, alertsSent: 7 },
      pruebas: { won: 1, lost: 3, alertsSent: 4 },
    });
  });

  it('drops every other internal metric field, keeping only won/lost/alertsSent per channel', () => {
    const result: SummaryReportResult = {
      oficial: buildChannelSnapshot({ bestWinStreak: 9 }),
      pruebas: buildChannelSnapshot(),
    };

    const vm = toReportsSummaryVm(result);

    expect(vm.oficial).not.toHaveProperty('bestWinStreak');
    expect(vm.oficial).not.toHaveProperty('distribution');
  });
});
