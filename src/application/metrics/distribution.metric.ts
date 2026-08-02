import { Inject, Injectable } from '@nestjs/common';

import { HISTORY_STORE } from '../../core/constants/injection-tokens.constants';
import { WinnerType } from '../../core/enums/winner-type.enum';
import type { HistoryStore } from '../../core/interfaces/history-store.interface';
import type { DistributionMetricValue } from '../../core/metrics/types/distribution-metric-value.type';

const PERCENTAGE_PRECISION = 100;

/**
 * Calcula la distribución porcentual de resultados (PLAYER / TIE / BANKER)
 * sobre las últimas partidas disponibles en HistoryStore.
 *
 * Pull-based: consulta HistoryStore.getAll() en cada getSnapshot(). No
 * mantiene estado interno, no se suscribe a eventos. Esto garantiza que
 * siempre devuelve los datos más recientes sin depender del orden de
 * suscripción del DomainEventBus.
 */
@Injectable()
export class DistributionMetric {
  constructor(
    @Inject(HISTORY_STORE) private readonly historyStore: HistoryStore,
  ) {}

  getSnapshot(): DistributionMetricValue {
    const games = this.historyStore.getAll();

    if (games.length === 0) {
      return Object.freeze({
        playerPct: 0,
        tiePct: 0,
        bankerPct: 0,
        totalGames: 0,
      });
    }

    let playerCount = 0;
    let tieCount = 0;
    let bankerCount = 0;

    for (const game of games) {
      switch (game.winner) {
        case WinnerType.PLAYER:
          playerCount += 1;
          break;
        case WinnerType.TIE:
          tieCount += 1;
          break;
        case WinnerType.BANKER:
          bankerCount += 1;
          break;
      }
    }

    const total = games.length;

    return Object.freeze({
      playerPct: this.roundRate(playerCount, total),
      tiePct: this.roundRate(tieCount, total),
      bankerPct: this.roundRate(bankerCount, total),
      totalGames: total,
    });
  }

  private roundRate(count: number, total: number): number {
    const rate = (count / total) * PERCENTAGE_PRECISION;
    return Math.round(rate * PERCENTAGE_PRECISION) / PERCENTAGE_PRECISION;
  }
}
