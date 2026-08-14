import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import type { HistoryStore } from '../../core/interfaces/history-store.interface';
import { RollingStatsReadModel } from './rolling-stats.read-model';

function buildGame(winner: WinnerType): Game {
  return {
    uuid: Math.random().toString(),
    winner,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function buildHistoryStore(games: Game[]): HistoryStore {
  return {
    append: jest.fn(),
    exists: jest.fn(),
    findByUuid: jest.fn(),
    getLatest: jest.fn(),
    getLast: jest
      .fn()
      .mockImplementation((count: number) => games.slice(-count)),
    getAll: jest.fn().mockReturnValue(games),
    size: jest.fn().mockReturnValue(games.length),
    clear: jest.fn(),
    createSnapshot: jest.fn(),
  };
}

describe('RollingStatsReadModel', () => {
  it('computes the percentage distribution over the requested window', () => {
    const games = [
      buildGame(WinnerType.PLAYER),
      buildGame(WinnerType.PLAYER),
      buildGame(WinnerType.BANKER),
      buildGame(WinnerType.TIE),
    ];
    const readModel = new RollingStatsReadModel(buildHistoryStore(games));

    expect(readModel.compute(200)).toEqual({
      window: 200,
      playerPct: 50,
      bankerPct: 25,
      tiePct: 25,
    });
  });

  it('returns all zeroes when there is no history yet', () => {
    const readModel = new RollingStatsReadModel(buildHistoryStore([]));

    expect(readModel.compute(50)).toEqual({
      window: 50,
      playerPct: 0,
      bankerPct: 0,
      tiePct: 0,
    });
  });

  it('only considers the last N games for the requested window', () => {
    const games = [
      ...Array.from({ length: 10 }, () => buildGame(WinnerType.BANKER)),
      buildGame(WinnerType.PLAYER),
      buildGame(WinnerType.PLAYER),
    ];
    const readModel = new RollingStatsReadModel(buildHistoryStore(games));

    expect(readModel.compute(2)).toEqual({
      window: 2,
      playerPct: 100,
      bankerPct: 0,
      tiePct: 0,
    });
  });
});
