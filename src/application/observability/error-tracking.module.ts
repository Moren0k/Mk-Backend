import { Module } from '@nestjs/common';

import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';

/**
 * Módulo hoja (sin imports propios) que provee el único EngineErrorTracker
 * de toda la aplicación. Al no depender de nada, CollectorModule,
 * StrategyModule, OperationModule, NotificationModule y ObservabilityModule
 * pueden importarlo todos sin crear una dependencia circular entre ellos.
 */
@Module({
  providers: [EngineErrorTracker],
  exports: [EngineErrorTracker],
})
export class ErrorTrackingModule {}
