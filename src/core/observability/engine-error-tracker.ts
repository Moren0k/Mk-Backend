import { EngineError } from './types/engine-error.type';

/**
 * Registro central del último error operativo del motor (fallo de
 * conexión SSE, operación que falló internamente, canal de notificación
 * caído...). No es un DomainEvent: es un detalle puramente operativo, sin
 * relevancia de negocio, que EngineHealth expone en su snapshot.
 *
 * Un único punto de escritura por cada lugar que ya hace
 * `logger.error(...)`; EngineHealth solo lee.
 */
export class EngineErrorTracker {
  private lastError: EngineError | undefined;

  recordError(message: string): void {
    this.lastError = Object.freeze({ message, occurredAt: new Date() });
  }

  getLastError(): EngineError | undefined {
    return this.lastError;
  }
}
