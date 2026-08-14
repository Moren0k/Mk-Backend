import { resolveStrategyGroup } from './strategy-group';

describe('resolveStrategyGroup', () => {
  it('classifies streak-4 as "oficial"', () => {
    expect(resolveStrategyGroup('streak-4')).toBe('oficial');
  });

  it('classifies streak-3 as "oficial" (desactivada, pero su grupo no cambia)', () => {
    expect(resolveStrategyGroup('streak-3')).toBe('oficial');
  });

  it('classifies an unknown strategyId as "oficial" (TEST_ONLY_STRATEGY_IDS está vacío)', () => {
    expect(resolveStrategyGroup('some-future-strategy')).toBe('oficial');
  });

  it('classifies undefined (e.g. reports with no strategy) as "oficial"', () => {
    expect(resolveStrategyGroup(undefined)).toBe('oficial');
  });
});
