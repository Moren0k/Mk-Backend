import { Module } from '@nestjs/common';

import { DomainEventBusModule } from '../domain-events/domain-event-bus.module';
import { HistoryModule } from '../history/history.module';
import { OperationModule } from '../operation/operation.module';
import { StrategyChannelRegistryModule } from '../strategy/strategy-channel-registry.module';
import { StrategyModule } from '../strategy/strategy.module';
import { EventsReadModel } from './events.read-model';
import { HistoryReadModel } from './history.read-model';
import { OperationsReadModel } from './operations.read-model';
import { RollingStatsReadModel } from './rolling-stats.read-model';
import { StrategyCatalogReadModel } from './strategy-catalog.read-model';

/**
 * Agrupa los read-models de solo lectura que consume `src/api/` (Mk-Api.md
 * §5.2/§10.2): proyectan estado del motor a una forma pública, sin
 * agregar reglas de negocio nuevas.
 */
@Module({
  imports: [
    HistoryModule,
    OperationModule,
    StrategyChannelRegistryModule,
    StrategyModule,
    DomainEventBusModule,
  ],
  providers: [
    HistoryReadModel,
    OperationsReadModel,
    RollingStatsReadModel,
    EventsReadModel,
    StrategyCatalogReadModel,
  ],
  exports: [
    HistoryReadModel,
    OperationsReadModel,
    EventsReadModel,
    StrategyCatalogReadModel,
  ],
})
export class ReadModelsModule {}
