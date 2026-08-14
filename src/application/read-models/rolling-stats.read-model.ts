import { Inject, Injectable } from '@nestjs/common';

import { HISTORY_STORE } from '../../core/constants/injection-tokens.constants';
import { WinnerType } from '../../core/enums/winner-type.enum';
import type { HistoryStore } from '../../core/interfaces/history-store.interface';

export type RollingWindow = 200 | 50;

export type RollingStats = {
  readonly window: RollingWindow;
  readonly playerPct: number;
  readonly bankerPct: number;
  readonly tiePct: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * % de PLAYER/BANKER/TIE sobre las últimas `window` jugadas del ring
 * buffer (Mk-Api.md Anexo D §9(2)): a propósito NO reutiliza
 * `StatisticsService` (ese acumula el histórico completo desde que
 * arrancó el proceso, nunca "olvida" partidas viejas) — es un cálculo
 * aparte sobre una ventana móvil, recalculado en cada `game.received`.
 * El buffer nunca supera 200 registros, así que recorrerlo es siempre
 * barato.
 */
@Injectable()
export class RollingStatsReadModel {
  constructor(
    @Inject(HISTORY_STORE) private readonly historyStore: HistoryStore,
  ) {}

  compute(window: RollingWindow): RollingStats {
    const games = this.historyStore.getLast(window);
    const total = games.length;

    if (total === 0) {
      return { window, playerPct: 0, bankerPct: 0, tiePct: 0 };
    }

    let playerCount = 0;
    let bankerCount = 0;
    let tieCount = 0;

    for (const game of games) {
      if (game.winner === WinnerType.PLAYER) playerCount++;
      else if (game.winner === WinnerType.BANKER) bankerCount++;
      else tieCount++;
    }

    return {
      window,
      playerPct: round2((playerCount / total) * 100),
      bankerPct: round2((bankerCount / total) * 100),
      tiePct: round2((tieCount / total) * 100),
    };
  }
}
