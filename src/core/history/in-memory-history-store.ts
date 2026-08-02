import { MAX_HISTORY_SIZE } from '../constants/history.constants';
import { HistorySnapshot } from '../interfaces/history-snapshot.interface';
import { HistoryStore } from '../interfaces/history-store.interface';
import { takeLast } from '../shared/take-last';
import { Game } from './game.type';
import { InMemoryHistorySnapshot } from './in-memory-history-snapshot';
import { RingBuffer } from './ring-buffer';

/**
 * Implementación en memoria de HistoryStore.
 *
 * Ningún consumidor externo debe importar esta clase directamente: el resto
 * del proyecto solo conoce el contrato HistoryStore. El RingBuffer permanece
 * completamente oculto detrás de esta clase.
 */
export class InMemoryHistoryStore implements HistoryStore {
  private readonly buffer = new RingBuffer<Game>(MAX_HISTORY_SIZE);

  append(game: Game): boolean {
    if (this.exists(game.uuid)) {
      return false;
    }

    this.buffer.add(Object.freeze({ ...game }));
    return true;
  }

  exists(uuid: string): boolean {
    return this.findByUuid(uuid) !== undefined;
  }

  findByUuid(uuid: string): Game | undefined {
    for (let i = 0; i < this.buffer.size(); i++) {
      const game = this.buffer.get(i);
      if (game?.uuid === uuid) {
        return game;
      }
    }

    return undefined;
  }

  getLatest(): Game | undefined {
    return this.buffer.getLatest();
  }

  getLast(count: number): ReadonlyArray<Game> {
    return takeLast(this.buffer.getAll(), count);
  }

  getAll(): ReadonlyArray<Game> {
    return this.buffer.getAll();
  }

  size(): number {
    return this.buffer.size();
  }

  clear(): void {
    this.buffer.clear();
  }

  createSnapshot(): HistorySnapshot {
    return new InMemoryHistorySnapshot(this.buffer.getAll());
  }
}
