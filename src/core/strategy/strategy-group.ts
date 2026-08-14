/**
 * A qué grupo pertenece una estrategia: "oficial" (producción) o "pruebas"
 * (corre en paralelo, sus resultados nunca deben mezclarse con los de
 * producción ni en Telegram ni en reportes).
 *
 * Único lugar del sistema que decide esta clasificación — reutilizado tanto
 * por el enrutamiento de Telegram (NotificationModule) como por el filtrado
 * de métricas de reportes (reporting/): agregar una estrategia de pruebas
 * nueva es un único cambio, aquí.
 */
export type StrategyGroup = 'oficial' | 'pruebas';

const TEST_ONLY_STRATEGY_IDS: ReadonlySet<string> = new Set([]);

export function resolveStrategyGroup(
  strategyId: string | undefined,
): StrategyGroup {
  return strategyId !== undefined && TEST_ONLY_STRATEGY_IDS.has(strategyId)
    ? 'pruebas'
    : 'oficial';
}
