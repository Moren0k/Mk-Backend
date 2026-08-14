import { Module, Provider } from '@nestjs/common';

import { STRATEGIES } from '../../core/constants/injection-tokens.constants';
import { Streak3Strategy } from '../../core/strategy/strategies/streak3.strategy';
import { Streak4Strategy } from '../../core/strategy/strategies/streak4.strategy';
import { DomainEventBusModule } from '../domain-events/domain-event-bus.module';
import { HistoryModule } from '../history/history.module';
import { OperationModule } from '../operation/operation.module';
import { ErrorTrackingModule } from '../observability/error-tracking.module';
import { InMemoryStrategyRuntimeState } from './in-memory-strategy-runtime-state';
import { StrategyChannelRegistryModule } from './strategy-channel-registry.module';
import { StrategyCoordinator } from './strategy.coordinator';

/**
 * NestJS no tiene "multi providers" nativos como Angular: dos providers
 * registrados bajo el mismo token se pisan entre sí, no se acumulan. Para
 * exponer varias estrategias bajo un único token (STRATEGIES) sin que
 * StrategyCoordinator conozca cuántas ni cuáles son, cada estrategia se
 * registra como su propio provider y este factory las agrupa en un arreglo.
 *
 * Agregar una nueva estrategia: sumarla a `providers`, a `inject` y al
 * arreglo que arma el factory. StrategyCoordinator nunca cambia.
 */
const strategiesProvider: Provider = {
  provide: STRATEGIES,
  useFactory: (streak3: Streak3Strategy, streak4: Streak4Strategy) => [
    streak3,
    streak4,
  ],
  inject: [Streak3Strategy, Streak4Strategy],
};

@Module({
  imports: [
    HistoryModule,
    DomainEventBusModule,
    ErrorTrackingModule,
    OperationModule,
    StrategyChannelRegistryModule,
  ],
  providers: [
    StrategyCoordinator,
    Streak3Strategy,
    Streak4Strategy,
    strategiesProvider,
    InMemoryStrategyRuntimeState,
  ],
  exports: [STRATEGIES],
})
export class StrategyModule {}
