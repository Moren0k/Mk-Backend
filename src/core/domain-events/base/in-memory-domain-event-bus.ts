import { DomainEvent } from './domain-event';
import { DomainEventBus } from './domain-event-bus.interface';
import { DomainEventHandler } from './domain-event-handler.interface';

/**
 * Implementación en memoria del DomainEventBus. Sin EventEmitter de Node,
 * sin librerías externas, sin persistencia ni colas: todo síncrono.
 *
 * Ningún consumidor externo debe importar esta clase directamente, solo el
 * contrato DomainEventBus (mismo patrón que InMemoryHistoryStore).
 */
export class InMemoryDomainEventBus implements DomainEventBus {
  private readonly handlersByEvent = new Map<string, DomainEventHandler[]>();

  subscribe<TEvent extends DomainEvent>(
    eventName: string,
    handler: DomainEventHandler<TEvent>,
  ): void {
    const handlers = this.handlersByEvent.get(eventName) ?? [];
    // El bus solo invoca cada handler con eventos de su propio eventName,
    // por lo que en la práctica siempre recibirá el TEvent con el que se
    // registró, aunque el mapa lo almacene con el tipo base DomainEvent.
    handlers.push(handler);
    this.handlersByEvent.set(eventName, handlers);
  }

  unsubscribe<TEvent extends DomainEvent>(
    eventName: string,
    handler: DomainEventHandler<TEvent>,
  ): void {
    const handlers = this.handlersByEvent.get(eventName);
    if (!handlers) {
      return;
    }

    const remaining = handlers.filter((registered) => registered !== handler);
    if (remaining.length > 0) {
      this.handlersByEvent.set(eventName, remaining);
    } else {
      this.handlersByEvent.delete(eventName);
    }
  }

  publish<TEvent extends DomainEvent>(event: TEvent): void {
    const handlers = this.handlersByEvent.get(event.eventName);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      this.runHandler(handler, event);
    }
  }

  publishMany<TEvent extends DomainEvent>(events: ReadonlyArray<TEvent>): void {
    for (const event of events) {
      this.publish(event);
    }
  }

  clear(): void {
    this.handlersByEvent.clear();
  }

  private runHandler(handler: DomainEventHandler, event: DomainEvent): void {
    try {
      handler.handle(event);
    } catch (error) {
      // Núcleo puro: no puede depender del Logger de NestJS. `console.error`
      // es el único mecanismo de registro disponible sin acoplarse a un
      // framework, y nunca debe detener al resto de los subscribers.

      console.error(
        `[DomainEventBus] Un subscriber falló manejando "${event.eventName}" (eventId=${event.eventId}).`,
        error,
      );
    }
  }
}
