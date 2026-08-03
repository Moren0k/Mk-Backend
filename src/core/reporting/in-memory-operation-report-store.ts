import { OperationReportStore } from './interfaces/operation-report-store.interface';
import { OperationClosedRecord } from './types/operation-closed-record.type';
import { OperationOpenedRecord } from './types/operation-opened-record.type';

/**
 * Implementación en memoria de OperationReportStore: dos arreglos simples,
 * sin límite de tamaño ni mecanismo de limpieza — crecen mientras el
 * proceso siga vivo. Es intencional: `getAllOpened`/`getAllClosed` son la
 * fuente del resumen completo bajo demanda (ver SummaryReportService), que
 * debe poder reflejar absolutamente todo lo ocurrido desde el arranque.
 *
 * Ningún consumidor externo debe importar esta clase directamente, solo el
 * contrato OperationReportStore (mismo patrón que InMemoryHistoryStore e
 * InMemoryDomainEventBus).
 */
export class InMemoryOperationReportStore implements OperationReportStore {
  private readonly opened: OperationOpenedRecord[] = [];
  private readonly closed: OperationClosedRecord[] = [];

  recordOpened(record: OperationOpenedRecord): void {
    this.opened.push(record);
  }

  recordClosed(record: OperationClosedRecord): void {
    this.closed.push(record);
  }

  getOpenedBetween(from: Date, to: Date): ReadonlyArray<OperationOpenedRecord> {
    return this.opened.filter(
      (record) => record.openedAt >= from && record.openedAt < to,
    );
  }

  getClosedBetween(from: Date, to: Date): ReadonlyArray<OperationClosedRecord> {
    return this.closed.filter(
      (record) => record.closedAt >= from && record.closedAt < to,
    );
  }

  getAllOpened(): ReadonlyArray<OperationOpenedRecord> {
    return [...this.opened];
  }

  getAllClosed(): ReadonlyArray<OperationClosedRecord> {
    return [...this.closed];
  }
}
