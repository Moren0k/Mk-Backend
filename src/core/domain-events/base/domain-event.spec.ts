import { AbstractDomainEvent } from './domain-event';

class SampleEvent extends AbstractDomainEvent<{ readonly value: number }> {
  static readonly eventName = 'SampleEvent';

  constructor(value: number) {
    super(SampleEvent.eventName, 1, { value });
  }
}

describe('AbstractDomainEvent', () => {
  it('carries eventName, eventVersion and payload as given', () => {
    const event = new SampleEvent(42);

    expect(event.eventName).toBe('SampleEvent');
    expect(event.eventVersion).toBe(1);
    expect(event.payload).toEqual({ value: 42 });
  });

  it('auto-generates a unique eventId per instance', () => {
    const first = new SampleEvent(1);
    const second = new SampleEvent(1);

    expect(first.eventId).toEqual(expect.any(String));
    expect(first.eventId).not.toBe(second.eventId);
  });

  it('auto-generates occurredAt as a Date', () => {
    const before = Date.now();
    const event = new SampleEvent(1);
    const after = Date.now();

    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(event.occurredAt.getTime()).toBeLessThanOrEqual(after);
  });
});
