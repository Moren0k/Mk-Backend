import { SummaryReportService } from '../../../application/reporting/summary-report.service';
import type { SummaryMetricsSnapshot } from '../../../core/reporting/types/summary-metrics-snapshot.type';
import { ReportsController } from './reports.controller';

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
    uptimeMs: 1_000,
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

function buildSummaryReportService(): jest.Mocked<
  Pick<SummaryReportService, 'getSnapshot'>
> {
  return {
    getSnapshot: jest.fn().mockReturnValue({
      oficial: buildChannelSnapshot({ won: 3, lost: 1, alertsSent: 4 }),
      pruebas: buildChannelSnapshot({ won: 0, lost: 0, alertsSent: 0 }),
    }),
  };
}

describe('ReportsController', () => {
  it('returns the summary snapshot mapped to ReportsSummaryVm, without dispatching anything', () => {
    const service = buildSummaryReportService();
    const controller = new ReportsController(
      service as unknown as SummaryReportService,
    );

    const result = controller.getSummary();

    expect(service.getSnapshot).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      uptimeMs: 1_000,
      oficial: { won: 3, lost: 1, alertsSent: 4 },
      pruebas: { won: 0, lost: 0, alertsSent: 0 },
    });
  });
});
