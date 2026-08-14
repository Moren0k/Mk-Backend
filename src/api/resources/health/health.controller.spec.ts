import { HealthSnapshotService } from '../../../application/observability/health-snapshot.service';
import { HealthController } from './health.controller';

function buildHealthSnapshotService(): jest.Mocked<HealthSnapshotService> {
  return {
    getSnapshot: jest.fn().mockResolvedValue({
      ok: true,
      collectorConnected: true,
      lastGameReceivedAt: new Date('2026-08-10T12:00:00.000Z'),
      gamesInMemory: 42,
      activeOperations: 1,
      registeredStrategies: 3,
      registeredChannels: 2,
      lastError: undefined,
      db: { ok: true, latencyMs: 12 },
    }),
  } as unknown as jest.Mocked<HealthSnapshotService>;
}

describe('HealthController', () => {
  it('returns the health snapshot mapped to HealthVm', async () => {
    const service = buildHealthSnapshotService();
    const controller = new HealthController(service);

    const result = await controller.getHealth();

    expect(service.getSnapshot).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      collectorConnected: true,
      lastGameReceivedAt: '2026-08-10T12:00:00.000Z',
      gamesInMemory: 42,
      activeOperations: 1,
      registeredStrategies: 3,
      registeredChannels: 2,
      lastError: null,
      db: { ok: true, latencyMs: 12 },
    });
  });
});
