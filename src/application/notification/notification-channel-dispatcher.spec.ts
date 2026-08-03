import { Logger } from '@nestjs/common';

import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { NotificationFailedEvent } from '../../core/domain-events/notification/notification-failed.event';
import { NotificationSentEvent } from '../../core/domain-events/notification/notification-sent.event';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { NotificationSeverity } from '../../core/enums/notification-severity.enum';
import { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import {
  createNotification,
  Notification,
} from '../../core/notification/notification.type';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { NotificationChannelDispatcher } from './notification-channel-dispatcher';

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

describe('NotificationChannelDispatcher', () => {
  let domainEventBus: jest.Mocked<DomainEventBus>;
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
    errorTracker = new EngineErrorTracker();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds one notification per enabled channel, tagged with its own channel type', () => {
    const telegram = buildChannel();
    const dispatcher = new NotificationChannelDispatcher(
      domainEventBus,
      [telegram],
      errorTracker,
    );
    const build = jest.fn().mockImplementation(buildNotification);

    dispatcher.dispatchToAll(build);

    expect(build).toHaveBeenCalledWith(NotificationChannelType.TELEGRAM);
    expect(telegram.send).toHaveBeenCalledTimes(1);
  });

  it('skips a disabled channel without building a notification for it', () => {
    const channel = buildChannel({ enabled: jest.fn().mockReturnValue(false) });
    const dispatcher = new NotificationChannelDispatcher(
      domainEventBus,
      [channel],
      errorTracker,
    );
    const build = jest.fn().mockImplementation(buildNotification);

    dispatcher.dispatchToAll(build);

    expect(build).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('skips a channel whose supports() rejects the notification', () => {
    const channel = buildChannel({
      supports: jest.fn().mockReturnValue(false),
    });
    const dispatcher = new NotificationChannelDispatcher(
      domainEventBus,
      [channel],
      errorTracker,
    );

    dispatcher.dispatchToAll(buildNotification);

    expect(channel.send).not.toHaveBeenCalled();
  });

  it('publishes NotificationSentEvent when delivery succeeds', async () => {
    const channel = buildChannel({ send: jest.fn().mockResolvedValue(true) });
    const dispatcher = new NotificationChannelDispatcher(
      domainEventBus,
      [channel],
      errorTracker,
    );

    dispatcher.dispatchToAll(buildNotification);
    await Promise.resolve();
    await Promise.resolve();

    expect(domainEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: NotificationSentEvent.eventName }),
    );
  });

  it('publishes NotificationFailedEvent when the channel rejects unexpectedly', async () => {
    const channel = buildChannel({
      send: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const dispatcher = new NotificationChannelDispatcher(
      domainEventBus,
      [channel],
      errorTracker,
    );

    dispatcher.dispatchToAll(buildNotification);
    await Promise.resolve();
    await Promise.resolve();

    expect(domainEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: NotificationFailedEvent.eventName,
        payload: expect.objectContaining({ reason: 'boom' }) as unknown,
      }),
    );
    expect(errorTracker.getLastError()?.message).toContain('Telegram');
  });
});
