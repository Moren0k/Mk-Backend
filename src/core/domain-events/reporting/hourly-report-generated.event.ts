import { ReportSnapshot } from '../../reporting/types/report-snapshot.type';
import { AbstractDomainEvent } from '../base/domain-event';

/**
 * Se publica cuando ReportScheduler cierra un bloque horario dentro del
 * horario operativo del bot (10:00 a 24:00 hora de Bogotá).
 */
export class HourlyReportGeneratedEvent extends AbstractDomainEvent<ReportSnapshot> {
  static readonly eventName = 'HourlyReportGeneratedEvent';

  constructor(snapshot: ReportSnapshot) {
    super(HourlyReportGeneratedEvent.eventName, 1, snapshot);
  }
}
