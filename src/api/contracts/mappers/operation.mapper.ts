import type { OperationSnapshot } from '../../../core/operation/types/operation-snapshot.type';
import type { OperationVm } from '../view-models/operation.vm';

export function toOperationVm(snapshot: OperationSnapshot): OperationVm {
  return {
    operationId: snapshot.operationId,
    strategyId: snapshot.strategyId,
    recommendedWinner: snapshot.recommendedWinner,
    streakWinner: snapshot.streakWinner,
    currentState: snapshot.currentState,
    currentMartingale: snapshot.currentMartingale,
    reason: snapshot.reason,
    openedAt: snapshot.openedAt.toISOString(),
    closedAt: snapshot.closedAt?.toISOString() ?? null,
  };
}
