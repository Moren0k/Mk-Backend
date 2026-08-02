import { MAX_HISTORY_SIZE } from '../constants/history.constants';
import { WinnerType } from '../enums/winner-type.enum';
import { Game } from './game.type';
import { InMemoryHistoryStore } from './in-memory-history-store';

function buildGame(overrides: Partial<Game> = {}): Game {
  return {
    uuid: overrides.uuid ?? 'uuid-1',
    winner: overrides.winner ?? WinnerType.PLAYER,
    score: overrides.score ?? 8,
    playedAt: overrides.playedAt ?? new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('InMemoryHistoryStore', () => {
  it('starts empty', () => {
    const store = new InMemoryHistoryStore();

    expect(store.size()).toBe(0);
    expect(store.getAll()).toEqual([]);
    expect(store.getLatest()).toBeUndefined();
  });

  it('appends a game and finds it by uuid', () => {
    const store = new InMemoryHistoryStore();
    const game = buildGame({ uuid: 'abc' });

    const wasInserted = store.append(game);

    expect(wasInserted).toBe(true);
    expect(store.size()).toBe(1);
    expect(store.exists('abc')).toBe(true);
    expect(store.findByUuid('abc')).toEqual(game);
    expect(store.getLatest()).toEqual(game);
  });

  it('ignores duplicate uuids instead of overwriting', () => {
    const store = new InMemoryHistoryStore();

    expect(store.append(buildGame({ uuid: 'dup', score: 8 }))).toBe(true);
    expect(store.append(buildGame({ uuid: 'dup', score: 12 }))).toBe(false);

    expect(store.size()).toBe(1);
    expect(store.findByUuid('dup')?.score).toBe(8);
  });

  it('returns undefined/false for an unknown uuid', () => {
    const store = new InMemoryHistoryStore();

    expect(store.exists('missing')).toBe(false);
    expect(store.findByUuid('missing')).toBeUndefined();
  });

  it('getLast returns the most recent N games in chronological order', () => {
    const store = new InMemoryHistoryStore();
    store.append(buildGame({ uuid: '1' }));
    store.append(buildGame({ uuid: '2' }));
    store.append(buildGame({ uuid: '3' }));

    expect(store.getLast(2).map((g) => g.uuid)).toEqual(['2', '3']);
    expect(store.getLast(0)).toEqual([]);
    expect(store.getLast(100).map((g) => g.uuid)).toEqual(['1', '2', '3']);
  });

  it('never keeps more than MAX_HISTORY_SIZE games', () => {
    const store = new InMemoryHistoryStore();

    for (let i = 0; i < MAX_HISTORY_SIZE + 50; i++) {
      store.append(buildGame({ uuid: `game-${i}` }));
    }

    expect(store.size()).toBe(MAX_HISTORY_SIZE);
    expect(store.findByUuid('game-0')).toBeUndefined();
    expect(store.findByUuid(`game-${MAX_HISTORY_SIZE + 49}`)).toBeDefined();
  });

  it('clear() empties the store', () => {
    const store = new InMemoryHistoryStore();
    store.append(buildGame({ uuid: '1' }));

    store.clear();

    expect(store.size()).toBe(0);
    expect(store.getAll()).toEqual([]);
    expect(store.exists('1')).toBe(false);
  });

  it('returned collections and stored games cannot be mutated', () => {
    const store = new InMemoryHistoryStore();
    store.append(buildGame({ uuid: '1' }));

    const all = store.getAll() as Game[];
    expect(Object.isFrozen(all)).toBe(true);
    expect(() => all.push(buildGame({ uuid: '2' }))).toThrow(TypeError);

    const stored = store.findByUuid('1');
    expect(Object.isFrozen(stored)).toBe(true);
    expect(() => {
      (stored as unknown as { score: number }).score = 999;
    }).toThrow(TypeError);
  });

  it('createSnapshot() reflects the state at that instant and is frozen in time', () => {
    const store = new InMemoryHistoryStore();
    store.append(buildGame({ uuid: '1' }));
    store.append(buildGame({ uuid: '2' }));

    const snapshot = store.createSnapshot();

    expect(snapshot.size()).toBe(2);
    expect(snapshot.isEmpty()).toBe(false);
    expect(snapshot.getLatest()?.uuid).toBe('2');
    expect(snapshot.getLast(1).map((g) => g.uuid)).toEqual(['2']);
    expect(snapshot.getAll().map((g) => g.uuid)).toEqual(['1', '2']);

    store.append(buildGame({ uuid: '3' }));

    expect(snapshot.size()).toBe(2);
    expect(snapshot.getAll().map((g) => g.uuid)).toEqual(['1', '2']);
  });

  it('createSnapshot() on an empty store is empty', () => {
    const store = new InMemoryHistoryStore();

    const snapshot = store.createSnapshot();

    expect(snapshot.isEmpty()).toBe(true);
    expect(snapshot.size()).toBe(0);
    expect(snapshot.getLatest()).toBeUndefined();
  });
});
