import { OperationState } from '../../enums/operation-state.enum';
import { Game } from '../../history/game.type';

/**
 * Representa un cambio de estado dentro del ciclo de vida de una Operation,
 * causado por una jugada concreta. Solo existen transiciones para las
 * jugadas que realmente afectaron a la operación: un TIE nunca genera una.
 */
export type OperationTransition = {
  readonly from: OperationState;
  readonly to: OperationState;
  readonly game: Game;
  readonly timestamp: Date;
  readonly reason: string;
};
