import { DomainEvent } from './domain-event';

/**
 * Contrato para cualquier subscriber del DomainEventBus.
 *
 * Ejemplos futuros: StrategyCoordinator, StatisticsService,
 * DashboardGateway, AuditService (todos escuchando GameReceivedEvent).
 */
export interface DomainEventHandler<TEvent extends DomainEvent = DomainEvent> {
  handle(event: TEvent): void;
}
