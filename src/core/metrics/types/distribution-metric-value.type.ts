/**
 * Resultado de DistributionMetric: distribución de resultados de las
 * últimas partidas en el HistoryStore. Inmutable, sin lógica.
 */
export type DistributionMetricValue = {
  readonly playerPct: number;
  readonly tiePct: number;
  readonly bankerPct: number;
  readonly totalGames: number;
};
