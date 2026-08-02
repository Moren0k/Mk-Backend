import { EngineError } from './engine-error.type';

/**
 * Vista de solo lectura del estado operativo del motor en un instante
 * dado. EngineHealth la construye consultando directamente a los
 * componentes vivos (no escucha eventos): es una clase de consulta, no un
 * acumulador.
 */
export type EngineHealthSnapshot = {
  readonly collectorConnected: boolean;
  readonly lastGameReceivedAt: Date | undefined;
  readonly gamesInMemory: number;
  readonly activeOperations: number;
  readonly registeredStrategies: number;
  readonly registeredChannels: number;
  readonly lastError: EngineError | undefined;
};
