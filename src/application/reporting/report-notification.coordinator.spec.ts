import { Logger } from '@nestjs/common';

import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { HourlyReportGeneratedEvent } from '../../core/domain-events/reporting/hourly-report-generated.event';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { NotificationSeverity } from '../../core/enums/notification-severity.enum';
import { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { NotificationFactory } from '../../core/notification/notification.factory';
import {
  createNotification,
  Notification,
} from '../../core/notification/notification.type';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { ReportSnapshot } from '../../core/reporting/types/report-snapshot.type';
import { ReportNotificationCoordinator } from './report-notification.coordinator';

function buildReport(overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
  return {
    windowFrom: new Date('2026-08-01T15:00:00.000Z'),
    windowTo: new Date('2026-08-01T16:00:00.000Z'),
    metrics: {
      alertsSent: 1,
      closedOperations: 1,
      won: 1,
      lost: 0,
      effectivenessPct: 100,
      directWins: 1,
      martingaleOneWins: 0,
      martingaleTwoWins: 0,
      martingalesExhausted: 0,
      distribution: {
        directPct: 100,
        martingaleOnePct: 0,
        martingaleTwoPct: 0,
        lostPct: 0,
      },
    },
    ...overrides,
  };
}

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

describe('ReportNotificationCoordinator', () => {
  let domainEventBus: jest.Mocked<DomainEventBus>;
  let notificationFactory: jest.Mocked<
    Pick<NotificationFactory, 'createForHourlyReport'>
  >;
  let errorTracker: EngineErrorTracker;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    domainEventBus = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      publish: jest.fn(),
      publishMany: jest.fn(),
      clear: jest.fn(),
    };
    notificationFactory = {
      createForHourlyReport: jest
        .fn()
        .mockImplementation((_: unknown, channel: NotificationChannelType) =>
          buildNotification(channel),
        ),
    };
    errorTracker = new EngineErrorTracker();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function build(
    channels: NotificationChannel[],
  ): ReportNotificationCoordinator {
    return new ReportNotificationCoordinator(
      domainEventBus,
      channels,
      notificationFactory as unknown as NotificationFactory,
      errorTracker,
    );
  }

  function dispatchEvent(
    coordinator: ReportNotificationCoordinator,
    eventName: string,
    report: ReportSnapshot,
  ): void {
    coordinator.onModuleInit();
    const handler = domainEventBus.subscribe.mock.calls.find(
      ([name]) => name === eventName,
    )![1];

    handler.handle(new HourlyReportGeneratedEvent(report));
  }

  it('subscribes to the hourly report event on module init', () => {
    const coordinator = build([]);

    coordinator.onModuleInit();

    expect(domainEventBus.subscribe).toHaveBeenCalledWith(
      HourlyReportGeneratedEvent.eventName,
      expect.anything(),
    );
  });

  it('unsubscribes the handler on module destroy, using the same reference', () => {
    const coordinator = build([]);
    coordinator.onModuleInit();

    coordinator.onModuleDestroy();

    expect(domainEventBus.unsubscribe).toHaveBeenCalledTimes(1);
    for (const [eventName, handler] of domainEventBus.subscribe.mock.calls) {
      expect(domainEventBus.unsubscribe).toHaveBeenCalledWith(
        eventName,
        handler,
      );
    }
  });

  it('routes HourlyReportGeneratedEvent to createForHourlyReport and sends it', () => {
    const channel = buildChannel();
    const coordinator = build([channel]);
    const report = buildReport();

    dispatchEvent(coordinator, HourlyReportGeneratedEvent.eventName, report);

    expect(notificationFactory.createForHourlyReport).toHaveBeenCalledWith(
      report,
      NotificationChannelType.TELEGRAM,
    );
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it('skips a disabled channel', () => {
    const channel = buildChannel({ enabled: jest.fn().mockReturnValue(false) });
    const coordinator = build([channel]);

    dispatchEvent(
      coordinator,
      HourlyReportGeneratedEvent.eventName,
      buildReport(),
    );

    expect(channel.send).not.toHaveBeenCalled();
  });

  it('dispatches independently to every registered official channel', () => {
    const telegram = buildChannel();
    const other = buildChannel();
    const coordinator = build([telegram, other]);

    dispatchEvent(
      coordinator,
      HourlyReportGeneratedEvent.eventName,
      buildReport(),
    );

    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(other.send).toHaveBeenCalledTimes(1);
  });

  it('never dispatches the hourly report to the test channel, even if enabled and it would support it', () => {
    const official = buildChannel();
    const test = buildTestChannel();
    const coordinator = build([official, test]);

    dispatchEvent(
      coordinator,
      HourlyReportGeneratedEvent.eventName,
      buildReport(),
    );

    expect(official.send).toHaveBeenCalledTimes(1);
    expect(test.send).not.toHaveBeenCalled();
  });
});
