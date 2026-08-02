import { WinnerType } from '../enums/winner-type.enum';
import { Game } from './game.type';
import { InMemoryHistorySnapshot } from './in-memory-history-snapshot';

function buildGame(uuid: string): Game {
  return {
    uuid,
    winner: WinnerType.BANKER,
    score: 7,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('InMemoryHistorySnapshot', () => {
  it('exposes an empty view', () => {
    const snapshot = new InMemoryHistorySnapshot(Object.freeze([]));

    expect(snapshot.isEmpty()).toBe(true);
    expect(snapshot.size()).toBe(0);
    expect(snapshot.getLatest()).toBeUndefined();
    expect(snapshot.getAll()).toEqual([]);
    expect(snapshot.getLast(5)).toEqual([]);
  });

  it('reads games without exposing any mutation method', () => {
    const games = Object.freeze([
      buildGame('1'),
      buildGame('2'),
      buildGame('3'),
    ]);
    const snapshot = new InMemoryHistorySnapshot(games);

    expect(snapshot.size()).toBe(3);
    expect(snapshot.isEmpty()).toBe(false);
    expect(snapshot.getLatest()?.uuid).toBe('3');
    expect(snapshot.getLast(2).map((g) => g.uuid)).toEqual(['2', '3']);
    expect(snapshot.getAll()).toBe(games);

    const untypedSnapshot = snapshot as unknown as Record<string, unknown>;
    expect(untypedSnapshot.append).toBeUndefined();
    expect(untypedSnapshot.clear).toBeUndefined();
    expect(untypedSnapshot.set).toBeUndefined();
  });
});
