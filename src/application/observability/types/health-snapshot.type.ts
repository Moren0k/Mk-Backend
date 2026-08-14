import { EngineError } from '../../../core/observability/types/engine-error.type';
import { PersistenceHealthSnapshot } from '../../../infrastructure/persistence/persistence-health.type';

/**
 * Snapshot combinado que consume `GET /api/v1/health` (Mk-Api.md Anexo A,
 * Anexo D §7): el de `EngineHealth` más la salud de la base de datos y un
 * `ok` sintetizado, que no existen juntos en ningún tipo de `core/`.
 */
export type HealthSnapshot = {
  readonly ok: boolean;
  readonly collectorConnected: boolean;
  readonly lastGameReceivedAt: Date | undefined;
  readonly gamesInMemory: number;
  readonly activeOperations: number;
  readonly registeredStrategies: number;
  readonly registeredChannels: number;
  readonly lastError: EngineError | undefined;
  readonly db: PersistenceHealthSnapshot;
};
