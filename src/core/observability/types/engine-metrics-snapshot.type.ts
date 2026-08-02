/**
 * Vista de solo lectura de los contadores acumulados del motor.
 */
export type EngineMetricsSnapshot = {
  readonly gamesReceived: number;
  readonly signalsGenerated: number;
  readonly operationsOpened: number;
  readonly operationsWon: number;
  readonly operationsLost: number;
  readonly martingaleOneReachedCount: number;
  readonly martingaleTwoReachedCount: number;
  readonly notificationsSent: number;
  readonly notificationsFailed: number;
};
