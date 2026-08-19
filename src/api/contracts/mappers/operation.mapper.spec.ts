import { OperationState } from '../../../core/enums/operation-state.enum';
import { WinnerType } from '../../../core/enums/winner-type.enum';
import type { OperationSnapshot } from '../../../core/operation/types/operation-snapshot.type';
import { toOperationVm } from './operation.mapper';

function buildSnapshot(
  overrides: Partial<OperationSnapshot> = {},
): OperationSnapshot {
  return {
    operationId: 'op-1',
    strategyId: 'streak-4',
    context: 'oficial',
    recommendedWinner: WinnerType.BANKER,
    streakWinner: WinnerType.PLAYER,
    currentState: OperationState.OPEN,
    currentMartingale: 0,
    maxMartingales: 2,
    openedAt: new Date('2026-08-10T12:00:00.000Z'),
    closedAt: undefined,
    reason: 'Racha de 4 PLAYER consecutivos.',
    history: [],
    ...overrides,
  };
}

describe('toOperationVm', () => {
  it('maps an open operation, serializing openedAt and leaving closedAt as null', () => {
    const vm = toOperationVm(buildSnapshot());

    expect(vm).toEqual({
      operationId: 'op-1',
      strategyId: 'streak-4',
      recommendedWinner: 'BANKER',
      streakWinner: 'PLAYER',
      currentState: 'OPEN',
      currentMartingale: 0,
      reason: 'Racha de 4 PLAYER consecutivos.',
      openedAt: '2026-08-10T12:00:00.000Z',
      closedAt: null,
    });
  });

  it('serializes closedAt as an ISO string once the operation is finished', () => {
    const vm = toOperationVm(
      buildSnapshot({
        currentState: OperationState.WON,
        closedAt: new Date('2026-08-10T12:05:00.000Z'),
      }),
    );

    expect(vm.currentState).toBe('WON');
    expect(vm.closedAt).toBe('2026-08-10T12:05:00.000Z');
  });

  it('never leaks maxMartingales or history — only the confirmed OperationVm fields', () => {
    const vm = toOperationVm(buildSnapshot());

    expect(vm).not.toHaveProperty('maxMartingales');
    expect(vm).not.toHaveProperty('history');
  });
});
