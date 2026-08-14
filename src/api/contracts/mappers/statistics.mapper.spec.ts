import { WinnerType } from '../../../core/enums/winner-type.enum';
import type { StatisticsSnapshot } from '../../../core/statistics/types/statistics-snapshot.type';
import { toStatisticsVm } from './statistics.mapper';

function buildSnapshot(
  overrides: Partial<StatisticsSnapshot> = {},
): StatisticsSnapshot {
  return {
    totalGames: 200,
    playerWins: 95,
    bankerWins: 100,
    ties: 5,
    playerWinRate: 0.475,
    bankerWinRate: 0.5,
    tieRate: 0.025,
    currentStreak: { winner: WinnerType.PLAYER, length: 3 },
    ...overrides,
  };
}

describe('toStatisticsVm', () => {
  it('maps rates and the current streak, dropping internal win/loss counters', () => {
    const vm = toStatisticsVm(buildSnapshot());

    expect(vm).toEqual({
      totalGames: 200,
      playerWinRate: 0.475,
      bankerWinRate: 0.5,
      tieRate: 0.025,
      currentStreak: { winner: 'PLAYER', length: 3 },
    });
  });

  it('maps a missing streak winner to null, never undefined', () => {
    const vm = toStatisticsVm(
      buildSnapshot({ currentStreak: { winner: undefined, length: 0 } }),
    );

    expect(vm.currentStreak).toEqual({ winner: null, length: 0 });
  });
});
