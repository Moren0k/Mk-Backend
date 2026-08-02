import { EngineMetrics } from './engine-metrics.entity';

describe('EngineMetrics', () => {
  it('starts every counter at zero', () => {
    const metrics = new EngineMetrics();

    expect(metrics.toSnapshot()).toEqual({
      gamesReceived: 0,
      signalsGenerated: 0,
      operationsOpened: 0,
      operationsWon: 0,
      operationsLost: 0,
      martingaleOneReachedCount: 0,
      martingaleTwoReachedCount: 0,
      notificationsSent: 0,
      notificationsFailed: 0,
    });
  });

  it('increments only the counter that was recorded', () => {
    const metrics = new EngineMetrics();

    metrics.recordGameReceived();
    metrics.recordGameReceived();
    metrics.recordSignalGenerated();
    metrics.recordOperationOpened();
    metrics.recordOperationWon();
    metrics.recordOperationLost();
    metrics.recordMartingaleOneReached();
    metrics.recordMartingaleTwoReached();
    metrics.recordNotificationSent();
    metrics.recordNotificationFailed();

    expect(metrics.toSnapshot()).toEqual({
      gamesReceived: 2,
      signalsGenerated: 1,
      operationsOpened: 1,
      operationsWon: 1,
      operationsLost: 1,
      martingaleOneReachedCount: 1,
      martingaleTwoReachedCount: 1,
      notificationsSent: 1,
      notificationsFailed: 1,
    });
  });

  it('returns a frozen snapshot that does not change with later recordings', () => {
    const metrics = new EngineMetrics();
    metrics.recordGameReceived();

    const snapshot = metrics.toSnapshot();
    metrics.recordGameReceived();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.gamesReceived).toBe(1);
    expect(metrics.toSnapshot().gamesReceived).toBe(2);
  });
});
