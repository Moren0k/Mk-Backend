import { filterByContext } from './report-group-filter';

type Record = {
  readonly operationId: string;
  readonly context: 'oficial' | 'pruebas';
};

function build(operationId: string, context: 'oficial' | 'pruebas'): Record {
  return { operationId, context };
}

describe('filterByContext', () => {
  const records = [
    build('op-1', 'oficial'),
    build('op-2', 'pruebas'),
    build('op-3', 'oficial'),
  ];

  it('keeps only records whose context is "oficial"', () => {
    const result = filterByContext(records, 'oficial');

    expect(result.map((r) => r.operationId)).toEqual(['op-1', 'op-3']);
  });

  it('keeps only records whose context is "pruebas"', () => {
    const result = filterByContext(records, 'pruebas');

    expect(result.map((r) => r.operationId)).toEqual(['op-2']);
  });

  it('returns an empty array when nothing matches the group', () => {
    expect(filterByContext([build('op-1', 'oficial')], 'pruebas')).toEqual([]);
  });

  it('never depends on strategyId, only on the recorded context', () => {
    // Dos records de la MISMA estrategia, pero abiertos con contextos
    // distintos (p. ej. la estrategia fue reasignada de canal entre uno y
    // otro): cada uno conserva su propio contexto histórico.
    const sameStrategyDifferentContext = [
      { operationId: 'a', strategyId: 'streak-4', context: 'pruebas' as const },
      { operationId: 'b', strategyId: 'streak-4', context: 'oficial' as const },
    ];

    expect(
      filterByContext(sameStrategyDifferentContext, 'pruebas').map(
        (r) => r.operationId,
      ),
    ).toEqual(['a']);
    expect(
      filterByContext(sameStrategyDifferentContext, 'oficial').map(
        (r) => r.operationId,
      ),
    ).toEqual(['b']);
  });
});
