import { WinnerType } from '../enums/winner-type.enum';
import { Game } from '../history/game.type';
import { StatisticsSnapshot } from './types/statistics-snapshot.type';

const PERCENTAGE_PRECISION = 100;

/**
 * Acumula estadísticas de partidas de forma puramente incremental: cada
 * `recordGame` es O(1), sin importar cuántas partidas hayan ocurrido
 * antes. Nunca recorre HistoryStore ni recalcula nada desde cero.
 *
 * No conoce DomainEventBus: es StatisticsService (application) quien la
 * alimenta al escuchar GameReceivedEvent.
 */
export class Statistics {
  private totalGames = 0;
  private readonly winCounts: Record<WinnerType, number> = {
    [WinnerType.PLAYER]: 0,
    [WinnerType.BANKER]: 0,
    [WinnerType.TIE]: 0,
  };
  private currentStreakWinner: WinnerType | undefined;
  private currentStreakLength = 0;

  recordGame(game: Game): void {
    this.totalGames += 1;
    this.winCounts[game.winner] += 1;
    this.updateStreak(game.winner);
  }

  toSnapshot(): StatisticsSnapshot {
    return Object.freeze({
      totalGames: this.totalGames,
      playerWins: this.winCounts[WinnerType.PLAYER],
      bankerWins: this.winCounts[WinnerType.BANKER],
      ties: this.winCounts[WinnerType.TIE],
      playerWinRate: this.rateOf(this.winCounts[WinnerType.PLAYER]),
      bankerWinRate: this.rateOf(this.winCounts[WinnerType.BANKER]),
      tieRate: this.rateOf(this.winCounts[WinnerType.TIE]),
      currentStreak: Object.freeze({
        winner: this.currentStreakWinner,
        length: this.currentStreakLength,
      }),
    });
  }

  private updateStreak(winner: WinnerType): void {
    if (winner === this.currentStreakWinner) {
      this.currentStreakLength += 1;
    } else {
      this.currentStreakWinner = winner;
      this.currentStreakLength = 1;
    }
  }

  private rateOf(count: number): number {
    if (this.totalGames === 0) {
      return 0;
    }

    const rate = (count / this.totalGames) * PERCENTAGE_PRECISION;
    return Math.round(rate * PERCENTAGE_PRECISION) / PERCENTAGE_PRECISION;
  }
}
