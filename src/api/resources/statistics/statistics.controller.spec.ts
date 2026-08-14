import { WinnerType } from '../../../core/enums/winner-type.enum';
import { StatisticsService } from '../../../application/statistics/statistics.service';
import { StatisticsController } from './statistics.controller';

function buildStatisticsService(): jest.Mocked<StatisticsService> {
  return {
    getSnapshot: jest.fn().mockReturnValue({
      totalGames: 200,
      playerWins: 95,
      bankerWins: 100,
      ties: 5,
      playerWinRate: 0.475,
      bankerWinRate: 0.5,
      tieRate: 0.025,
      currentStreak: { winner: WinnerType.PLAYER, length: 3 },
    }),
  } as unknown as jest.Mocked<StatisticsService>;
}

describe('StatisticsController', () => {
  it('returns the statistics snapshot mapped to StatisticsVm', () => {
    const service = buildStatisticsService();
    const controller = new StatisticsController(service);

    const result = controller.getStatistics();

    expect(service.getSnapshot).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      totalGames: 200,
      playerWinRate: 0.475,
      bankerWinRate: 0.5,
      tieRate: 0.025,
      currentStreak: { winner: 'PLAYER', length: 3 },
    });
  });
});
