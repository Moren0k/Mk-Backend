/**
 * Catálogo cerrado de eventos públicos que viaja por SSE (Mk-Api.md
 * §13.4, Anexo D §9/§10). Nunca un `DomainEvent` crudo: cada tipo tiene
 * su propia proyección explícita en `EventsReadModel`.
 */
export type PublicEventType =
  | 'game.received'
  | 'stats.rolling'
  | 'operation.opened'
  | 'operation.mg1'
  | 'operation.mg2'
  | 'operation.tie'
  | 'operation.won'
  | 'operation.lost'
  | 'operation.cancelled';

export type PublicEvent = {
  readonly type: PublicEventType;
  readonly payload: unknown;
  readonly occurredAt: string;
};
