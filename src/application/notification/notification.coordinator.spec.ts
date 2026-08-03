import { Logger } from '@nestjs/common';

import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { MartingaleOneReachedEvent } from '../../core/domain-events/operation/martingale-one-reached.event';
import { MartingaleTwoReachedEvent } from '../../core/domain-events/operation/martingale-two-reached.event';
import { OperationLostEvent } from '../../core/domain-events/operation/operation-lost.event';
import { OperationOpenedEvent } from '../../core/domain-events/operation/operation-opened.event';
import { OperationTieOccurredEvent } from '../../core/domain-events/operation/operation-tie-occurred.event';
import { OperationWonEvent } from '../../core/domain-events/operation/operation-won.event';
import { NotificationFailedEvent } from '../../core/domain-events/notification/notification-failed.event';
import { NotificationSentEvent } from '../../core/domain-events/notification/notification-sent.event';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { NotificationSeverity } from '../../core/enums/notification-severity.enum';
import { OperationState } from '../../core/enums/operation-state.enum';
import { WinnerType } from '../../core/enums/winner-type.enum';
import { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { NotificationFactory } from '../../core/notification/notification.factory';
import {
  createNotification,
  Notification,
} from '../../core/notification/notification.type';
import { OperationSnapshot } from '../../core/operation/types/operation-snapshot.type';
import { DistributionMetric } from '../metrics/distribution.metric';
import { MessageTracker } from './message-tracker';
import { NotificationCoordinator } from './notification.coordinator';

function buildSnapshot(
  overrides: Partial<OperationSnapshot> = {},
): OperationSnapshot {
  return {
    operationId: 'op-1',
    strategyId: 'streak-3',
    recommendedWinner: WinnerType.BANKER,
    streakWinner: WinnerType.PLAYER,
    currentState: OperationState.OPEN,
    currentMartingale: 0,
    maxMartingales: 2,
    openedAt: new Date('2026-08-01T00:00:00.000Z'),
    closedAt: undefined,
    reason: 'test',
    history: [],
    ...overrides,
  };
}

function buildNotification(
  channel: NotificationChannelType,
  operationId = 'op-1',
): Notification {
  return createNotification({
    title: '',
    message: 'message',
    severity: NotificationSeverity.INFO,
    channel,
    metadata: { operationId },
  });
}

function buildChannel(
  channelType: NotificationChannelType,
  overrides: Partial<NotificationChannel> = {},
): jest.Mocked<NotificationChannel> {
  return {
    getChannelType: jest.fn().mockReturnValue(channelType),
    name: jest.fn().mockReturnValue(channelType),
    enabled: jest.fn().mockReturnValue(true),
    supports: jest.fn().mockReturnValue(true),
    send: jest.fn().mockResolvedValue({ delivered: true, messageId: 1 }),
    deleteMessage: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('NotificationCoordinator', () => {
  let domainEventBus: jest.Mocked<DomainEventBus>;
  let errorTracker: EngineErrorTracker;
  let distributionMetric: jest.Mocked<Pick<DistributionMetric, 'getSnapshot'>>;
  let messageTracker: jest.Mocked<
    Pick<MessageTracker, 'register' | 'getAndClear'>
  >;
  let notificationFactory: jest.Mocked<
    Pick<
      NotificationFactory,
      | 'createForOperationOpened'
      | 'createForMartingaleOneReached'
      | 'createForMartingaleTwoReached'
      | 'createForOperationWon'
      | 'createForOperationLost'
      | 'createForTieOccurred'
    >
  >;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    domainEventBus = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      publish: jest.fn(),
      publishMany: jest.fn(),
      clear: jest.fn(),
    };

    notificationFactory = {
      createForOperationOpened: jest
        .fn()
        .mockImplementation((_: unknown, channel: NotificationChannelType) =>
          buildNotification(channel),
        ),
      createForMartingaleOneReached: jest
        .fn()
        .mockImplementation((_: unknown, channel: NotificationChannelType) =>
          buildNotification(channel),
        ),
      createForMartingaleTwoReached: jest
        .fn()
        .mockImplementation((_: unknown, channel: NotificationChannelType) =>
          buildNotification(channel),
        ),
      createForOperationWon: jest
        .fn()
        .mockImplementation((_: unknown, channel: NotificationChannelType) =>
          buildNotification(channel),
        ),
      createForOperationLost: jest
        .fn()
        .mockImplementation((_: unknown, channel: NotificationChannelType) =>
          buildNotification(channel),
        ),
      createForTieOccurred: jest
        .fn()
        .mockImplementation((_: unknown, channel: NotificationChannelType) =>
          buildNotification(channel),
        ),
    };

    errorTracker = new EngineErrorTracker();

    distributionMetric = {
      getSnapshot: jest.fn().mockReturnValue({
        playerPct: 48.5,
        tiePct: 12.0,
        bankerPct: 39.5,
        totalGames: 200,
      }),
    };

    messageTracker = {
      register: jest.fn(),
      getAndClear: jest.fn().mockReturnValue([]),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function build(channels: NotificationChannel[]): NotificationCoordinator {
    return new NotificationCoordinator(
      domainEventBus,
      channels,
      notificationFactory as unknown as NotificationFactory,
      errorTracker,
      distributionMetric as unknown as DistributionMetric,
      messageTracker as unknown as MessageTracker,
    );
  }

  it('subscribes to all 6 Operation events on module init', () => {
    const coordinator = build([]);

    coordinator.onModuleInit();

    for (const eventName of [
      OperationOpenedEvent.eventName,
      MartingaleOneReachedEvent.eventName,
      MartingaleTwoReachedEvent.eventName,
      OperationWonEvent.eventName,
      OperationLostEvent.eventName,
      OperationTieOccurredEvent.eventName,
    ]) {
      expect(domainEventBus.subscribe).toHaveBeenCalledWith(
        eventName,
        expect.anything(),
      );
    }
  });

  it('unsubscribes from all 6 events on module destroy, using the same references', () => {
    const coordinator = build([]);
    coordinator.onModuleInit();

    coordinator.onModuleDestroy();

    expect(domainEventBus.unsubscribe).toHaveBeenCalledTimes(6);
    for (const [eventName, handler] of domainEventBus.subscribe.mock.calls) {
      expect(domainEventBus.unsubscribe).toHaveBeenCalledWith(
        eventName,
        handler,
      );
    }
  });

  function dispatchEvent(
    coordinator: NotificationCoordinator,
    eventName: string,
    snapshot: OperationSnapshot,
  ): void {
    coordinator.onModuleInit();
    const handler = domainEventBus.subscribe.mock.calls.find(
      ([name]) => name === eventName,
    )![1];

    const EventClass = {
      [OperationOpenedEvent.eventName]: OperationOpenedEvent,
      [MartingaleOneReachedEvent.eventName]: MartingaleOneReachedEvent,
      [MartingaleTwoReachedEvent.eventName]: MartingaleTwoReachedEvent,
      [OperationWonEvent.eventName]: OperationWonEvent,
      [OperationLostEvent.eventName]: OperationLostEvent,
      [OperationTieOccurredEvent.eventName]: OperationTieOccurredEvent,
    }[eventName]!;

    handler.handle(new EventClass(snapshot));
  }

  it('builds and sends a notification for OperationOpenedEvent through every enabled channel', () => {
    const channel = buildChannel(NotificationChannelType.TELEGRAM);
    const coordinator = build([channel]);
    const snapshot = buildSnapshot();

    dispatchEvent(coordinator, OperationOpenedEvent.eventName, snapshot);

    expect(notificationFactory.createForOperationOpened).toHaveBeenCalledWith(
      snapshot,
      NotificationChannelType.TELEGRAM,
      expect.anything(),
    );
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it('routes each event type to its matching NotificationFactory method', () => {
    const channel = buildChannel(NotificationChannelType.TELEGRAM);
    const coordinator = build([channel]);
    const snapshot = buildSnapshot();

    dispatchEvent(coordinator, MartingaleOneReachedEvent.eventName, snapshot);
    expect(
      notificationFactory.createForMartingaleOneReached,
    ).toHaveBeenCalled();

    dispatchEvent(coordinator, MartingaleTwoReachedEvent.eventName, snapshot);
    expect(
      notificationFactory.createForMartingaleTwoReached,
    ).toHaveBeenCalled();

    dispatchEvent(coordinator, OperationWonEvent.eventName, snapshot);
    expect(notificationFactory.createForOperationWon).toHaveBeenCalled();

    dispatchEvent(coordinator, OperationLostEvent.eventName, snapshot);
    expect(notificationFactory.createForOperationLost).toHaveBeenCalled();

    dispatchEvent(coordinator, OperationTieOccurredEvent.eventName, snapshot);
    expect(notificationFactory.createForTieOccurred).toHaveBeenCalled();
  });

  it('skips a channel that is disabled', () => {
    const channel = buildChannel(NotificationChannelType.TELEGRAM, {
      enabled: jest.fn().mockReturnValue(false),
    });
    const coordinator = build([channel]);

    dispatchEvent(coordinator, OperationOpenedEvent.eventName, buildSnapshot());

    expect(channel.send).not.toHaveBeenCalled();
  });

  it('skips a channel whose supports() rejects the notification', () => {
    const channel = buildChannel(NotificationChannelType.TELEGRAM, {
      supports: jest.fn().mockReturnValue(false),
    });
    const coordinator = build([channel]);

    dispatchEvent(coordinator, OperationOpenedEvent.eventName, buildSnapshot());

    expect(channel.send).not.toHaveBeenCalled();
  });

  it('dispatches independently to every registered channel', () => {
    const telegram = buildChannel(NotificationChannelType.TELEGRAM);
    const other = buildChannel(NotificationChannelType.TELEGRAM);
    const coordinator = build([telegram, other]);

    dispatchEvent(coordinator, OperationOpenedEvent.eventName, buildSnapshot());

    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(other.send).toHaveBeenCalledTimes(1);
  });

  it('does not await channel.send(): the handler returns before the send promise resolves', () => {
    let resolveSend!: (result: { delivered: boolean }) => void;
    const pending = new Promise<{ delivered: boolean }>((resolve) => {
      resolveSend = resolve;
    });
    const channel = buildChannel(NotificationChannelType.TELEGRAM, {
      send: jest.fn().mockReturnValue(pending),
    });
    const coordinator = build([channel]);

    expect(() =>
      dispatchEvent(
        coordinator,
        OperationOpenedEvent.eventName,
        buildSnapshot(),
      ),
    ).not.toThrow();
    expect(channel.send).toHaveBeenCalledTimes(1);

    resolveSend({ delivered: true });
  });

  it('logs the error when a channel fails to send, without affecting other channels', async () => {
    const failing = buildChannel(NotificationChannelType.TELEGRAM, {
      send: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const healthy = buildChannel(NotificationChannelType.TELEGRAM);
    const coordinator = build([failing, healthy]);

    dispatchEvent(coordinator, OperationOpenedEvent.eventName, buildSnapshot());
    await Promise.resolve();
    await Promise.resolve();

    expect(healthy.send).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('publishes NotificationSentEvent once a channel confirms delivery', async () => {
    const channel = buildChannel(NotificationChannelType.TELEGRAM);
    const coordinator = build([channel]);

    dispatchEvent(coordinator, OperationOpenedEvent.eventName, buildSnapshot());
    await Promise.resolve();
    await Promise.resolve();

    expect(domainEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: NotificationSentEvent.eventName }),
    );
  });

  it('publishes NotificationFailedEvent when send resolves delivered=false', async () => {
    const channel = buildChannel(NotificationChannelType.TELEGRAM, {
      send: jest.fn().mockResolvedValue({ delivered: false }),
    });
    const coordinator = build([channel]);

    dispatchEvent(coordinator, OperationOpenedEvent.eventName, buildSnapshot());
    await Promise.resolve();
    await Promise.resolve();

    expect(domainEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: NotificationFailedEvent.eventName,
      }),
    );
  });

  it('publishes NotificationFailedEvent when a channel rejects unexpectedly', async () => {
    const channel = buildChannel(NotificationChannelType.TELEGRAM, {
      send: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const coordinator = build([channel]);

    dispatchEvent(coordinator, OperationOpenedEvent.eventName, buildSnapshot());
    await Promise.resolve();
    await Promise.resolve();

    expect(domainEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: NotificationFailedEvent.eventName,
        payload: expect.objectContaining({ reason: 'boom' }) as unknown,
      }),
    );
    expect(errorTracker.getLastError()?.message).toContain('TELEGRAM');
  });

  it('calls getSnapshot() once per dispatched event, regardless of channel count', () => {
    const channel1 = buildChannel(NotificationChannelType.TELEGRAM);
    const channel2 = buildChannel(NotificationChannelType.TELEGRAM);
    const coordinator = build([channel1, channel2]);

    dispatchEvent(coordinator, OperationOpenedEvent.eventName, buildSnapshot());

    expect(distributionMetric.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('registers intermediate messages in tracker via onSent callback', async () => {
    const channel = buildChannel(NotificationChannelType.TELEGRAM, {
      send: jest.fn().mockResolvedValue({ delivered: true, messageId: 42 }),
    });
    const coordinator = build([channel]);

    dispatchEvent(
      coordinator,
      MartingaleOneReachedEvent.eventName,
      buildSnapshot(),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(messageTracker.register).toHaveBeenCalledWith(
      'op-1',
      NotificationChannelType.TELEGRAM,
      expect.any(String),
      42,
    );
  });

  it('does not register entry notifications in tracker', async () => {
    const channel = buildChannel(NotificationChannelType.TELEGRAM);
    const coordinator = build([channel]);

    dispatchEvent(coordinator, OperationOpenedEvent.eventName, buildSnapshot());
    await Promise.resolve();
    await Promise.resolve();

    expect(messageTracker.register).not.toHaveBeenCalled();
  });

  it('schedules cleanup after WON event with delay', () => {
    jest.useFakeTimers();
    const channel = buildChannel(NotificationChannelType.TELEGRAM);
    const coordinator = build([channel]);

    dispatchEvent(coordinator, OperationWonEvent.eventName, buildSnapshot());

    expect(messageTracker.register).not.toHaveBeenCalled();
    expect(messageTracker.getAndClear).not.toHaveBeenCalled();

    jest.advanceTimersByTime(4000);

    expect(messageTracker.getAndClear).toHaveBeenCalledWith('op-1');

    jest.useRealTimers();
  });

  it('clears pending cleanups on module destroy', () => {
    jest.useFakeTimers();
    const channel = buildChannel(NotificationChannelType.TELEGRAM);
    const coordinator = build([channel]);
    coordinator.onModuleInit();

    dispatchEvent(coordinator, OperationWonEvent.eventName, buildSnapshot());

    coordinator.onModuleDestroy();
    jest.advanceTimersByTime(4000);

    expect(messageTracker.getAndClear).not.toHaveBeenCalled();

    jest.useRealTimers();
  });
});
