/**
 * Tokens de inyección de dependencias.
 *
 * Viven en core como simples valores de TypeScript, sin importar NestJS,
 * para que las interfaces del dominio puedan enlazarse a una implementación
 * concreta desde application/infrastructure sin que core conozca el framework.
 */
export const HISTORY_STORE = Symbol('HistoryStore');
export const DOMAIN_EVENT_BUS = Symbol('DomainEventBus');
export const STRATEGIES = Symbol('Strategies');
export const NOTIFICATION_CHANNELS = Symbol('NotificationChannels');
export const STRATEGY_EXECUTION_GUARD = Symbol('StrategyExecutionGuard');
