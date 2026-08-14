import { BadRequestException, ConflictException } from '@nestjs/common';

import { StrategyChannelRegistry } from '../../../application/strategy/strategy-channel-registry';
import { ChannelsController } from './channels.controller';

function buildController(canExecute = true): {
  controller: ChannelsController;
  registry: StrategyChannelRegistry;
} {
  const registry = new StrategyChannelRegistry({
    canExecute: () => canExecute,
  });
  return { controller: new ChannelsController(registry), registry };
}

describe('ChannelsController', () => {
  describe('getChannel', () => {
    it('returns the default state of a channel: no strategy, inactive', () => {
      const { controller } = buildController();

      expect(controller.getChannel('oficial')).toEqual({
        channel: 'oficial',
        strategyId: null,
        active: false,
        maxMartingalesOverride: null,
      });
    });

    it('rejects an invalid channel', () => {
      const { controller } = buildController();

      expect(() => controller.getChannel('discord')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('patchChannel', () => {
    it('assigns a strategy to a channel', () => {
      const { controller } = buildController();

      const result = controller.patchChannel('pruebas', {
        strategyId: 'streak-4',
      });

      expect(result.strategyId).toBe('streak-4');
      expect(result.active).toBe(false);
    });

    it('throws Conflict when the strategy has an active operation', () => {
      const { controller } = buildController(false);

      expect(() =>
        controller.patchChannel('pruebas', { strategyId: 'streak-4' }),
      ).toThrow(ConflictException);
    });

    it('throws BadRequest for a non-string strategyId', () => {
      const { controller } = buildController();

      expect(() =>
        controller.patchChannel('oficial', { strategyId: 42 }),
      ).toThrow(BadRequestException);
    });

    it('activates a channel', () => {
      const { controller } = buildController();

      const result = controller.patchChannel('pruebas', { active: true });

      expect(result.active).toBe(true);
    });

    it('throws BadRequest for a non-boolean active', () => {
      const { controller } = buildController();

      expect(() =>
        controller.patchChannel('oficial', { active: 'yes' }),
      ).toThrow(BadRequestException);
    });

    it('sets maxMartingales for the strategy currently assigned to the channel', () => {
      const { controller } = buildController();
      controller.patchChannel('oficial', { strategyId: 'streak-3' });

      const result = controller.patchChannel('oficial', {
        maxMartingales: 5,
      });

      expect(result.maxMartingalesOverride).toBe(5);
    });

    it('throws BadRequest when setting maxMartingales with no strategy assigned to the channel', () => {
      const { controller } = buildController();

      expect(() =>
        controller.patchChannel('oficial', { maxMartingales: 5 }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequest for an invalid maxMartingales value', () => {
      const { controller } = buildController();
      controller.patchChannel('oficial', { strategyId: 'streak-3' });

      expect(() =>
        controller.patchChannel('oficial', { maxMartingales: -1 }),
      ).toThrow(BadRequestException);
    });

    it('applies an assignment, activation and maxMartingales together, targeting the new strategy', () => {
      const { controller } = buildController();

      const result = controller.patchChannel('pruebas', {
        strategyId: 'streak-4',
        active: true,
        maxMartingales: 3,
      });

      expect(result.strategyId).toBe('streak-4');
      expect(result.active).toBe(true);
      expect(result.maxMartingalesOverride).toBe(3);
    });

    it('throws BadRequest for an invalid channel path param', () => {
      const { controller } = buildController();

      expect(() => controller.patchChannel('discord', {})).toThrow(
        BadRequestException,
      );
    });
  });
});
