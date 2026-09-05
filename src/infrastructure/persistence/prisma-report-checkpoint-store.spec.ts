import { PrismaReportCheckpointStore } from './prisma-report-checkpoint-store';
import { PrismaService } from './prisma.service';

type MockReportCheckpointDelegate = {
  findMany: jest.Mock;
  upsert: jest.Mock;
};

function buildPrisma(
  delegate: MockReportCheckpointDelegate,
): jest.Mocked<Pick<PrismaService, 'getClient'>> {
  return {
    getClient: jest.fn().mockReturnValue({ reportCheckpoint: delegate }),
  };
}

describe('PrismaReportCheckpointStore', () => {
  let delegate: MockReportCheckpointDelegate;

  beforeEach(() => {
    delegate = { findMany: jest.fn(), upsert: jest.fn() };
  });

  describe('loadAll', () => {
    it('maps every persisted row to a ReportCheckpointSnapshot', async () => {
      const firstStartedAt = new Date('2026-08-01T15:00:00.000Z');
      delegate.findMany.mockResolvedValue([
        {
          channel: 'oficial',
          won: 8,
          lost: 2,
          alertsSent: 10,
          firstStartedAt,
        },
      ]);
      const store = new PrismaReportCheckpointStore(
        buildPrisma(delegate) as unknown as PrismaService,
      );

      const rows = await store.loadAll();

      expect(rows).toEqual([
        { channel: 'oficial', won: 8, lost: 2, alertsSent: 10, firstStartedAt },
      ]);
    });

    it('never throws when the client is unavailable — returns [] instead', async () => {
      const prisma: jest.Mocked<Pick<PrismaService, 'getClient'>> = {
        getClient: jest.fn().mockImplementation(() => {
          throw new Error('PrismaClient no está disponible');
        }),
      };
      const store = new PrismaReportCheckpointStore(
        prisma as unknown as PrismaService,
      );

      await expect(store.loadAll()).resolves.toEqual([]);
    });

    it('never throws when the query itself rejects — returns [] instead', async () => {
      delegate.findMany.mockRejectedValue(new Error('conexión perdida'));
      const store = new PrismaReportCheckpointStore(
        buildPrisma(delegate) as unknown as PrismaService,
      );

      await expect(store.loadAll()).resolves.toEqual([]);
    });
  });

  describe('save', () => {
    it('upserts by channel, creating with firstStartedAt and updating only the counters', async () => {
      const firstStartedAt = new Date('2026-08-01T15:00:00.000Z');
      const store = new PrismaReportCheckpointStore(
        buildPrisma(delegate) as unknown as PrismaService,
      );

      await store.save({
        channel: 'oficial',
        won: 8,
        lost: 2,
        alertsSent: 10,
        firstStartedAt,
      });

      expect(delegate.upsert).toHaveBeenCalledWith({
        where: { channel: 'oficial' },
        create: {
          channel: 'oficial',
          won: 8,
          lost: 2,
          alertsSent: 10,
          firstStartedAt,
        },
        update: { won: 8, lost: 2, alertsSent: 10 },
      });
    });

    it('never throws when the client is unavailable', async () => {
      const prisma: jest.Mocked<Pick<PrismaService, 'getClient'>> = {
        getClient: jest.fn().mockImplementation(() => {
          throw new Error('PrismaClient no está disponible');
        }),
      };
      const store = new PrismaReportCheckpointStore(
        prisma as unknown as PrismaService,
      );

      await expect(
        store.save({
          channel: 'oficial',
          won: 0,
          lost: 0,
          alertsSent: 0,
          firstStartedAt: new Date(),
        }),
      ).resolves.toBeUndefined();
    });

    it('never throws when the upsert itself rejects', async () => {
      delegate.upsert.mockRejectedValue(new Error('conexión perdida'));
      const store = new PrismaReportCheckpointStore(
        buildPrisma(delegate) as unknown as PrismaService,
      );

      await expect(
        store.save({
          channel: 'pruebas',
          won: 0,
          lost: 0,
          alertsSent: 0,
          firstStartedAt: new Date(),
        }),
      ).resolves.toBeUndefined();
    });
  });
});
