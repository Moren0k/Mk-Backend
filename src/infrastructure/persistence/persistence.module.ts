import { Module } from '@nestjs/common';

import { PrismaRacha3AnalyticsReader } from './analytics/prisma-racha3-analytics.reader';
import { PrismaRacha3Processor } from './analytics/prisma-racha3.processor';
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
 *
 * `PrismaRacha3Processor` sigue exactamente el mismo criterio: se declara y
 * exporta acá como clase concreta, y es AnalyticsModule quien la enlaza al
 * token RACHA3_PROCESSOR. Exportarla es obligatorio, no cosmético: sin eso,
 * el `useExisting` de AnalyticsModule no puede resolverla y la aplicación
 * no arranca (ver analytics.module.spec.ts).
 */
@Module({
  providers: [
    PrismaService,
    PrismaReportCheckpointStore,
    PrismaRacha3Processor,
    PrismaRacha3AnalyticsReader,
  ],
  exports: [
    PrismaService,
    PrismaReportCheckpointStore,
    PrismaRacha3Processor,
    PrismaRacha3AnalyticsReader,
  ],
})
export class PersistenceModule {}
