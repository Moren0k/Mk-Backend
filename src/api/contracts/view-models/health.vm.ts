/**
 * Contrato público de `GET /api/v1/health` (Mk-Api.md Anexo A, Anexo D
 * §7). Nunca expone `EngineHealthSnapshot`/`HealthSnapshot` directamente:
 * fechas como string ISO-8601, `lastError` aplanado a un objeto simple o
 * `null` (nunca `undefined` en el wire).
 */
export type HealthVm = {
  readonly ok: boolean;
  readonly collectorConnected: boolean;
  readonly lastGameReceivedAt: string | null;
  readonly gamesInMemory: number;
  readonly activeOperations: number;
  readonly registeredStrategies: number;
  readonly registeredChannels: number;
  readonly lastError: {
    readonly message: string;
    readonly occurredAt: string;
  } | null;
  readonly db: {
    readonly ok: boolean;
    readonly latencyMs?: number;
    readonly error?: string;
  };
};
