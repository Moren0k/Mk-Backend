import { Game } from '../history/game.type';

/**
 * Vista inmutable y de un único instante del historial.
 *
 * Solo permite lectura. A propósito no expone append/clear/remove/set:
 * ningún consumidor de un HistorySnapshot puede modificar el historial.
 */
export interface HistorySnapshot {
  getLatest(): Game | undefined;
  getLast(count: number): ReadonlyArray<Game>;
  getAll(): ReadonlyArray<Game>;
  size(): number;
  isEmpty(): boolean;
}
