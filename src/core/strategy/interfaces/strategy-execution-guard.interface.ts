/**
 * Permite a una Strategy preguntar si tiene permitido emitir una señal en
 * este instante, sin conocer el motivo (una operación activa, un cooldown,
 * un límite diario, etc.) ni ningún concepto de Operation. Quien implemente
 * esta interfaz decide la regla; la estrategia solo obedece la respuesta.
 */
export interface StrategyExecutionGuard {
  canExecute(strategyId: string): boolean;
}
