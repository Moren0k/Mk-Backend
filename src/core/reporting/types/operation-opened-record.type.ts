import { StrategyGroup } from '../../strategy/strategy-group';

/**
 * Registro mínimo de que una Operation se abrió: alcanza para contar
 * "alertas enviadas" por ventana de tiempo, sin guardar nada del resultado
 * (todavía no existe cuando esto se registra).
 *
 * `context` es el dato que separa oficial de pruebas: se copia tal cual de
 * `OperationSnapshot.context` (fijado una única vez al abrir la operación,
 * ver `Operation.open`) — nunca se deriva de `strategyId` en este punto ni
 * en ningún lugar que lea este registro (ver `report-group-filter.ts`).
 */
export type OperationOpenedRecord = {
  readonly operationId: string;
  readonly strategyId: string;
  readonly context: StrategyGroup;
  readonly openedAt: Date;
};
