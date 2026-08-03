import { OperationClosedRecord } from '../types/operation-closed-record.type';
import { OperationOpenedRecord } from '../types/operation-opened-record.type';

/**
 * Contrato de persistencia para los registros mínimos de Operation que
 * alimentan los reportes. Hoy solo existe una implementación en memoria
 * (InMemoryOperationReportStore); el día que exista base de datos, basta
 * con una nueva implementación de este contrato y cambiar el provider en
 * ReportingModule — ReportScheduler y OperationReportRecorder no cambian.
 */
export interface OperationReportStore {
  recordOpened(record: OperationOpenedRecord): void;
  recordClosed(record: OperationClosedRecord): void;

  /** Aperturas con `openedAt` en `[from, to)`. */
  getOpenedBetween(from: Date, to: Date): ReadonlyArray<OperationOpenedRecord>;

  /** Cierres con `closedAt` en `[from, to)`. */
  getClosedBetween(from: Date, to: Date): ReadonlyArray<OperationClosedRecord>;

  /** Elimina todos los registros. Se usa tras el reporte diario: ya fueron
   *  reportados (horario + diario) y no hace falta conservarlos. */
  clear(): void;
}
