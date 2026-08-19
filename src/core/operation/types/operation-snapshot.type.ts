import { OperationState } from '../../enums/operation-state.enum';
import { WinnerType } from '../../enums/winner-type.enum';
import { StrategyGroup } from '../../strategy/strategy-group';
import { OperationTransition } from './operation-transition.type';

/**
 * Vista de solo lectura del estado de una Operation en un instante dado.
 * Es el payload que viaja en los eventos de dominio de Operation: nunca se
 * expone la instancia mutable de Operation directamente.
 */
export type OperationSnapshot = {
  readonly operationId: string;
  readonly strategyId: string;
  /** Contexto de negocio fijado al abrir la operación, ver `Operation.context`. */
  readonly context: StrategyGroup;
  readonly recommendedWinner: WinnerType;
  readonly streakWinner: WinnerType;
  readonly currentState: OperationState;
  readonly currentMartingale: number;
  readonly maxMartingales: number;
  readonly openedAt: Date;
  readonly closedAt: Date | undefined;
  readonly reason: string;
  readonly history: ReadonlyArray<OperationTransition>;
};
