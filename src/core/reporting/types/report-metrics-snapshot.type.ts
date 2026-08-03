/**
 * Resultado de ReportMetricsCalculator: todas las métricas mínimas de un
 * reporte (horario o diario). Misma forma para ambos, tal como pide el
 * reporte diario ("exactamente las mismas métricas del reporte horario,
 * pero acumuladas").
 */
export type ReportMetricsSnapshot = {
  readonly alertsSent: number;
  readonly closedOperations: number;
  readonly won: number;
  readonly lost: number;
  readonly effectivenessPct: number;
  readonly directWins: number;
  readonly martingaleOneWins: number;
  readonly martingaleTwoWins: number;
  readonly martingalesExhausted: number;
  readonly distribution: {
    readonly directPct: number;
    readonly martingaleOnePct: number;
    readonly martingaleTwoPct: number;
    readonly lostPct: number;
  };
};
