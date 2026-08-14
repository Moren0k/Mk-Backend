import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { EngineHealth } from './engine-health';
import { HealthSnapshotService } from './health-snapshot.service';

function buildEngineHealth(
  collectorConnected: boolean,
): jest.Mocked<EngineHealth> {
  return {
    getSnapshot: jest.fn().mockReturnValue({
      collectorConnected,
      lastGameReceivedAt: new Date('2026-08-10T12:00:00.000Z'),
      gamesInMemory: 42,
      activeOperations: 1,
      registeredStrategies: 3,
      registeredChannels: 2,
      lastError: undefined,
    }),
  } as unknown as jest.Mocked<EngineHealth>;
}

function buildPrismaService(db: {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}): jest.Mocked<PrismaService> {
  return {
    checkHealth: jest.fn().mockResolvedValue(db),
  } as unknown as jest.Mocked<PrismaService>;
}

describe('HealthSnapshotService', () => {
  it('merges the engine snapshot with the database health', async () => {
    const service = new HealthSnapshotService(
      buildEngineHealth(true),
      buildPrismaService({ ok: true, latencyMs: 12 }),
    );

    const snapshot = await service.getSnapshot();

    expect(snapshot).toEqual(
      expect.objectContaining({
        collectorConnected: true,
        gamesInMemory: 42,
        db: { ok: true, latencyMs: 12 },
      }),
    );
  });

  it('sets ok from collectorConnected, regardless of database health', async () => {
    const connectedButDbDown = new HealthSnapshotService(
      buildEngineHealth(true),
      buildPrismaService({ ok: false, error: 'sin DATABASE_URL' }),
    );

    const snapshot = await connectedButDbDown.getSnapshot();

    expect(snapshot.ok).toBe(true);
    expect(snapshot.db.ok).toBe(false);
  });

  it('reports ok=false when the collector is disconnected, even if the database is healthy', async () => {
    const disconnected = new HealthSnapshotService(
      buildEngineHealth(false),
      buildPrismaService({ ok: true, latencyMs: 5 }),
    );

    const snapshot = await disconnected.getSnapshot();

    expect(snapshot.ok).toBe(false);
  });
});
