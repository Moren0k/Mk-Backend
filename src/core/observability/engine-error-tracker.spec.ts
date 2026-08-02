import { EngineErrorTracker } from './engine-error-tracker';

describe('EngineErrorTracker', () => {
  it('has no last error initially', () => {
    const tracker = new EngineErrorTracker();

    expect(tracker.getLastError()).toBeUndefined();
  });

  it('records a message with a timestamp', () => {
    const tracker = new EngineErrorTracker();
    const before = Date.now();

    tracker.recordError('boom');

    const lastError = tracker.getLastError();
    expect(lastError?.message).toBe('boom');
    expect(lastError?.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('keeps only the most recent error', () => {
    const tracker = new EngineErrorTracker();

    tracker.recordError('first');
    tracker.recordError('second');

    expect(tracker.getLastError()?.message).toBe('second');
  });

  it('returns a frozen error record', () => {
    const tracker = new EngineErrorTracker();

    tracker.recordError('boom');

    expect(Object.isFrozen(tracker.getLastError())).toBe(true);
  });
});
