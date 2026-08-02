import { WinnerType } from '../enums/winner-type.enum';
import { Game } from '../history/game.type';
import { Statistics } from './statistics.entity';

function buildGame(uuid: string, winner: WinnerType): Game {
  return {
    uuid,
    winner,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('Statistics', () => {
  it('starts at zero for every counter, with no current streak', () => {
    const statistics = new Statistics();

    expect(statistics.toSnapshot()).toEqual({
      totalGames: 0,
      playerWins: 0,
      bankerWins: 0,
      ties: 0,
      playerWinRate: 0,
      bankerWinRate: 0,
      tieRate: 0,
      currentStreak: { winner: undefined, length: 0 },
    });
  });

  it('counts totals per winner', () => {
    const statistics = new Statistics();

    statistics.recordGame(buildGame('1', WinnerType.PLAYER));
    statistics.recordGame(buildGame('2', WinnerType.BANKER));
    statistics.recordGame(buildGame('3', WinnerType.TIE));
    statistics.recordGame(buildGame('4', WinnerType.PLAYER));

    const snapshot = statistics.toSnapshot();
    expect(snapshot.totalGames).toBe(4);
    expect(snapshot.playerWins).toBe(2);
    expect(snapshot.bankerWins).toBe(1);
    expect(snapshot.ties).toBe(1);
  });

  it('computes the percentage of each outcome', () => {
    const statistics = new Statistics();

    statistics.recordGame(buildGame('1', WinnerType.PLAYER));
    statistics.recordGame(buildGame('2', WinnerType.PLAYER));
    statistics.recordGame(buildGame('3', WinnerType.BANKER));
    statistics.recordGame(buildGame('4', WinnerType.TIE));

    const snapshot = statistics.toSnapshot();
    expect(snapshot.playerWinRate).toBe(50);
    expect(snapshot.bankerWinRate).toBe(25);
    expect(snapshot.tieRate).toBe(25);
  });

  it('tracks the current streak, resetting when the winner changes', () => {
    const statistics = new Statistics();

    statistics.recordGame(buildGame('1', WinnerType.PLAYER));
    statistics.recordGame(buildGame('2', WinnerType.PLAYER));
    statistics.recordGame(buildGame('3', WinnerType.PLAYER));

    expect(statistics.toSnapshot().currentStreak).toEqual({
      winner: WinnerType.PLAYER,
      length: 3,
    });

    statistics.recordGame(buildGame('4', WinnerType.BANKER));

    expect(statistics.toSnapshot().currentStreak).toEqual({
      winner: WinnerType.BANKER,
      length: 1,
    });
  });

  it('treats TIE as its own streak like any other winner', () => {
    const statistics = new Statistics();

    statistics.recordGame(buildGame('1', WinnerType.TIE));
    statistics.recordGame(buildGame('2', WinnerType.TIE));

    expect(statistics.toSnapshot().currentStreak).toEqual({
      winner: WinnerType.TIE,
      length: 2,
    });
  });

  it('returns a frozen snapshot', () => {
    const statistics = new Statistics();
    statistics.recordGame(buildGame('1', WinnerType.PLAYER));

    const snapshot = statistics.toSnapshot();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.currentStreak)).toBe(true);
  });

  it('does not mutate a previously returned snapshot when new games arrive', () => {
    const statistics = new Statistics();
    statistics.recordGame(buildGame('1', WinnerType.PLAYER));
    const firstSnapshot = statistics.toSnapshot();

    statistics.recordGame(buildGame('2', WinnerType.BANKER));

    expect(firstSnapshot.totalGames).toBe(1);
    expect(firstSnapshot.currentStreak).toEqual({
      winner: WinnerType.PLAYER,
      length: 1,
    });
  });
});
