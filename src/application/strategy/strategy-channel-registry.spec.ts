import type { StrategyExecutionGuard } from '../../core/strategy/interfaces/strategy-execution-guard.interface';
import { StrategyChannelRegistry } from './strategy-channel-registry';

function buildExecutionGuard(
  canExecute = true,
): jest.Mocked<StrategyExecutionGuard> {
  return { canExecute: jest.fn().mockReturnValue(canExecute) };
}

describe('StrategyChannelRegistry', () => {
  describe('default state (2026-08-11: nothing assigned, nothing active)', () => {
    it('starts with no strategy assigned to any channel', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());

      for (const strategyId of ['streak-3', 'streak-4', 'estrategia-pruebas']) {
        expect(registry.isAssignedTo(strategyId, 'oficial')).toBe(false);
        expect(registry.isAssignedTo(strategyId, 'pruebas')).toBe(false);
      }
    });

    it('treats a missing strategyId (e.g. reports) as "oficial"', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());

      expect(registry.isAssignedTo(undefined, 'oficial')).toBe(true);
      expect(registry.isAssignedTo(undefined, 'pruebas')).toBe(false);
    });

    it('starts with both channels inactive', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());

      expect(registry.isActive('oficial')).toBe(false);
      expect(registry.isActive('pruebas')).toBe(false);
    });

    it('reports isActiveFor as false for every strategy — unassigned, so it never runs', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());

      expect(registry.isActiveFor('streak-4')).toBe(false);
    });

    it('falls back to the caller-provided default when there is no maxMartingales override', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());

      expect(registry.getMaxMartingales('streak-4', 2)).toBe(2);
    });

    it('has no strategy assigned to either channel via getStrategyIdForChannel', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());

      expect(registry.getStrategyIdForChannel('oficial')).toBeUndefined();
      expect(registry.getStrategyIdForChannel('pruebas')).toBeUndefined();
    });
  });

  describe('assignStrategyToChannel', () => {
    it('assigns a strategy when it has no active operation', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard(true));

      const applied = registry.assignStrategyToChannel('streak-4', 'oficial');

      expect(applied).toBe(true);
      expect(registry.isAssignedTo('streak-4', 'oficial')).toBe(true);
      expect(registry.isAssignedTo('streak-4', 'pruebas')).toBe(false);
    });

    it('blocks reassignment while the strategy has an active operation, without applying the change', () => {
      const executionGuard = buildExecutionGuard(false);
      const registry = new StrategyChannelRegistry(executionGuard);
      registry.assignStrategyToChannel('streak-4', 'oficial');

      const applied = registry.assignStrategyToChannel('streak-4', 'pruebas');

      expect(applied).toBe(false);
      expect(executionGuard.canExecute).toHaveBeenCalledWith('streak-4');
    });

    it('blocks the very first assignment too, if the strategy already has an active operation', () => {
      const executionGuard = buildExecutionGuard(false);
      const registry = new StrategyChannelRegistry(executionGuard);

      const applied = registry.assignStrategyToChannel('streak-4', 'oficial');

      expect(applied).toBe(false);
      expect(registry.getStrategyIdForChannel('oficial')).toBeUndefined();
    });

    it('evicts whatever strategy occupied the channel before, so at most one remains assigned', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());
      registry.assignStrategyToChannel('streak-3', 'oficial');

      const applied = registry.assignStrategyToChannel('streak-4', 'oficial');

      expect(applied).toBe(true);
      expect(registry.getStrategyIdForChannel('oficial')).toBe('streak-4');
      expect(registry.isAssignedTo('streak-3', 'oficial')).toBe(false);
    });

    it('re-assigning the same strategy to the channel it already occupies keeps it in place', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());
      registry.assignStrategyToChannel('streak-4', 'oficial');

      const applied = registry.assignStrategyToChannel('streak-4', 'oficial');

      expect(applied).toBe(true);
      expect(registry.getStrategyIdForChannel('oficial')).toBe('streak-4');
    });

    it('blocks the whole reassignment when evicting the previous occupant would touch its active operation', () => {
      let streak3HasActiveOperation = false;
      const executionGuard = {
        canExecute: jest.fn(
          (id: string) => !(id === 'streak-3' && streak3HasActiveOperation),
        ),
      };
      const registry = new StrategyChannelRegistry(executionGuard);
      registry.assignStrategyToChannel('streak-3', 'oficial');
      streak3HasActiveOperation = true;

      const applied = registry.assignStrategyToChannel('streak-4', 'oficial');

      expect(applied).toBe(false);
      expect(registry.getStrategyIdForChannel('oficial')).toBe('streak-3');
      expect(registry.isAssignedTo('streak-4', 'oficial')).toBe(false);
    });
  });

  describe('isActiveFor', () => {
    it('is false when assigned but the channel is not active', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());
      registry.assignStrategyToChannel('streak-4', 'oficial');

      expect(registry.isActiveFor('streak-4')).toBe(false);
    });

    it('is true only once assigned AND the channel is active', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());
      registry.assignStrategyToChannel('streak-4', 'oficial');
      registry.setActive('oficial', true);

      expect(registry.isActiveFor('streak-4')).toBe(true);
    });

    it('activating a channel with no strategy assigned has no effect on any strategy', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());
      registry.setActive('oficial', true);

      expect(registry.isActiveFor('streak-4')).toBe(false);
    });
  });

  describe('setActive', () => {
    it('activates one channel without affecting the other', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());

      registry.setActive('pruebas', true);

      expect(registry.isActive('pruebas')).toBe(true);
      expect(registry.isActive('oficial')).toBe(false);
    });
  });

  describe('setMaxMartingales', () => {
    it('overrides the effective maxMartingales for a specific strategy', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());

      registry.setMaxMartingales('streak-4', 5);

      expect(registry.getMaxMartingales('streak-4', 2)).toBe(5);
      expect(registry.getMaxMartingales('estrategia-pruebas', 2)).toBe(2);
    });
  });

  describe('getMaxMartingalesOverride', () => {
    it('returns undefined when no override was ever set', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());

      expect(registry.getMaxMartingalesOverride('streak-4')).toBeUndefined();
    });

    it('returns the raw override, without falling back to any default', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());

      registry.setMaxMartingales('streak-4', 5);

      expect(registry.getMaxMartingalesOverride('streak-4')).toBe(5);
    });
  });

  describe('getStrategyIdForChannel', () => {
    it('finds the strategy currently assigned to a channel', () => {
      const registry = new StrategyChannelRegistry(buildExecutionGuard());
      registry.assignStrategyToChannel('streak-3', 'oficial');
      registry.assignStrategyToChannel('estrategia-pruebas', 'pruebas');

      expect(registry.getStrategyIdForChannel('oficial')).toBe('streak-3');
      expect(registry.getStrategyIdForChannel('pruebas')).toBe(
        'estrategia-pruebas',
      );
    });
  });
});
