import { randomUUID } from 'node:crypto';

/**
 * Contrato mínimo de todo evento del dominio.
 *
 * Solo se permiten eventos del dominio (GameReceivedEvent,
 * OperationOpenedEvent, ...), nunca eventos genéricos tipo "message" o
 * "notification": eso es justamente lo que distingue a un Domain Event Bus
 * de un EventEmitter cualquiera.
 */
export interface DomainEvent<TPayload = unknown> {
  readonly eventId: string;
  readonly eventName: string;
  readonly eventVersion: number;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}

/**
 * Base para implementar eventos concretos sin duplicar en cada uno la
 * generación de eventId/occurredAt. No es parte del contrato público: el
 * resto del proyecto (DomainEventBus, subscribers) solo depende de
 * DomainEvent.
 */
export abstract class AbstractDomainEvent<
  TPayload,
> implements DomainEvent<TPayload> {
  readonly eventId: string;
  readonly occurredAt: Date;

  protected constructor(
    readonly eventName: string,
    readonly eventVersion: number,
    readonly payload: TPayload,
  ) {
    this.eventId = randomUUID();
    this.occurredAt = new Date();
  }
}
