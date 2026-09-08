import { Module } from '@nestjs/common';

import {
  RACHA3_ANALYTICS_READER,
  RACHA3_PROCESSOR,
} from '../../core/constants/injection-tokens.constants';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { PrismaRacha3AnalyticsReader } from '../../infrastructure/persistence/analytics/prisma-racha3-analytics.reader';
import { PrismaRacha3Processor } from '../../infrastructure/persistence/analytics/prisma-racha3.processor';
import { ErrorTrackingModule } from '../observability/error-tracking.module';
import { Racha3AnalyticsReadModel } from './racha3-analytics.read-model';
import { Racha3IncrementalScheduler } from './racha3-incremental.scheduler';

/**
 * Analytics histórico de Racha 3.
 *
 * Módulo completamente desacoplado del motor de alertas: no se suscribe al
 * DomainEventBus, no conoce Strategy, Operation ni Notification, y ninguno
 * de ellos lo conoce a él. Si este módulo falla o queda deshabilitado (sin
 * DATABASE_URL), la detección de rachas y el envío de alertas siguen
 * funcionando exactamente igual.
 *
 * El bind del token vive acá y no en PersistenceModule, siguiendo el mismo
 * criterio que ReportingModule con REPORT_CHECKPOINT_STORE: la
 * infraestructura exporta la clase concreta y es el módulo de aplicación
 * quien decide a qué contrato del dominio la enlaza.
 */
@Module({
  imports: [PersistenceModule, ErrorTrackingModule],
  providers: [
    // Dos puertas separadas a propósito: `Racha3Processor` es la única que
    // escribe, `Racha3AnalyticsReader` sólo lee. Partirlas hace que el tipo
    // de cada consumidor declare qué puede hacer, en vez de dejarlo a la
    // disciplina de quien lo use.
    {
      provide: RACHA3_PROCESSOR,
      useExisting: PrismaRacha3Processor,
    },
    {
      provide: RACHA3_ANALYTICS_READER,
      useExisting: PrismaRacha3AnalyticsReader,
    },
    Racha3IncrementalScheduler,
    Racha3AnalyticsReadModel,
  ],
  exports: [Racha3IncrementalScheduler, Racha3AnalyticsReadModel],
})
export class AnalyticsModule {}
