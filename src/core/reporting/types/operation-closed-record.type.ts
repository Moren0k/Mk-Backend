import { OperationState } from '../../enums/operation-state.enum';

/**
 * Registro mínimo de una Operation ya finalizada: exactamente los campos
 * que ReportMetricsCalculator necesita para todas las métricas del reporte
 * (efectividad, directas, martingalas usadas, martingalas agotadas). Nunca
 * guarda el snapshot completo ni el historial de transiciones: eso sería
 * información innecesaria para un reporte agregado.
 */
export type OperationClosedRecord = {
  readonly operationId: string;
  readonly openedAt: Date;
  readonly closedAt: Date;
  readonly result: OperationState.WON | OperationState.LOST;
  readonly martingalesUsed: number;
  readonly maxMartingales: number;
};
