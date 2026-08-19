import { StrategyGroup } from '../strategy/strategy-group';
import { filterByContext } from './report-group-filter';
import { OperationClosedRecord } from './types/operation-closed-record.type';
import { OperationOpenedRecord } from './types/operation-opened-record.type';

/**
 * Regla base compartida por ReportScheduler (reporte horario) y
 * SummaryReportService (comando/API RESUMEN): "filtrar los registros de un
 * grupo y calcular sus métricas" es exactamente el mismo paso en ambos
 * flujos, solo cambia qué calculadora usan (calculateReportMetrics vs.
 * calculateSummaryMetrics) y con qué contexto (ventana horaria vs. todo el
 * historial). Ese contexto se recibe aquí como parámetro de `calculate`,
 * nunca como estado compartido: cada llamador sigue calculando oficial y
 * pruebas de forma completamente independiente.
 */
export function buildGroupMetrics<TMetrics>(
  opened: ReadonlyArray<OperationOpenedRecord>,
  closed: ReadonlyArray<OperationClosedRecord>,
  group: StrategyGroup,
  calculate: (
    opened: ReadonlyArray<OperationOpenedRecord>,
    closed: ReadonlyArray<OperationClosedRecord>,
  ) => TMetrics,
): TMetrics {
  return calculate(
    filterByContext(opened, group),
    filterByContext(closed, group),
  );
}
