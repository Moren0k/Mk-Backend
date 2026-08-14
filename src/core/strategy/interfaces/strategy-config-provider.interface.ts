/**
 * Fuente en runtime del `maxMartingales` efectivo de una estrategia
 * (Mk-Api.md Anexo D §5, Anexo E.3): cada Strategy la consulta al
 * construir su StrategyResult en vez de usar directamente su constante
 * hardcodeada. Sigue siendo la propia estrategia quien decide su default
 * (`defaultValue`) si todavía no hay ningún override configurado.
 */
export interface StrategyConfigProvider {
  getMaxMartingales(strategyId: string, defaultValue: number): number;
}
