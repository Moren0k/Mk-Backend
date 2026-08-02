import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import { HistoryStore } from '../../core/interfaces/history-store.interface';
import { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { Strategy } from '../../core/strategy/interfaces/strategy.interface';
import { CollectorStatus } from '../../infrastructure/collector/collector-status.enum';
import { GameEventCollector } from '../../infrastructure/collector/game-event-collector';
import { OperationCoordinator } from '../operation/operation.coordinator';
import { EngineHealth } from './engine-health';

function buildGame(): Game {
  return {
    uuid: '1',
    winner: WinnerType.PLAYER,
    score: 8,
    playedAt: new Date('2026-08-01T21:15:03.000Z'),
  };
}

describe('EngineHealth', () => {
  let historyStore: jest.Mocked<HistoryStore>;
  let gameEventCollector: jest.Mocked<Pick<GameEventCollector, 'getStatus'>>;
  let operationCoordinator: jest.Mocked<
    Pick<OperationCoordinator, 'activeCount'>
  >;
  let strategies: Strategy[];
  let channels: NotificationChannel[];
  let errorTracker: EngineErrorTracker;
  let health: EngineHealth;

  beforeEach(() => {
    historyStore = {
      append: jest.fn(),
      exists: jest.fn(),
      findByUuid: jest.fn(),
      getLatest: jest.fn().mockReturnValue(buildGame()),
      getLast: jest.fn(),
      getAll: jest.fn(),
      size: jest.fn().mockReturnValue(42),
      clear: jest.fn(),
      createSnapshot: jest.fn(),
    };

    gameEventCollector = {
      getStatus: jest.fn().mockReturnValue(CollectorStatus.CONNECTED),
    };

    operationCoordinator = {
      activeCount: jest.fn().mockReturnValue(3),
    };

    strategies = [{} as Strategy, {} as Strategy];
    channels = [{} as NotificationChannel];
    errorTracker = new EngineErrorTracker();

    health = new EngineHealth(
      historyStore,
      gameEventCollector as unknown as GameEventCollector,
      operationCoordinator as unknown as OperationCoordinator,
      strategies,
      channels,
      errorTracker,
    );
  });

  it('reports the collector as connected when its status is CONNECTED', () => {
    expect(health.getSnapshot().collectorConnected).toBe(true);
  });

  it('reports the collector as not connected for any other status', () => {
    gameEventCollector.getStatus.mockReturnValue(CollectorStatus.RECONNECTING);

    expect(health.getSnapshot().collectorConnected).toBe(false);
  });

  it('reports the last game received, games in memory, active operations, and registered counts', () => {
    const snapshot = health.getSnapshot();

    expect(snapshot.lastGameReceivedAt).toEqual(
      new Date('2026-08-01T21:15:03.000Z'),
    );
    expect(snapshot.gamesInMemory).toBe(42);
    expect(snapshot.activeOperations).toBe(3);
    expect(snapshot.registeredStrategies).toBe(2);
    expect(snapshot.registeredChannels).toBe(1);
  });

  it('reports undefined lastGameReceivedAt when the history is empty', () => {
    historyStore.getLatest.mockReturnValue(undefined);

    expect(health.getSnapshot().lastGameReceivedAt).toBeUndefined();
  });

  it('reports no lastError when nothing has failed yet', () => {
    expect(health.getSnapshot().lastError).toBeUndefined();
  });

  it('reports the last recorded error', () => {
    errorTracker.recordError('boom');

    expect(health.getSnapshot().lastError?.message).toBe('boom');
  });

  it('returns a frozen snapshot', () => {
    expect(Object.isFrozen(health.getSnapshot())).toBe(true);
  });
});
