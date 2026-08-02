import { Module } from '@nestjs/common';

import { CollectorModule } from '../../infrastructure/collector/collector.module';
import { DomainEventBusModule } from '../domain-events/domain-event-bus.module';
import { HistoryModule } from '../history/history.module';
import { NotificationModule } from '../notification/notification.module';
import { OperationModule } from '../operation/operation.module';
import { StrategyModule } from '../strategy/strategy.module';
import { EngineHealth } from './engine-health';
import { EngineMetricsService } from './engine-metrics.service';
import { ErrorTrackingModule } from './error-tracking.module';

/**
 * Une EngineMetricsService (acumula vía eventos) y EngineHealth (consulta
 * el estado actual de los demás módulos) en un único punto de arranque.
 *
 * Importa CollectorModule/OperationModule/StrategyModule/NotificationModule
 * para leer lo que exportan (GameEventCollector, OperationCoordinator,
 * STRATEGIES, NOTIFICATION_CHANNELS); ninguno de ellos importa de vuelta a
 * este módulo, por lo que no hay dependencia circular.
 */
@Module({
  imports: [
    DomainEventBusModule,
    HistoryModule,
    CollectorModule,
    OperationModule,
    StrategyModule,
    NotificationModule,
    ErrorTrackingModule,
  ],
  providers: [EngineMetricsService, EngineHealth],
  exports: [EngineMetricsService, EngineHealth],
})
export class ObservabilityModule {}
