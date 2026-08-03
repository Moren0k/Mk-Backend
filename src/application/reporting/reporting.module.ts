import { Module } from '@nestjs/common';

import { OPERATION_REPORT_STORE } from '../../core/constants/injection-tokens.constants';
import { InMemoryOperationReportStore } from '../../core/reporting/in-memory-operation-report-store';
import { DomainEventBusModule } from '../domain-events/domain-event-bus.module';
import { ErrorTrackingModule } from '../observability/error-tracking.module';
import { NotificationModule } from '../notification/notification.module';
import { OperationReportRecorder } from './operation-report-recorder';
import { ReportNotificationCoordinator } from './report-notification.coordinator';
import { ReportScheduler } from './report-scheduler';
import { SummaryReportService } from './summary-report.service';

/**
 * Capacidad de métricas/reportes, completamente independiente del motor de
 * señales: se puede quitar este módulo de AppModule y el resto del bot
 * (Strategy/Operation/Notification/Statistics) sigue funcionando exacto
 * igual. OPERATION_REPORT_STORE hoy apunta a InMemoryOperationReportStore;
 * el día que exista base de datos, esta es la única línea que cambia.
 *
 * Exporta SummaryReportService para que AdminModule pueda invocarlo bajo
 * demanda (comando RESUMEN) sin que este módulo conozca HTTP ni el
 * endpoint admin.
 */
@Module({
  imports: [DomainEventBusModule, ErrorTrackingModule, NotificationModule],
  providers: [
    { provide: OPERATION_REPORT_STORE, useClass: InMemoryOperationReportStore },
    OperationReportRecorder,
    ReportScheduler,
    ReportNotificationCoordinator,
    SummaryReportService,
  ],
  exports: [SummaryReportService],
})
export class ReportingModule {}
