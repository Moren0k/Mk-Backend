import type { HealthSnapshot } from '../../../application/observability/types/health-snapshot.type';
import type { HealthVm } from '../view-models/health.vm';

export function toHealthVm(snapshot: HealthSnapshot): HealthVm {
  return {
    ok: snapshot.ok,
    collectorConnected: snapshot.collectorConnected,
    lastGameReceivedAt: snapshot.lastGameReceivedAt?.toISOString() ?? null,
    gamesInMemory: snapshot.gamesInMemory,
    activeOperations: snapshot.activeOperations,
    registeredStrategies: snapshot.registeredStrategies,
    registeredChannels: snapshot.registeredChannels,
    lastError: snapshot.lastError
      ? {
          message: snapshot.lastError.message,
          occurredAt: snapshot.lastError.occurredAt.toISOString(),
        }
      : null,
    db: {
      ok: snapshot.db.ok,
      ...(snapshot.db.latencyMs !== undefined
        ? { latencyMs: snapshot.db.latencyMs }
        : {}),
      ...(snapshot.db.error !== undefined ? { error: snapshot.db.error } : {}),
    },
  };
}
