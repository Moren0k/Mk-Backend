import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import { StatisticsService } from './statistics.service';

function buildGame(uuid: string, winner: WinnerType): Game {
  return {
    uuid,
    winner,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function buildGameReceivedEvent(
  uuid: string,
  winner: WinnerType,
  isHistorical = false,
): GameReceivedEvent {
  return new GameReceivedEvent({ game: buildGame(uuid, winner), isHistorical });
}

describe('StatisticsService', () => {
  let domainEventBus: jest.Mocked<DomainEventBus>;
  let service: StatisticsService;

  beforeEach(() => {
    domainEventBus = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      publish: jest.fn(),
      publishMany: jest.fn(),
      clear: jest.fn(),
    };
    service = new StatisticsService(domainEventBus);
  });

  it('subscribes only to GameReceivedEvent on module init', () => {
    service.onModuleInit();

    expect(domainEventBus.subscribe).toHaveBeenCalledTimes(1);
    expect(domainEventBus.subscribe).toHaveBeenCalledWith(
      GameReceivedEvent.eventName,
      expect.anything(),
    );
  });

  it('unsubscribes using the same handler reference on module destroy', () => {
    service.onModuleInit();
    const [, handler] = domainEventBus.subscribe.mock.calls[0];

    service.onModuleDestroy();

    expect(domainEventBus.unsubscribe).toHaveBeenCalledWith(
      GameReceivedEvent.eventName,
      handler,
    );
  });

  it('updates the snapshot as GameReceivedEvent arrives, without querying HistoryStore', () => {
    service.onModuleInit();
    const [, handler] = domainEventBus.subscribe.mock.calls[0];

    handler.handle(buildGameReceivedEvent('1', WinnerType.PLAYER));
    handler.handle(buildGameReceivedEvent('2', WinnerType.PLAYER));
    handler.handle(buildGameReceivedEvent('3', WinnerType.BANKER));

    const snapshot = service.getSnapshot();
    expect(snapshot.totalGames).toBe(3);
    expect(snapshot.playerWins).toBe(2);
    expect(snapshot.bankerWins).toBe(1);
    expect(snapshot.currentStreak).toEqual({
      winner: WinnerType.BANKER,
      length: 1,
    });
  });

  it('counts historical games too (unlike StrategyCoordinator, this is descriptive analytics, not an action trigger)', () => {
    service.onModuleInit();
    const [, handler] = domainEventBus.subscribe.mock.calls[0];

    handler.handle(buildGameReceivedEvent('1', WinnerType.PLAYER, true));
    handler.handle(buildGameReceivedEvent('2', WinnerType.BANKER, false));

    expect(service.getSnapshot().totalGames).toBe(2);
  });
});
