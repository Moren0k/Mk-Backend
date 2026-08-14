import type { StatisticsSnapshot } from '../../../core/statistics/types/statistics-snapshot.type';
import type { StatisticsVm } from '../view-models/statistics.vm';

export function toStatisticsVm(snapshot: StatisticsSnapshot): StatisticsVm {
  return {
    totalGames: snapshot.totalGames,
    playerWinRate: snapshot.playerWinRate,
    bankerWinRate: snapshot.bankerWinRate,
    tieRate: snapshot.tieRate,
    currentStreak: {
      winner: snapshot.currentStreak.winner ?? null,
      length: snapshot.currentStreak.length,
    },
  };
}
