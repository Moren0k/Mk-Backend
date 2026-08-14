import { WinnerType } from '../../../core/enums/winner-type.enum';
import { HistoryReadModel } from '../../../application/read-models/history.read-model';
import { PaginatedResult } from '../../contracts/paginated-result';
import { HistoryController } from './history.controller';

function buildGame(uuid: string) {
  return {
    uuid,
    winner: WinnerType.PLAYER,
    score: 8,
    playedAt: new Date('2026-08-10T12:00:00.000Z'),
  };
}

function buildReadModel(gameCount: number): jest.Mocked<HistoryReadModel> {
  return {
    getWindow: jest
      .fn()
      .mockImplementation((limit: number) =>
        Array.from({ length: Math.min(gameCount, limit) }, (_, i) =>
          buildGame(`game-${i}`),
        ),
      ),
  } as unknown as jest.Mocked<HistoryReadModel>;
}

describe('HistoryController', () => {
  it('defaults limit to 50 when the query param is missing', () => {
    const readModel = buildReadModel(60);
    const controller = new HistoryController(readModel);

    const result = controller.getHistory(undefined);

    expect(readModel.getWindow).toHaveBeenCalledWith(50);
    expect(result).toBeInstanceOf(PaginatedResult);
    expect(result.data).toHaveLength(50);
    expect(result.meta).toEqual({ limit: 50, count: 50 });
  });

  it('clamps a limit above 200 down to 200, silently', () => {
    const readModel = buildReadModel(200);
    const controller = new HistoryController(readModel);

    controller.getHistory('9999');

    expect(readModel.getWindow).toHaveBeenCalledWith(200);
  });

  it('falls back to the default for invalid (non-numeric or non-positive) limits', () => {
    const readModel = buildReadModel(50);
    const controller = new HistoryController(readModel);

    controller.getHistory('not-a-number');
    expect(readModel.getWindow).toHaveBeenLastCalledWith(50);

    controller.getHistory('-5');
    expect(readModel.getWindow).toHaveBeenLastCalledWith(50);
  });

  it('maps each game to a HistoryVm', () => {
    const readModel = buildReadModel(1);
    const controller = new HistoryController(readModel);

    const result = controller.getHistory('1');

    expect(result.data[0]).toEqual({
      roundId: 'game-0',
      winner: 'PLAYER',
      score: 8,
      playedAt: '2026-08-10T12:00:00.000Z',
    });
  });
});
