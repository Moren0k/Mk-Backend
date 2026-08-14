import { OperationState } from '../../enums/operation-state.enum';
import { Game } from '../../history/game.type';

/**
 * Representa un cambio de estado dentro del ciclo de vida de una Operation,
 * causado por una jugada concreta o por un comando explícito (cancelación
 * manual, Mk-Api.md Anexo D §4). `game` es `undefined` únicamente para
 * `CANCELLED`: es el único estado que no lo produce una jugada. Un TIE
 * nunca genera una transición en absoluto (ver `Operation.update`).
 */
export type OperationTransition = {
  readonly from: OperationState;
  readonly to: OperationState;
  readonly game: Game | undefined;
  readonly timestamp: Date;
  readonly reason: string;
};
