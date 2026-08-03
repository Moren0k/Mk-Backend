import { ReportMetricsSnapshot } from './report-metrics-snapshot.type';

/**
 * Payload que viaja en HourlyReportGeneratedEvent. `windowFrom`/`windowTo`
 * son instantes reales (UTC); quien construya el mensaje decide en qué
 * timezone mostrarlos (ver report-clock.ts).
 */
export type ReportSnapshot = {
  readonly windowFrom: Date;
  readonly windowTo: Date;
  readonly metrics: ReportMetricsSnapshot;
};
