export type PersistenceHealthSnapshot = {
  readonly ok: boolean;
  readonly latencyMs?: number;
  readonly error?: string;
};
