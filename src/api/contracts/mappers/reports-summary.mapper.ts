import type { SummaryReportResult } from '../../../core/reporting/types/summary-report-result.type';
import type {
  ReportsChannelSummaryVm,
  ReportsSummaryVm,
} from '../view-models/reports-summary.vm';

function toChannelSummary(
  snapshot: SummaryReportResult['oficial'],
): ReportsChannelSummaryVm {
  return {
    won: snapshot.won,
    lost: snapshot.lost,
    alertsSent: snapshot.alertsSent,
  };
}

export function toReportsSummaryVm(
  result: SummaryReportResult,
): ReportsSummaryVm {
  return {
    uptimeMs: result.oficial.uptimeMs,
    oficial: toChannelSummary(result.oficial),
  };
}
