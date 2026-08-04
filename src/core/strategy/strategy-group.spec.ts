import { resolveStrategyGroup } from './strategy-group';

describe('resolveStrategyGroup', () => {
  it('classifies streak-4 as "pruebas"', () => {
    expect(resolveStrategyGroup('streak-4')).toBe('pruebas');
  });

  it('classifies streak-3 as "oficial"', () => {
    expect(resolveStrategyGroup('streak-3')).toBe('oficial');
  });

  it('classifies an unknown strategyId as "oficial"', () => {
    expect(resolveStrategyGroup('some-future-strategy')).toBe('oficial');
  });

  it('classifies undefined (e.g. reports with no strategy) as "oficial"', () => {
    expect(resolveStrategyGroup(undefined)).toBe('oficial');
  });
});
