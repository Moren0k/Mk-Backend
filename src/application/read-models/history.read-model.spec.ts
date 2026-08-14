import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import type { HistoryStore } from '../../core/interfaces/history-store.interface';
import { HistoryReadModel } from './history.read-model';

function buildGame(uuid: string): Game {
  return {
    uuid,
    winner: WinnerType.PLAYER,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('HistoryReadModel', () => {
  it('delegates to HistoryStore.getLast with the requested limit', () => {
    const games = [buildGame('1'), buildGame('2')];
    const historyStore = {
      getLast: jest.fn().mockReturnValue(games),
    } as unknown as jest.Mocked<HistoryStore>;

    const readModel = new HistoryReadModel(historyStore);
    const result = readModel.getWindow(50);

    expect(historyStore.getLast).toHaveBeenCalledWith(50);
    expect(result).toBe(games);
  });
});
