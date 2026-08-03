import { ReportSnapshot } from '../../reporting/types/report-snapshot.type';
import { AbstractDomainEvent } from '../base/domain-event';

/**
 * Se publica todos los días a las 22:00 hora de Bogotá, con el acumulado
 * desde las 10:00 hasta ese momento.
 */
export class DailyReportGeneratedEvent extends AbstractDomainEvent<ReportSnapshot> {
  static readonly eventName = 'DailyReportGeneratedEvent';

  constructor(snapshot: ReportSnapshot) {
    super(DailyReportGeneratedEvent.eventName, 1, snapshot);
  }
}
