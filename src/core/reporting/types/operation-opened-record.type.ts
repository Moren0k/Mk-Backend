/**
 * Registro mínimo de que una Operation se abrió: alcanza para contar
 * "alertas enviadas" por ventana de tiempo, sin guardar nada del resultado
 * (todavía no existe cuando esto se registra).
 */
export type OperationOpenedRecord = {
  readonly operationId: string;
  readonly strategyId: string;
  readonly openedAt: Date;
};
