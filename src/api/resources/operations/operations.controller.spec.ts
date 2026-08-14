import { BadRequestException, NotFoundException } from '@nestjs/common';

import { OperationState } from '../../../core/enums/operation-state.enum';
import { WinnerType } from '../../../core/enums/winner-type.enum';
import { OperationsReadModel } from '../../../application/read-models/operations.read-model';
import { OperationsController } from './operations.controller';

function buildSnapshot(
  strategyId: string,
  overrides: { currentState?: OperationState } = {},
) {
  return {
    operationId: `op-${strategyId}`,
    strategyId,
    recommendedWinner: WinnerType.BANKER,
    streakWinner: WinnerType.PLAYER,
    currentState: overrides.currentState ?? OperationState.OPEN,
    currentMartingale: 0,
    maxMartingales: 2,
    openedAt: new Date('2026-08-10T12:00:00.000Z'),
    closedAt: undefined,
    reason: 'Racha de 4 PLAYER consecutivos.',
    history: [],
  };
}

function buildReadModel(): jest.Mocked<OperationsReadModel> {
  return {
    getActiveByChannel: jest.fn().mockReturnValue([buildSnapshot('streak-4')]),
    cancel: jest.fn(),
  } as unknown as jest.Mocked<OperationsReadModel>;
}

describe('OperationsController', () => {
  it('returns the active operations for a valid channel, mapped to OperationVm', () => {
    const readModel = buildReadModel();
    const controller = new OperationsController(readModel);

    const result = controller.getOperations('oficial');

    expect(readModel.getActiveByChannel).toHaveBeenCalledWith('oficial');
    expect(result).toEqual([
      expect.objectContaining({
        operationId: 'op-streak-4',
        strategyId: 'streak-4',
        currentState: 'OPEN',
      }),
    ]);
  });

  it.each([undefined, '', 'discord', 'OFICIAL'])(
    'rejects an invalid or missing channel (%s) with BadRequest',
    (channel) => {
      const readModel = buildReadModel();
      const controller = new OperationsController(readModel);

      expect(() => controller.getOperations(channel)).toThrow(
        BadRequestException,
      );
      expect(readModel.getActiveByChannel).not.toHaveBeenCalled();
    },
  );

  it('accepts "pruebas" as a valid channel', () => {
    const readModel = buildReadModel();
    const controller = new OperationsController(readModel);

    controller.getOperations('pruebas');

    expect(readModel.getActiveByChannel).toHaveBeenCalledWith('pruebas');
  });

  describe('cancelOperation()', () => {
    it('cancels an active operation and returns it mapped to OperationVm', () => {
      const readModel = buildReadModel();
      readModel.cancel.mockReturnValue(
        buildSnapshot('streak-4', { currentState: OperationState.CANCELLED }),
      );
      const controller = new OperationsController(readModel);

      const result = controller.cancelOperation('op-streak-4');

      expect(readModel.cancel).toHaveBeenCalledWith(
        'op-streak-4',
        expect.any(String),
      );
      expect(result.currentState).toBe('CANCELLED');
    });

    it('throws NotFound when there is no active operation with that id', () => {
      const readModel = buildReadModel();
      readModel.cancel.mockReturnValue(undefined);
      const controller = new OperationsController(readModel);

      expect(() => controller.cancelOperation('does-not-exist')).toThrow(
        NotFoundException,
      );
    });
  });
});
