import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import { InMemoryHistoryStore } from '../../core/history/in-memory-history-store';
import { DistributionMetric } from './distribution.metric';

function buildGame(uuid: string, winner: WinnerType): Game {
  return {
    uuid,
    winner,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function fillHistory(
  history: InMemoryHistoryStore,
  games: readonly Game[],
): void {
  for (const game of games) {
    history.append(game);
  }
}

describe('DistributionMetric', () => {
  let historyStore: InMemoryHistoryStore;
  let metric: DistributionMetric;

  beforeEach(() => {
    historyStore = new InMemoryHistoryStore();
    metric = new DistributionMetric(historyStore);
  });

  it('returns zero percentages when history is empty', () => {
    const snapshot = metric.getSnapshot();

    expect(snapshot.totalGames).toBe(0);
    expect(snapshot.playerPct).toBe(0);
    expect(snapshot.tiePct).toBe(0);
    expect(snapshot.bankerPct).toBe(0);
  });

  it('returns 100 % player when history contains only PLAYER games', () => {
    fillHistory(historyStore, [
      buildGame('1', WinnerType.PLAYER),
      buildGame('2', WinnerType.PLAYER),
      buildGame('3', WinnerType.PLAYER),
    ]);

    const snapshot = metric.getSnapshot();

    expect(snapshot.totalGames).toBe(3);
    expect(snapshot.playerPct).toBe(100);
    expect(snapshot.tiePct).toBe(0);
    expect(snapshot.bankerPct).toBe(0);
  });

  it('returns 100 % tie when history contains only TIE games', () => {
    fillHistory(historyStore, [
      buildGame('1', WinnerType.TIE),
      buildGame('2', WinnerType.TIE),
    ]);

    const snapshot = metric.getSnapshot();

    expect(snapshot.totalGames).toBe(2);
    expect(snapshot.playerPct).toBe(0);
    expect(snapshot.tiePct).toBe(100);
    expect(snapshot.bankerPct).toBe(0);
  });

  it('returns 100 % banker when history contains only BANKER games', () => {
    fillHistory(historyStore, [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
      buildGame('4', WinnerType.BANKER),
    ]);

    const snapshot = metric.getSnapshot();

    expect(snapshot.totalGames).toBe(4);
    expect(snapshot.playerPct).toBe(0);
    expect(snapshot.tiePct).toBe(0);
    expect(snapshot.bankerPct).toBe(100);
  });

  it('calculates correct percentages for a mixed history', () => {
    fillHistory(historyStore, [
      buildGame('1', WinnerType.PLAYER),
      buildGame('2', WinnerType.PLAYER),
      buildGame('3', WinnerType.BANKER),
      buildGame('4', WinnerType.TIE),
    ]);

    const snapshot = metric.getSnapshot();

    expect(snapshot.totalGames).toBe(4);
    expect(snapshot.playerPct).toBe(50);
    expect(snapshot.tiePct).toBe(25);
    expect(snapshot.bankerPct).toBe(25);
    // Verifica que la suma sea exactamente 100.
    expect(snapshot.playerPct + snapshot.tiePct + snapshot.bankerPct).toBe(100);
  });

  it('rounds percentages to 2 decimal places', () => {
    // 1 PLAYER de 3 juegos = 33.333...% → redondeado a 33.33%
    fillHistory(historyStore, [
      buildGame('1', WinnerType.PLAYER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ]);

    const snapshot = metric.getSnapshot();

    expect(snapshot.playerPct).toBe(33.33);
    expect(snapshot.bankerPct).toBe(66.67);
    expect(snapshot.tiePct).toBe(0);
  });

  it('is immutable across calls', () => {
    fillHistory(historyStore, [
      buildGame('1', WinnerType.PLAYER),
    ]);

    const first = metric.getSnapshot();
    const second = metric.getSnapshot();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
  });

  it('reads the latest state from HistoryStore on every call', () => {
    const before = metric.getSnapshot();
    expect(before.totalGames).toBe(0);

    historyStore.append(buildGame('1', WinnerType.BANKER));

    const after = metric.getSnapshot();
    expect(after.totalGames).toBe(1);
    expect(after.bankerPct).toBe(100);
  });
});
