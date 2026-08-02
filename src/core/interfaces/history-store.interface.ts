import { Game } from '../history/game.type';
import { HistorySnapshot } from './history-snapshot.interface';

/**
 * Contrato para la memoria de partidas (Ring Buffer de 200 partidas).
 *
 * Ninguna estrategia ni operación conoce la implementación concreta
 * (InMemoryHistoryStore) ni cómo se almacenan las jugadas internamente,
 * solo dependen de este contrato.
 */
export interface HistoryStore {
  /**
   * Inserta `game` si su uuid todavía no existe.
   *
   * @returns `true` si se insertó, `false` si se ignoró por ser un duplicado.
   */
  append(game: Game): boolean;
  exists(uuid: string): boolean;
  findByUuid(uuid: string): Game | undefined;
  getLatest(): Game | undefined;
  getLast(count: number): ReadonlyArray<Game>;
  getAll(): ReadonlyArray<Game>;
  size(): number;
  clear(): void;
  createSnapshot(): HistorySnapshot;
}
