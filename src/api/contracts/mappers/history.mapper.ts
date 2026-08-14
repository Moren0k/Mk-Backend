import type { Game } from '../../../core/history/game.type';
import type { HistoryVm } from '../view-models/history.vm';

export function toHistoryVm(game: Game): HistoryVm {
  return {
    roundId: game.uuid,
    winner: game.winner,
    score: game.score,
    playedAt: game.playedAt.toISOString(),
  };
}
