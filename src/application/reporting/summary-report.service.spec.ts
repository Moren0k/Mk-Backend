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
  });

  function build(channels: NotificationChannel[]): SummaryReportService {
    return new SummaryReportService(
      store,
      domainEventBus,
      channels,
      notificationFactory as unknown as NotificationFactory,
      errorTracker,
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

  it('returns the calculated summary metrics', () => {
    store.getAllOpened.mockReturnValue([
      { operationId: 'op-1', openedAt: new Date('2026-08-01T15:00:00.000Z') },
    ]);
    store.getAllClosed.mockReturnValue([
      {
        operationId: 'op-1',
        openedAt: new Date('2026-08-01T15:00:00.000Z'),
        closedAt: new Date('2026-08-01T15:05:00.000Z'),
        result: OperationState.WON,
        martingalesUsed: 0,
        maxMartingales: 2,
      },
    ]);
    const service = build([]);

    const metrics = service.generateAndDispatch();

    expect(metrics.alertsSent).toBe(1);
    expect(metrics.won).toBe(1);
    expect(metrics.directWins).toBe(1);
  });

  it('dispatches a Notification built via createForSummaryReport to every enabled channel', () => {
    const telegram = buildChannel();
    const other = buildChannel();
    const service = build([telegram, other]);

    service.generateAndDispatch();

    expect(notificationFactory.createForSummaryReport).toHaveBeenCalledWith(
      expect.objectContaining({ alertsSent: 0 }),
      expect.any(Date),
      NotificationChannelType.TELEGRAM,
    );
    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(other.send).toHaveBeenCalledTimes(1);
  });

  it('skips a disabled channel', () => {
    const channel = buildChannel({ enabled: jest.fn().mockReturnValue(false) });
    const service = build([channel]);

    service.generateAndDispatch();

    expect(channel.send).not.toHaveBeenCalled();
  });

  it('ignores supports() and sends to every enabled channel by default ("todos")', () => {
    const official = buildChannel({
      supports: jest.fn().mockReturnValue(false),
    });
    const test = buildTestChannel({
      supports: jest.fn().mockReturnValue(false),
    });
    const service = build([official, test]);

    service.generateAndDispatch();

    expect(official.send).toHaveBeenCalledTimes(1);
    expect(test.send).toHaveBeenCalledTimes(1);
  });

  it('sends only to the official channel when selector is "oficial"', () => {
    const official = buildChannel();
    const test = buildTestChannel();
    const service = build([official, test]);

    service.generateAndDispatch('oficial');

    expect(official.send).toHaveBeenCalledTimes(1);
    expect(test.send).not.toHaveBeenCalled();
  });

  it('sends only to the test channel when selector is "pruebas"', () => {
    const official = buildChannel();
    const test = buildTestChannel();
    const service = build([official, test]);

    service.generateAndDispatch('pruebas');

    expect(official.send).not.toHaveBeenCalled();
    expect(test.send).toHaveBeenCalledTimes(1);
  });

  it('sends to both channels when selector is "todos"', () => {
    const official = buildChannel();
    const test = buildTestChannel();
    const service = build([official, test]);

    service.generateAndDispatch('todos');

    expect(official.send).toHaveBeenCalledTimes(1);
    expect(test.send).toHaveBeenCalledTimes(1);
  });
});
