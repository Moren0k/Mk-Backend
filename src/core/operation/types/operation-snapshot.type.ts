import { OperationState } from '../../enums/operation-state.enum';
import { WinnerType } from '../../enums/winner-type.enum';
import { OperationTransition } from './operation-transition.type';

/**
 * Vista de solo lectura del estado de una Operation en un instante dado.
 * Es el payload que viaja en los eventos de dominio de Operation: nunca se
 * expone la instancia mutable de Operation directamente.
 */
export type OperationSnapshot = {
  readonly operationId: string;
  readonly strategyId: string;
  readonly recommendedWinner: WinnerType;
  readonly currentState: OperationState;
  readonly currentMartingale: number;
  readonly maxMartingales: number;
  readonly openedAt: Date;
  readonly closedAt: Date | undefined;
  readonly reason: string;
  readonly history: ReadonlyArray<OperationTransition>;
};
