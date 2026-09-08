import { WinnerType } from '../../enums/winner-type.enum';

/**
 * Una fila de `jugadas` tal como la necesita el reconstructor de referencia:
 * la identidad persistente (`id`), el ganador y el instante real.
 *
 * Deliberadamente NO es `Game` (core/history/game.type.ts). `Game` es la
 * jugada tal como vive en memoria durante la operación del motor, y se
 * identifica por `uuid` porque es lo único que trae el SSE de Tipminer.
 * Aquí la identidad es `jugadas.id`, que es la que usan las FKs del dominio
 * derivado y la que define el orden cronológico del histórico.
 */
export type AnalyticsGame = {
  readonly id: bigint;
  readonly uuid: string;
  readonly winner: WinnerType;
  readonly playedAt: Date;
};
