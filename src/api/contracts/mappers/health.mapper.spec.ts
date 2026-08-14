import type { HealthSnapshot } from '../../../application/observability/types/health-snapshot.type';
import { toHealthVm } from './health.mapper';

function buildSnapshot(
  overrides: Partial<HealthSnapshot> = {},
): HealthSnapshot {
  return {
    ok: true,
    collectorConnected: true,
    lastGameReceivedAt: new Date('2026-08-10T12:00:00.000Z'),
    gamesInMemory: 42,
    activeOperations: 1,
    registeredStrategies: 3,
    registeredChannels: 2,
    lastError: undefined,
    db: { ok: true, latencyMs: 12 },
    ...overrides,
  };
}

describe('toHealthVm', () => {
  it('serializes dates as ISO-8601 strings', () => {
    const vm = toHealthVm(buildSnapshot());

    expect(vm.lastGameReceivedAt).toBe('2026-08-10T12:00:00.000Z');
  });

  it('maps a missing lastGameReceivedAt to null, never undefined', () => {
    const vm = toHealthVm(buildSnapshot({ lastGameReceivedAt: undefined }));

    expect(vm.lastGameReceivedAt).toBeNull();
  });

  it('flattens lastError to a plain object with an ISO timestamp', () => {
    const vm = toHealthVm(
      buildSnapshot({
        lastError: {
          message: 'SSE desconectado',
          occurredAt: new Date('2026-08-10T11:00:00.000Z'),
        },
      }),
    );

    expect(vm.lastError).toEqual({
      message: 'SSE desconectado',
      occurredAt: '2026-08-10T11:00:00.000Z',
    });
  });

  it('maps a missing lastError to null, never undefined', () => {
    const vm = toHealthVm(buildSnapshot({ lastError: undefined }));

    expect(vm.lastError).toBeNull();
  });

  it('never leaks latencyMs/error when the database health omits them', () => {
    const vm = toHealthVm(buildSnapshot({ db: { ok: false } }));

    expect(vm.db).toEqual({ ok: false });
    expect(vm.db.latencyMs).toBeUndefined();
  });
});
