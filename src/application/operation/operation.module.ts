import { Module } from '@nestjs/common';

import { STRATEGY_EXECUTION_GUARD } from '../../core/constants/injection-tokens.constants';
import { DomainEventBusModule } from '../domain-events/domain-event-bus.module';
import { ErrorTrackingModule } from '../observability/error-tracking.module';
import { ActiveOperationRegistry } from './active-operation-registry';
import { OperationCoordinator } from './operation.coordinator';

/**
 * Punto de registro del OperationCoordinator y las operaciones activas.
 *
 * ActiveOperationRegistry también se expone bajo el token
 * STRATEGY_EXECUTION_GUARD: es la misma instancia, pero cualquier módulo que
 * importe este (por ejemplo StrategyModule) solo puede pedirla a través de
 * esa interfaz, nunca de la clase concreta.
 */
@Module({
  imports: [DomainEventBusModule, ErrorTrackingModule],
  providers: [
    OperationCoordinator,
    ActiveOperationRegistry,
    { provide: STRATEGY_EXECUTION_GUARD, useExisting: ActiveOperationRegistry },
  ],
  exports: [OperationCoordinator, STRATEGY_EXECUTION_GUARD],
})
export class OperationModule {}
