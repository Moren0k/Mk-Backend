import { HistorySnapshot } from '../interfaces/history-snapshot.interface';
import { takeLast } from '../shared/take-last';
import { Game } from './game.type';

/**
 * Vista inmutable y de un único instante del historial.
 *
 * Recibe una copia ya congelada de las jugadas (ver RingBuffer.getAll()),
 * por lo que jamás refleja cambios posteriores del HistoryStore que la creó.
 */
export class InMemoryHistorySnapshot implements HistorySnapshot {
  constructor(private readonly games: ReadonlyArray<Game>) {}

  getLatest(): Game | undefined {
    return this.games[this.games.length - 1];
  }

  getLast(count: number): ReadonlyArray<Game> {
    return takeLast(this.games, count);
  }

  getAll(): ReadonlyArray<Game> {
    return this.games;
  }

  size(): number {
    return this.games.length;
  }

  isEmpty(): boolean {
    return this.games.length === 0;
  }
}
