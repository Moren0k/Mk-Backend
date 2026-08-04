import {
  resolveStrategyGroup,
  StrategyGroup,
} from '../strategy/strategy-group';

/**
 * Filtra records de reporte (opened/closed) para que solo quede el grupo
 * pedido: separa por completo los datos de estrategias oficiales de los de
 * estrategias de pruebas antes de calcular cualquier métrica (ver
 * ReportScheduler y SummaryReportService), para que ningún reporte vuelva a
 * mezclar streak-3 con streak-4.
 */
export function filterByStrategyGroup<T extends { strategyId: string }>(
  records: ReadonlyArray<T>,
  group: StrategyGroup,
): ReadonlyArray<T> {
  return records.filter(
    (record) => resolveStrategyGroup(record.strategyId) === group,
  );
}
