import { ReportMetricsSnapshot } from './report-metrics-snapshot.type';

/** Hora destacada dentro del historial completo (ver calculateSummaryMetrics). */
export type HourHighlight = {
  readonly label: string;
  readonly value: number;
};

/**
 * Resultado de calculateSummaryMetrics: extiende ReportMetricsSnapshot
 * (misma base que el reporte horario: alertas, ganadas/perdidas,
 * directas/MG1/MG2, distribución %) con el análisis agregado de todo el
 * historial en memoria desde que arrancó el proceso.
 */
export type SummaryMetricsSnapshot = ReportMetricsSnapshot & {
  readonly uptimeMs: number;

  readonly bestWinStreak: number;
  readonly worstLossStreak: number;
  readonly currentStreak: {
    readonly result: 'WON' | 'LOST' | 'NONE';
    readonly length: number;
  };

  readonly totalMartingalesUsed: number;
  readonly avgMartingalesPerWin: number;

  readonly directWinPctOfWins: number;
  readonly martingaleOneWinPctOfWins: number;
  readonly martingaleTwoWinPctOfWins: number;

  /** `won / lost`. `Infinity` si hubo victorias y ninguna derrota. */
  readonly winLossRatio: number;

  readonly alertsPerHourAvg: number;
  readonly avgEffectivenessPerHour: number;

  readonly bestAlertsHour?: HourHighlight;
  readonly bestEffectivenessHour?: HourHighlight;
  readonly worstEffectivenessHour?: HourHighlight;
};
