import { StrategyGroup } from '../../strategy/strategy-group';
import { ReportMetricsSnapshot } from './report-metrics-snapshot.type';

/**
 * Payload que viaja en HourlyReportGeneratedEvent. `windowFrom`/`windowTo`
 * son instantes reales (UTC); quien construya el mensaje decide en qué
 * timezone mostrarlos (ver report-clock.ts). `group` identifica a qué
 * canal corresponde este snapshot: ReportScheduler publica un evento por
 * grupo, y ReportNotificationCoordinator lo usa para enrutar sin volver a
 * inspeccionar los registros originales.
 */
export type ReportSnapshot = {
  readonly windowFrom: Date;
  readonly windowTo: Date;
  readonly group: StrategyGroup;
  readonly metrics: ReportMetricsSnapshot;
};
