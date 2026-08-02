import { EngineMetricsSnapshot } from './types/engine-metrics-snapshot.type';

/**
 * Contadores puramente incrementales del motor completo. Cada método es
 * O(1); nunca consulta otro módulo. EngineMetricsService (application) es
 * quien la alimenta al escuchar los eventos de dominio correspondientes.
 */
export class EngineMetrics {
  private gamesReceived = 0;
  private signalsGenerated = 0;
  private operationsOpened = 0;
  private operationsWon = 0;
  private operationsLost = 0;
  private martingaleOneReachedCount = 0;
  private martingaleTwoReachedCount = 0;
  private notificationsSent = 0;
  private notificationsFailed = 0;

  recordGameReceived(): void {
    this.gamesReceived += 1;
  }

  recordSignalGenerated(): void {
    this.signalsGenerated += 1;
  }

  recordOperationOpened(): void {
    this.operationsOpened += 1;
  }

  recordOperationWon(): void {
    this.operationsWon += 1;
  }

  recordOperationLost(): void {
    this.operationsLost += 1;
  }

  recordMartingaleOneReached(): void {
    this.martingaleOneReachedCount += 1;
  }

  recordMartingaleTwoReached(): void {
    this.martingaleTwoReachedCount += 1;
  }

  recordNotificationSent(): void {
    this.notificationsSent += 1;
  }

  recordNotificationFailed(): void {
    this.notificationsFailed += 1;
  }

  toSnapshot(): EngineMetricsSnapshot {
    return Object.freeze({
      gamesReceived: this.gamesReceived,
      signalsGenerated: this.signalsGenerated,
      operationsOpened: this.operationsOpened,
      operationsWon: this.operationsWon,
      operationsLost: this.operationsLost,
      martingaleOneReachedCount: this.martingaleOneReachedCount,
      martingaleTwoReachedCount: this.martingaleTwoReachedCount,
      notificationsSent: this.notificationsSent,
      notificationsFailed: this.notificationsFailed,
    });
  }
}
