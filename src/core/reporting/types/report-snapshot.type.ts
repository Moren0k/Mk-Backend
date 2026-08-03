import { ReportKind } from './report-kind.enum';
import { ReportMetricsSnapshot } from './report-metrics-snapshot.type';

/**
 * Payload que viaja en HourlyReportGeneratedEvent/DailyReportGeneratedEvent.
 * `windowFrom`/`windowTo` son instantes reales (UTC); quien construya el
 * mensaje decide en qué timezone mostrarlos (ver report-clock.ts).
 */
export type ReportSnapshot = {
  readonly kind: ReportKind;
  readonly windowFrom: Date;
  readonly windowTo: Date;
  readonly metrics: ReportMetricsSnapshot;
};
