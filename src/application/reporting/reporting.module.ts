import { Module } from '@nestjs/common';

import {
  OPERATION_REPORT_STORE,
  REPORT_CHECKPOINT_STORE,
} from '../../core/constants/injection-tokens.constants';
import { InMemoryOperationReportStore } from '../../core/reporting/in-memory-operation-report-store';
import { PrismaReportCheckpointStore } from '../../infrastructure/persistence/prisma-report-checkpoint-store';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { DomainEventBusModule } from '../domain-events/domain-event-bus.module';
import { ErrorTrackingModule } from '../observability/error-tracking.module';
import { NotificationModule } from '../notification/notification.module';
import { OperationReportRecorder } from './operation-report-recorder';
import { ReportCheckpointScheduler } from './report-checkpoint.scheduler';
import { ReportNotificationCoordinator } from './report-notification.coordinator';
import { ReportScheduler } from './report-scheduler';
import { SummaryReportService } from './summary-report.service';

/**
 * Capacidad de métricas/reportes, completamente independiente del motor de
 * señales: se puede quitar este módulo de AppModule y el resto del bot
 * (Strategy/Operation/Notification/Statistics) sigue funcionando exacto
 * igual. OPERATION_REPORT_STORE hoy apunta a InMemoryOperationReportStore
 * (nunca sobrevive un redeploy); REPORT_CHECKPOINT_STORE apunta a
 * PrismaReportCheckpointStore (Postgres/Supabase, ver PersistenceModule) —
 * ReportCheckpointScheduler lo alimenta periódicamente y
 * SummaryReportService.hydrateFromCheckpoint lo lee al arrancar (invocado
 * explícitamente desde main.ts, ver ARCHITECTURE.md §8), así
 * won/lost/alertsSent/uptimeMs sobreviven un reinicio del proceso aunque
 * OPERATION_REPORT_STORE no.
 *
 * Exporta SummaryReportService para que AdminModule pueda invocarlo bajo
 * demanda (comando RESUMEN) sin que este módulo conozca HTTP ni el
 * endpoint admin, y para que main.ts pueda llamar
 * `hydrateFromCheckpoint()` antes de `GameEventCollector.start()`.
 */
@Module({
  imports: [
    DomainEventBusModule,
    ErrorTrackingModule,
    NotificationModule,
    PersistenceModule,
  ],
  providers: [
    { provide: OPERATION_REPORT_STORE, useClass: InMemoryOperationReportStore },
    {
      provide: REPORT_CHECKPOINT_STORE,
      useExisting: PrismaReportCheckpointStore,
    },
    OperationReportRecorder,
    ReportScheduler,
    ReportCheckpointScheduler,
    ReportNotificationCoordinator,
    SummaryReportService,
  ],
  exports: [SummaryReportService],
})
export class ReportingModule {}
