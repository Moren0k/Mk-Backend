import { Module } from '@nestjs/common';

import { PrismaReportCheckpointStore } from './prisma-report-checkpoint-store';
import { PrismaService } from './prisma.service';

/**
 * Infraestructura de persistencia (PostgreSQL vía Supabase + Prisma).
 *
 * Módulo desacoplado del resto del motor: no lo importan ni lo conocen
 * StrategyModule, OperationModule ni NotificationModule. `PrismaService` es
 * el único punto de conexión; `PrismaReportCheckpointStore` (implementación
 * real de `ReportCheckpointStore`, ver core/reporting/interfaces/) es
 * consumido por ReportingModule, que hace el bind al token
 * REPORT_CHECKPOINT_STORE — este módulo no conoce ese token, solo exporta
 * la clase concreta.
 */
@Module({
  providers: [PrismaService, PrismaReportCheckpointStore],
  exports: [PrismaService, PrismaReportCheckpointStore],
})
export class PersistenceModule {}
