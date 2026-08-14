import { WinnerType } from '../../core/enums/winner-type.enum';
import { OperationState } from '../../core/enums/operation-state.enum';
import { OperationSnapshot } from '../../core/operation/types/operation-snapshot.type';
import { OperationCoordinator } from '../operation/operation.coordinator';
import { StrategyChannelRegistry } from '../strategy/strategy-channel-registry';
import { OperationsReadModel } from './operations.read-model';

function buildSnapshot(
  strategyId: string,
  overrides: Partial<OperationSnapshot> = {},
): OperationSnapshot {
  return {
    operationId: `op-${strategyId}`,
    strategyId,
    recommendedWinner: WinnerType.BANKER,
    streakWinner: WinnerType.PLAYER,
    currentState: OperationState.OPEN,
    currentMartingale: 0,
    maxMartingales: 2,
    openedAt: new Date('2026-08-01T00:00:00.000Z'),
    closedAt: undefined,
    reason: 'Racha de 4 PLAYER consecutivos.',
    history: [],
    ...overrides,
  };
}

function buildRegistry(): StrategyChannelRegistry {
  return new StrategyChannelRegistry({ canExecute: () => true });
}

describe('OperationsReadModel', () => {
  it('returns only the operations whose strategy belongs to the requested channel', () => {
    const coordinator = {
      getActiveSnapshots: jest
        .fn()
        .mockReturnValue([
          buildSnapshot('streak-4'),
          buildSnapshot('estrategia-pruebas'),
        ]),
    } as unknown as jest.Mocked<OperationCoordinator>;
    const registry = buildRegistry();
    registry.assignStrategyToChannel('streak-4', 'oficial');
    registry.assignStrategyToChannel('estrategia-pruebas', 'pruebas');

    const readModel = new OperationsReadModel(coordinator, registry);

    expect(readModel.getActiveByChannel('oficial')).toEqual([
      buildSnapshot('streak-4'),
    ]);
    expect(readModel.getActiveByChannel('pruebas')).toEqual([
      buildSnapshot('estrategia-pruebas'),
    ]);
  });

  it('returns nothing for a strategy that is not assigned to any channel (new default)', () => {
    const coordinator = {
      getActiveSnapshots: jest
        .fn()
        .mockReturnValue([buildSnapshot('streak-4')]),
    } as unknown as jest.Mocked<OperationCoordinator>;

    const readModel = new OperationsReadModel(coordinator, buildRegistry());

    expect(readModel.getActiveByChannel('oficial')).toEqual([]);
    expect(readModel.getActiveByChannel('pruebas')).toEqual([]);
  });

  it('returns an empty array when no active operation belongs to the channel', () => {
    const coordinator = {
      getActiveSnapshots: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<OperationCoordinator>;

    const readModel = new OperationsReadModel(coordinator, buildRegistry());

    expect(readModel.getActiveByChannel('oficial')).toEqual([]);
  });

  it('reflects a live reassignment: a reassigned strategy shows up under its new channel', () => {
    const coordinator = {
      getActiveSnapshots: jest
        .fn()
        .mockReturnValue([buildSnapshot('streak-4')]),
    } as unknown as jest.Mocked<OperationCoordinator>;
    const registry = buildRegistry();
    const readModel = new OperationsReadModel(coordinator, registry);

    registry.assignStrategyToChannel('streak-4', 'pruebas');

    expect(readModel.getActiveByChannel('oficial')).toEqual([]);
    expect(readModel.getActiveByChannel('pruebas')).toEqual([
      buildSnapshot('streak-4'),
    ]);
  });

  describe('cancel()', () => {
    it('delegates to OperationCoordinator.cancel and returns its result', () => {
      const cancelledSnapshot = buildSnapshot('streak-4', {
        currentState: OperationState.CANCELLED,
      });
      const coordinator = {
        cancel: jest.fn().mockReturnValue(cancelledSnapshot),
      } as unknown as jest.Mocked<OperationCoordinator>;

      const readModel = new OperationsReadModel(coordinator, buildRegistry());
      const result = readModel.cancel('op-streak-4', 'motivo');

      expect(coordinator.cancel).toHaveBeenCalledWith('op-streak-4', 'motivo');
      expect(result).toEqual(cancelledSnapshot);
    });

    it('returns undefined when the coordinator reports no active operation', () => {
      const coordinator = {
        cancel: jest.fn().mockReturnValue(undefined),
      } as unknown as jest.Mocked<OperationCoordinator>;

      const readModel = new OperationsReadModel(coordinator, buildRegistry());

      expect(readModel.cancel('does-not-exist', 'motivo')).toBeUndefined();
    });
  });
});
