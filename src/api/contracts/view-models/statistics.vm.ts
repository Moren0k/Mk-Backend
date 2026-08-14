/**
 * Contrato público de `GET /api/v1/statistics` (Mk-Api.md Anexo A,
 * corregido en §2.1b: campos reales de `Statistics`, no `DistributionMetric`).
 */
export type StatisticsVm = {
  readonly totalGames: number;
  readonly playerWinRate: number;
  readonly bankerWinRate: number;
  readonly tieRate: number;
  readonly currentStreak: {
    readonly winner: 'PLAYER' | 'BANKER' | 'TIE' | null;
    readonly length: number;
  };
};
