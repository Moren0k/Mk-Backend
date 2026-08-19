import { StrategyGroup } from '../strategy/strategy-group';

/**
 * Filtra records de reporte (opened/closed) para que solo quede el grupo
 * pedido: separa por completo los datos de OFICIAL de los de PRUEBAS antes
 * de calcular cualquier métrica (ver ReportScheduler y SummaryReportService).
 *
 * Filtra por `record.context` — el valor grabado una única vez cuando la
 * operación se abrió (ver `Operation.context`) — nunca por `strategyId`.
 * Esto es deliberado: una estrategia puede reasignarse a otro canal después
 * de que sus operaciones ya cerraron, y eso no debe reclasificar
 * retroactivamente ningún reporte histórico. `context` es la única fuente
 * de verdad aquí.
 */
export function filterByContext<T extends { context: StrategyGroup }>(
  records: ReadonlyArray<T>,
  group: StrategyGroup,
): ReadonlyArray<T> {
  return records.filter((record) => record.context === group);
}
