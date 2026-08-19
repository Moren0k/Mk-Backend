import { OperationState } from '../../enums/operation-state.enum';
import { StrategyGroup } from '../../strategy/strategy-group';

/**
 * Registro mínimo de una Operation ya finalizada: exactamente los campos
 * que ReportMetricsCalculator necesita para todas las métricas del reporte
 * (efectividad, directas, martingalas usadas, martingalas agotadas). Nunca
 * guarda el snapshot completo ni el historial de transiciones: eso sería
 * información innecesaria para un reporte agregado.
 *
 * `context` viaja igual que en `OperationOpenedRecord`: copiado tal cual
 * desde `OperationSnapshot.context`, fijado para siempre en el momento en
 * que la operación se abrió.
 */
export type OperationClosedRecord = {
  readonly operationId: string;
  readonly strategyId: string;
  readonly context: StrategyGroup;
  readonly openedAt: Date;
  readonly closedAt: Date;
  readonly result: OperationState.WON | OperationState.LOST;
  readonly martingalesUsed: number;
  readonly maxMartingales: number;
};
