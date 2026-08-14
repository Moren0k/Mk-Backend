import { filterByStrategyGroup } from './report-group-filter';

type Record = { readonly operationId: string; readonly strategyId: string };

function build(operationId: string, strategyId: string): Record {
  return { operationId, strategyId };
}

describe('filterByStrategyGroup', () => {
  const records = [build('op-1', 'streak-3'), build('op-3', 'streak-4')];

  it('keeps only records classified as "oficial"', () => {
    const result = filterByStrategyGroup(records, 'oficial');

    expect(result.map((r) => r.operationId)).toEqual(['op-1', 'op-3']);
  });

  it('returns nothing for "pruebas" while TEST_ONLY_STRATEGY_IDS está vacío', () => {
    const result = filterByStrategyGroup(records, 'pruebas');

    expect(result).toEqual([]);
  });

  it('returns an empty array when nothing matches the group', () => {
    expect(
      filterByStrategyGroup([build('op-1', 'streak-4')], 'pruebas'),
    ).toEqual([]);
  });
});
