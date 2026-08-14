import { Inject, Injectable } from '@nestjs/common';

import { HISTORY_STORE } from '../../core/constants/injection-tokens.constants';
import { Game } from '../../core/history/game.type';
import type { HistoryStore } from '../../core/interfaces/history-store.interface';

/**
 * Ventana en memoria del historial (Mk-Api.md Anexo D §1): única fuente de
 * `GET /api/v1/history` por ahora. Al ser un ring buffer de máximo 200
 * partidas, no hay paginación por cursor sobre DB: es un slice simple de
 * las últimas `limit` partidas (mismo orden que `HistoryStore.getLast`,
 * más antigua primero).
 */
@Injectable()
export class HistoryReadModel {
  constructor(
    @Inject(HISTORY_STORE) private readonly historyStore: HistoryStore,
  ) {}

  getWindow(limit: number): ReadonlyArray<Game> {
    return this.historyStore.getLast(limit);
  }
}
