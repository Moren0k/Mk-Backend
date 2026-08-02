import { DomainEvent } from './domain-event';
import { DomainEventHandler } from './domain-event-handler.interface';

/**
 * Contrato del bus de eventos del dominio.
 *
 * Únicamente registra/elimina listeners y publica eventos, de forma
 * completamente síncrona y en memoria. No conoce HistoryStore, Strategy,
 * Telegram, Operation ni NestJS: es reutilizable en cualquier contexto.
 *
 * La suscripción se hace por `eventName` (la constante estática que cada
 * evento concreto expone, p.ej. `GameReceivedEvent.eventName`), nunca por
 * un string arbitrario inventado por quien se suscribe.
 */
export interface DomainEventBus {
  subscribe<TEvent extends DomainEvent>(
    eventName: string,
    handler: DomainEventHandler<TEvent>,
  ): void;

  unsubscribe<TEvent extends DomainEvent>(
    eventName: string,
    handler: DomainEventHandler<TEvent>,
  ): void;

  publish<TEvent extends DomainEvent>(event: TEvent): void;

  publishMany<TEvent extends DomainEvent>(events: ReadonlyArray<TEvent>): void;

  /** Elimina todas las suscripciones. Pensado para aislar tests. */
  clear(): void;
}
