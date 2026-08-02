import { OperationState } from '../../enums/operation-state.enum';
import { OperationSnapshot } from './operation-snapshot.type';
import { OperationTransition } from './operation-transition.type';

/**
 * Lo que devuelve `Operation.update(game)`: describe exactamente qué
 * ocurrió, sin publicar nada. OperationCoordinator decide, a partir de
 * `newState`, qué evento de dominio construir y publicar.
 */
export type OperationUpdateResult = {
  readonly stateChanged: boolean;
  readonly newState: OperationState;
  readonly completed: boolean;
  readonly transition: OperationTransition | undefined;
  readonly snapshot: OperationSnapshot;
};
