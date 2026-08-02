import { WinnerType } from '../../enums/winner-type.enum';

/**
 * Vista de solo lectura de las estadísticas acumuladas hasta el momento.
 */
export type StatisticsSnapshot = {
  readonly totalGames: number;
  readonly playerWins: number;
  readonly bankerWins: number;
  readonly ties: number;
  readonly playerWinRate: number;
  readonly bankerWinRate: number;
  readonly tieRate: number;
  readonly currentStreak: {
    readonly winner: WinnerType | undefined;
    readonly length: number;
  };
};
