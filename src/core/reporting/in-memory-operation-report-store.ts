import { OperationReportStore } from './interfaces/operation-report-store.interface';
import { OperationClosedRecord } from './types/operation-closed-record.type';
import { OperationOpenedRecord } from './types/operation-opened-record.type';

/**
 * Implementación en memoria de OperationReportStore: dos arreglos simples,
 * sin límite de tamaño propio (a diferencia de HistoryStore) porque
 * ReportScheduler los vacía por completo tras cada reporte diario (ver
 * `clear()`), acotando el crecimiento a lo sumo a un día de operaciones.
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

  clear(): void {
    this.opened.length = 0;
    this.closed.length = 0;
  }
}
