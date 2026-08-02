import { Module } from '@nestjs/common';

import { DOMAIN_EVENT_BUS } from '../../core/constants/injection-tokens.constants';
import { InMemoryDomainEventBus } from '../../core/domain-events/base/in-memory-domain-event-bus';

/**
 * Único lugar del proyecto que conoce InMemoryDomainEventBus.
 *
 * El resto de módulos solo debe inyectar el token DOMAIN_EVENT_BUS y
 * depender del contrato DomainEventBus, nunca de esta implementación
 * concreta (mismo patrón que HistoryModule con HISTORY_STORE).
 */
@Module({
  providers: [
    {
      provide: DOMAIN_EVENT_BUS,
      useClass: InMemoryDomainEventBus,
    },
  ],
  exports: [DOMAIN_EVENT_BUS],
})
export class DomainEventBusModule {}
