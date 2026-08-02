import { AbstractDomainEvent } from './domain-event';
import { DomainEventHandler } from './domain-event-handler.interface';
import { InMemoryDomainEventBus } from './in-memory-domain-event-bus';

class TestEvent extends AbstractDomainEvent<{ readonly value: number }> {
  static readonly eventName = 'TestEvent';

  constructor(value: number) {
    super(TestEvent.eventName, 1, { value });
  }
}

class OtherEvent extends AbstractDomainEvent<{ readonly value: string }> {
  static readonly eventName = 'OtherEvent';

  constructor(value: string) {
    super(OtherEvent.eventName, 1, { value });
  }
}

function buildRecordingHandler(): DomainEventHandler<TestEvent> & {
  readonly calls: TestEvent[];
} {
  const calls: TestEvent[] = [];
  return {
    calls,
    handle(event: TestEvent) {
      calls.push(event);
    },
  };
}

describe('InMemoryDomainEventBus', () => {
  let bus: InMemoryDomainEventBus;

  beforeEach(() => {
    bus = new InMemoryDomainEventBus();
  });

  it('does nothing when publishing an event with no subscribers', () => {
    expect(() => bus.publish(new TestEvent(1))).not.toThrow();
  });

  it('delivers a published event to a subscribed handler', () => {
    const handler = buildRecordingHandler();
    bus.subscribe(TestEvent.eventName, handler);

    const event = new TestEvent(1);
    bus.publish(event);

    expect(handler.calls).toEqual([event]);
  });

  it('only notifies handlers subscribed to the matching event name', () => {
    const testHandler = buildRecordingHandler();
    const otherCalls: OtherEvent[] = [];

    bus.subscribe(TestEvent.eventName, testHandler);
    bus.subscribe(OtherEvent.eventName, {
      handle: (event) => otherCalls.push(event),
    });

    bus.publish(new TestEvent(1));

    expect(testHandler.calls).toHaveLength(1);
    expect(otherCalls).toHaveLength(0);
  });

  it('notifies multiple subscribers in registration order', () => {
    const order: string[] = [];
    bus.subscribe(TestEvent.eventName, { handle: () => order.push('first') });
    bus.subscribe(TestEvent.eventName, { handle: () => order.push('second') });
    bus.subscribe(TestEvent.eventName, { handle: () => order.push('third') });

    bus.publish(new TestEvent(1));

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('stops notifying a handler after unsubscribe', () => {
    const handler = buildRecordingHandler();
    bus.subscribe(TestEvent.eventName, handler);

    bus.unsubscribe(TestEvent.eventName, handler);
    bus.publish(new TestEvent(1));

    expect(handler.calls).toHaveLength(0);
  });

  it('leaves other subscribers untouched when unsubscribing one handler', () => {
    const removed = buildRecordingHandler();
    const kept = buildRecordingHandler();
    bus.subscribe(TestEvent.eventName, removed);
    bus.subscribe(TestEvent.eventName, kept);

    bus.unsubscribe(TestEvent.eventName, removed);
    bus.publish(new TestEvent(1));

    expect(removed.calls).toHaveLength(0);
    expect(kept.calls).toHaveLength(1);
  });

  it('unsubscribe is a no-op for a handler that was never subscribed', () => {
    const handler = buildRecordingHandler();

    expect(() => bus.unsubscribe(TestEvent.eventName, handler)).not.toThrow();
  });

  it('keeps running the remaining subscribers when one of them throws, and logs the error', () => {
    const order: string[] = [];
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    bus.subscribe(TestEvent.eventName, {
      handle: () => {
        order.push('first');
        throw new Error('boom');
      },
    });
    bus.subscribe(TestEvent.eventName, {
      handle: () => order.push('second'),
    });

    expect(() => bus.publish(new TestEvent(1))).not.toThrow();

    expect(order).toEqual(['first', 'second']);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it('publishMany publishes every event, in order, to their respective subscribers', () => {
    const testCalls: TestEvent[] = [];
    const otherCalls: OtherEvent[] = [];
    bus.subscribe(TestEvent.eventName, {
      handle: (event) => testCalls.push(event),
    });
    bus.subscribe(OtherEvent.eventName, {
      handle: (event) => otherCalls.push(event),
    });

    const first = new TestEvent(1);
    const second = new OtherEvent('a');
    const third = new TestEvent(2);

    bus.publishMany([first, second, third]);

    expect(testCalls).toEqual([first, third]);
    expect(otherCalls).toEqual([second]);
  });

  it('clear() removes every subscription', () => {
    const handler = buildRecordingHandler();
    bus.subscribe(TestEvent.eventName, handler);

    bus.clear();
    bus.publish(new TestEvent(1));

    expect(handler.calls).toHaveLength(0);
  });
});
