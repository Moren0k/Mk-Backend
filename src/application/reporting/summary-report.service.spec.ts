import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { OperationState } from '../../core/enums/operation-state.enum';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { NotificationSeverity } from '../../core/enums/notification-severity.enum';
import { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { NotificationFactory } from '../../core/notification/notification.factory';
import {
  createNotification,
  Notification,
} from '../../core/notification/notification.type';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import type { OperationReportStore } from '../../core/reporting/interfaces/operation-report-store.interface';
import type { ReportCheckpointStore } from '../../core/reporting/interfaces/report-checkpoint-store.interface';
import { SummaryReportService } from './summary-report.service';

function buildNotification(channel: NotificationChannelType): Notification {
  return createNotification({
    title: 'title',
    message: 'message',
    severity: NotificationSeverity.INFO,
    channel,
  });
}

function buildChannel(
  overrides: Partial<NotificationChannel> = {},
): jest.Mocked<NotificationChannel> {
  return {
    getChannelType: jest.fn().mockReturnValue(NotificationChannelType.TELEGRAM),
    name: jest.fn().mockReturnValue('Telegram'),
    enabled: jest.fn().mockReturnValue(true),
    supports: jest.fn().mockReturnValue(true),
    send: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function buildTestChannel(
  overrides: Partial<NotificationChannel> = {},
): jest.Mocked<NotificationChannel> {
  return buildChannel({
    getChannelType: jest
      .fn()
      .mockReturnValue(NotificationChannelType.TELEGRAM_PRUEBAS),
    ...overrides,
  });
}

describe('SummaryReportService', () => {
  let domainEventBus: jest.Mocked<DomainEventBus>;
  let store: jest.Mocked<OperationReportStore>;
  let notificationFactory: jest.Mocked<
    Pick<NotificationFactory, 'createForSummaryReport'>
  >;
  let errorTracker: EngineErrorTracker;
  let checkpointStore: jest.Mocked<ReportCheckpointStore>;

  beforeEach(() => {
    domainEventBus = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      publish: jest.fn(),
      publishMany: jest.fn(),
      clear: jest.fn(),
    };
    store = {
      recordOpened: jest.fn(),
      recordClosed: jest.fn(),
      getOpenedBetween: jest.fn().mockReturnValue([]),
      getClosedBetween: jest.fn().mockReturnValue([]),
      getAllOpened: jest.fn().mockReturnValue([]),
      getAllClosed: jest.fn().mockReturnValue([]),
    };
    notificationFactory = {
      createForSummaryReport: jest
        .fn()
        .mockImplementation(
          (_: unknown, __: unknown, channel: NotificationChannelType) =>
            buildNotification(channel),
        ),
    };
    errorTracker = new EngineErrorTracker();
    checkpointStore = {
      loadAll: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    };
  });

  function build(channels: NotificationChannel[]): SummaryReportService {
    return new SummaryReportService(
      store,
      domainEventBus,
      channels,
      notificationFactory as unknown as NotificationFactory,
      errorTracker,
      checkpointStore,
    );
  }

  it('reads the entire history (getAllOpened/getAllClosed), not a time window', () => {
    const service = build([buildChannel()]);

    service.generateAndDispatch();

    expect(store.getAllOpened).toHaveBeenCalledTimes(1);
    expect(store.getAllClosed).toHaveBeenCalledTimes(1);
    expect(store.getOpenedBetween).not.toHaveBeenCalled();
    expect(store.getClosedBetween).not.toHaveBeenCalled();
  });

  describe('getSnapshot()', () => {
    it('computes the same oficial/pruebas metrics as generateAndDispatch, without dispatching anything', () => {
      store.getAllOpened.mockReturnValue([
        {
          operationId: 'op-1',
          strategyId: 'streak-4',
          context: 'oficial',
          openedAt: new Date('2026-08-01T15:00:00.000Z'),
        },
      ]);
      const official = buildChannel();
      const test = buildTestChannel();
      const service = build([official, test]);

      const snapshot = service.getSnapshot();

      expect(snapshot.oficial.alertsSent).toBe(1);
      expect(snapshot.pruebas.alertsSent).toBe(0);
      expect(official.send).not.toHaveBeenCalled();
      expect(test.send).not.toHaveBeenCalled();
      expect(notificationFactory.createForSummaryReport).not.toHaveBeenCalled();
    });
  });

  it('returns independent oficial/pruebas metrics, filtered by the recorded context — never by strategyId', () => {
    // Deliberado: ambos registros vienen de la MISMA estrategia
    // ('streak-4'), como si hubiera sido reasignada de canal entre una
    // operación y la siguiente. Si el filtro derivara del strategyId (el
    // bug original), ambas terminarían en el mismo grupo. Con `context`
    // grabado en cada registro, se separan correctamente sin importar la
    // estrategia.
    store.getAllOpened.mockReturnValue([
      {
        operationId: 'op-1',
        strategyId: 'streak-4',
        context: 'pruebas',
        openedAt: new Date('2026-08-01T15:00:00.000Z'),
      },
      {
        operationId: 'op-2',
        strategyId: 'streak-4',
        context: 'oficial',
        openedAt: new Date('2026-08-01T15:00:00.000Z'),
      },
    ]);
    store.getAllClosed.mockReturnValue([
      {
        operationId: 'op-1',
        strategyId: 'streak-4',
        context: 'pruebas',
        openedAt: new Date('2026-08-01T15:00:00.000Z'),
        closedAt: new Date('2026-08-01T15:05:00.000Z'),
        result: OperationState.WON,
        martingalesUsed: 0,
        maxMartingales: 2,
      },
      {
        operationId: 'op-2',
        strategyId: 'streak-4',
        context: 'oficial',
        openedAt: new Date('2026-08-01T15:00:00.000Z'),
        closedAt: new Date('2026-08-01T15:05:00.000Z'),
        result: OperationState.LOST,
        martingalesUsed: 2,
        maxMartingales: 2,
      },
    ]);
    const service = build([]);

    const result = service.generateAndDispatch();

    expect(result.oficial.alertsSent).toBe(1);
    expect(result.oficial.won).toBe(0);
    expect(result.oficial.lost).toBe(1);
    expect(result.pruebas.alertsSent).toBe(1);
    expect(result.pruebas.won).toBe(1);
    expect(result.pruebas.lost).toBe(0);
  });

  it('sends only to the official channel, with only the official metrics, when selector is "oficial"', () => {
    const official = buildChannel();
    const test = buildTestChannel();
    const service = build([official, test]);

    service.generateAndDispatch('oficial');

    expect(official.send).toHaveBeenCalledTimes(1);
    expect(test.send).not.toHaveBeenCalled();
    expect(notificationFactory.createForSummaryReport).toHaveBeenCalledTimes(1);
  });

  it('sends only to the test channel, with only the test metrics, when selector is "pruebas"', () => {
    const official = buildChannel();
    const test = buildTestChannel();
    const service = build([official, test]);

    service.generateAndDispatch('pruebas');

    expect(official.send).not.toHaveBeenCalled();
    expect(test.send).toHaveBeenCalledTimes(1);
  });

  it('sends two independent messages (one per channel, each with its own metrics) when selector is "todos"', () => {
    store.getAllOpened.mockReturnValue([
      {
        operationId: 'op-1',
        strategyId: 'streak-3',
        context: 'oficial',
        openedAt: new Date('2026-08-01T15:00:00.000Z'),
      },
      {
        operationId: 'op-2',
        strategyId: 'streak-4',
        context: 'oficial',
        openedAt: new Date('2026-08-01T15:00:00.000Z'),
      },
    ]);
    const official = buildChannel();
    const test = buildTestChannel();
    const service = build([official, test]);

    service.generateAndDispatch('todos');

    expect(official.send).toHaveBeenCalledTimes(1);
    expect(test.send).toHaveBeenCalledTimes(1);
    expect(notificationFactory.createForSummaryReport).toHaveBeenCalledWith(
      expect.objectContaining({ alertsSent: 2 }),
      expect.any(Date),
      NotificationChannelType.TELEGRAM,
    );
    expect(notificationFactory.createForSummaryReport).toHaveBeenCalledWith(
      expect.objectContaining({ alertsSent: 0 }),
      expect.any(Date),
      NotificationChannelType.TELEGRAM_PRUEBAS,
    );
  });

  it('skips a disabled channel', () => {
    const channel = buildChannel({ enabled: jest.fn().mockReturnValue(false) });
    const service = build([channel]);

    service.generateAndDispatch('oficial');

    expect(channel.send).not.toHaveBeenCalled();
  });

  it('ignores supports() and sends to the channel of its own group regardless of it', () => {
    const official = buildChannel({
      supports: jest.fn().mockReturnValue(false),
    });
    const test = buildTestChannel({
      supports: jest.fn().mockReturnValue(false),
    });
    const service = build([official, test]);

    service.generateAndDispatch('todos');

    expect(official.send).toHaveBeenCalledTimes(1);
    expect(test.send).toHaveBeenCalledTimes(1);
  });

  describe('hydrateFromCheckpoint()', () => {
    it('adds the persisted won/lost/alertsSent as an offset to the next getSnapshot()', async () => {
      checkpointStore.loadAll.mockResolvedValue([
        {
          channel: 'oficial',
          won: 8,
          lost: 2,
          alertsSent: 10,
          firstStartedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ]);
      store.getAllClosed.mockReturnValue([
        {
          operationId: 'op-1',
          strategyId: 'streak-4',
          context: 'oficial',
          openedAt: new Date('2026-08-01T15:00:00.000Z'),
          closedAt: new Date('2026-08-01T15:05:00.000Z'),
          result: OperationState.WON,
          martingalesUsed: 0,
          maxMartingales: 2,
        },
      ]);
      const service = build([]);

      await service.hydrateFromCheckpoint();
      const snapshot = service.getSnapshot(
        new Date('2026-08-01T15:10:00.000Z'),
      );

      expect(snapshot.oficial.won).toBe(9); // 8 persistidas + 1 en memoria
      expect(snapshot.oficial.lost).toBe(2);
      expect(snapshot.pruebas.won).toBe(0); // sin checkpoint propio, sin offset
    });

    it('recomputes netUnits and effectivenessPct over the combined won/lost, not just the in-memory ones', async () => {
      checkpointStore.loadAll.mockResolvedValue([
        {
          channel: 'oficial',
          won: 8,
          lost: 2,
          alertsSent: 10,
          firstStartedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ]);
      const service = build([]);

      await service.hydrateFromCheckpoint();
      const snapshot = service.getSnapshot(
        new Date('2026-08-01T15:10:00.000Z'),
      );

      expect(snapshot.oficial.netUnits).toBe(8 - 2 * 7);
      expect(snapshot.oficial.effectivenessPct).toBeCloseTo(80, 2);
    });

    it('computes uptimeMs from the persisted firstStartedAt, not from this process start', async () => {
      const firstStartedAt = new Date('2026-08-01T00:00:00.000Z');
      checkpointStore.loadAll.mockResolvedValue([
        { channel: 'oficial', won: 0, lost: 0, alertsSent: 0, firstStartedAt },
      ]);
      const service = build([]);

      await service.hydrateFromCheckpoint();
      const now = new Date('2026-08-01T02:00:00.000Z');
      const snapshot = service.getSnapshot(now);

      expect(snapshot.oficial.uptimeMs).toBe(2 * 60 * 60 * 1000);
    });

    it('never throws even if the checkpoint store is empty (fresh deploy, no prior checkpoint)', async () => {
      const service = build([]);

      await expect(service.hydrateFromCheckpoint()).resolves.toBeUndefined();
      expect(service.getSnapshot().oficial.won).toBe(0);
    });
  });

  describe('persistCheckpoint()', () => {
    it('saves the combined won/lost/alertsSent (offset + in-memory) for both channels', async () => {
      store.getAllClosed.mockReturnValue([
        {
          operationId: 'op-1',
          strategyId: 'streak-4',
          context: 'oficial',
          openedAt: new Date('2026-08-01T15:00:00.000Z'),
          closedAt: new Date('2026-08-01T15:05:00.000Z'),
          result: OperationState.WON,
          martingalesUsed: 0,
          maxMartingales: 2,
        },
      ]);
      const service = build([]);

      await service.persistCheckpoint(new Date('2026-08-01T16:00:00.000Z'));

      expect(checkpointStore.save).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'oficial', won: 1, lost: 0 }),
      );
      expect(checkpointStore.save).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'pruebas', won: 0, lost: 0 }),
      );
    });

    it('keeps the originally persisted firstStartedAt across saves, never overwriting it with "now"', async () => {
      const firstStartedAt = new Date('2026-08-01T00:00:00.000Z');
      checkpointStore.loadAll.mockResolvedValue([
        { channel: 'oficial', won: 0, lost: 0, alertsSent: 0, firstStartedAt },
      ]);
      const service = build([]);
      await service.hydrateFromCheckpoint();

      await service.persistCheckpoint(new Date('2026-08-01T05:00:00.000Z'));

      expect(checkpointStore.save).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'oficial', firstStartedAt }),
      );
    });
  });
});
