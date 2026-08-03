import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import {
  DOMAIN_EVENT_BUS,
  NOTIFICATION_CHANNELS,
} from '../../core/constants/injection-tokens.constants';
import type { DomainEvent } from '../../core/domain-events/base/domain-event';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import type { DomainEventHandler } from '../../core/domain-events/base/domain-event-handler.interface';
import { MartingaleOneReachedEvent } from '../../core/domain-events/operation/martingale-one-reached.event';
import { MartingaleTwoReachedEvent } from '../../core/domain-events/operation/martingale-two-reached.event';
import { OperationLostEvent } from '../../core/domain-events/operation/operation-lost.event';
import { OperationOpenedEvent } from '../../core/domain-events/operation/operation-opened.event';
import { OperationTieOccurredEvent } from '../../core/domain-events/operation/operation-tie-occurred.event';
import { OperationWonEvent } from '../../core/domain-events/operation/operation-won.event';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import type { DistributionMetricValue } from '../../core/metrics/types/distribution-metric-value.type';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { NotificationFactory } from '../../core/notification/notification.factory';
import { Notification } from '../../core/notification/notification.type';
import { MessageType } from '../../core/notification/types/message-type.enum';
import { OperationSnapshot } from '../../core/operation/types/operation-snapshot.type';
import { DistributionMetric } from '../metrics/distribution.metric';
import { MessageTracker } from './message-tracker';
import { NotificationChannelDispatcher } from './notification-channel-dispatcher';

type NotificationBuilder = (
  snapshot: OperationSnapshot,
  channel: NotificationChannelType,
  distribution: DistributionMetricValue,
) => Notification;

type EventClass = { readonly eventName: string };

type Subscription = {
  readonly eventName: string;
  readonly handler: DomainEventHandler;
};

/**
 * Debe ser mayor que MAX_SEND_ATTEMPTS × RETRY_DELAY_MS + margen para
 * garantizar que los sends asíncronos de mensajes intermedios (MG1, MG2,
 * TIE) completaron antes de que el cleanup intente borrarlos.
 *
 * Actual: 4000ms > (3 × 1000ms) + 1000ms = 4000ms ✓
 */
const MESSAGE_CLEANUP_DELAY_MS = 4_000;

const INTERMEDIATE_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set([
  MessageType.MG1,
  MessageType.MG2,
  MessageType.TIE,
]);

/**
 * Escucha los eventos de Operation, construye una Notification por cada
 * canal registrado (vía NotificationFactory) y la envía. Nunca conoce
 * Telegram ni ningún canal concreto, solo el contrato NotificationChannel;
 * agregar un canal nuevo (Discord, email...) es solo registrarlo vía DI.
 *
 * OperationCoordinator no sabe que esta clase existe: se suscribe por su
 * cuenta al arrancar, igual que StrategyCoordinator y OperationCoordinator.
 */
@Injectable()
export class NotificationCoordinator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationCoordinator.name);
  private readonly subscriptions: readonly Subscription[];
  private readonly channelDispatcher: NotificationChannelDispatcher;
  private readonly channels: readonly NotificationChannel[];
  private readonly pendingCleanups = new Set<NodeJS.Timeout>();

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
    @Inject(NOTIFICATION_CHANNELS)
    channels: readonly NotificationChannel[],
    private readonly notificationFactory: NotificationFactory,
    errorTracker: EngineErrorTracker,
    private readonly distributionMetric: DistributionMetric,
    private readonly messageTracker: MessageTracker,
  ) {
    this.channels = channels;
    this.channelDispatcher = new NotificationChannelDispatcher(
      domainEventBus,
      channels,
      errorTracker,
    );
    this.subscriptions = [
      this.buildSubscription(
        OperationOpenedEvent,
        (snapshot, channel, distribution) =>
          this.notificationFactory.createForOperationOpened(
            snapshot,
            channel,
            distribution,
          ),
        undefined,
      ),
      this.buildSubscription(
        MartingaleOneReachedEvent,
        (snapshot, channel, distribution) =>
          this.notificationFactory.createForMartingaleOneReached(
            snapshot,
            channel,
            distribution,
          ),
        MessageType.MG1,
      ),
      this.buildSubscription(
        MartingaleTwoReachedEvent,
        (snapshot, channel, distribution) =>
          this.notificationFactory.createForMartingaleTwoReached(
            snapshot,
            channel,
            distribution,
          ),
        MessageType.MG2,
      ),
      this.buildSubscription(
        OperationWonEvent,
        (snapshot, channel, distribution) =>
          this.notificationFactory.createForOperationWon(
            snapshot,
            channel,
            distribution,
          ),
        undefined,
      ),
      this.buildSubscription(
        OperationLostEvent,
        (snapshot, channel, distribution) =>
          this.notificationFactory.createForOperationLost(
            snapshot,
            channel,
            distribution,
          ),
        undefined,
      ),
      this.buildSubscription(
        OperationTieOccurredEvent,
        (snapshot, channel, distribution) =>
          this.notificationFactory.createForTieOccurred(
            snapshot,
            channel,
            distribution,
          ),
        MessageType.TIE,
      ),
    ];
  }

  onModuleInit(): void {
    for (const { eventName, handler } of this.subscriptions) {
      this.domainEventBus.subscribe(eventName, handler);
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.pendingCleanups) {
      clearTimeout(timer);
    }
    this.pendingCleanups.clear();

    for (const { eventName, handler } of this.subscriptions) {
      this.domainEventBus.unsubscribe(eventName, handler);
    }
  }

  private buildSubscription(
    eventClass: EventClass,
    buildNotification: NotificationBuilder,
    messageType: MessageType | undefined,
  ): Subscription {
    const isClosing =
      eventClass.eventName === OperationWonEvent.eventName ||
      eventClass.eventName === OperationLostEvent.eventName;

    return {
      eventName: eventClass.eventName,
      handler: {
        handle: (event: DomainEvent<OperationSnapshot>) => {
          const snapshot = event.payload;
          const distribution = this.distributionMetric.getSnapshot();

          if (isClosing) {
            this.dispatchAndCleanup(snapshot, buildNotification, distribution);
          } else {
            this.dispatch(
              snapshot,
              buildNotification,
              distribution,
              messageType,
            );
          }
        },
      },
    };
  }

  private dispatch(
    snapshot: OperationSnapshot,
    buildNotification: NotificationBuilder,
    distribution: DistributionMetricValue,
    messageType: MessageType | undefined,
  ): void {
    this.channelDispatcher.dispatchToAll(
      (channelType) => buildNotification(snapshot, channelType, distribution),
      messageType
        ? (notification, result) => {
            if (result.messageId == null) {
              return;
            }
            const rawId = notification.metadata.operationId;
            if (typeof rawId !== 'string') {
              return;
            }
            this.messageTracker.register(
              rawId,
              notification.channel,
              messageType,
              result.messageId,
            );
          }
        : undefined,
    );
  }

  private dispatchAndCleanup(
    snapshot: OperationSnapshot,
    buildNotification: NotificationBuilder,
    distribution: DistributionMetricValue,
  ): void {
    this.channelDispatcher.dispatchToAll((channelType) =>
      buildNotification(snapshot, channelType, distribution),
    );

    const operationId = snapshot.operationId;
    const timer = setTimeout(() => {
      this.pendingCleanups.delete(timer);
      this.cleanupMessages(operationId);
    }, MESSAGE_CLEANUP_DELAY_MS);

    this.pendingCleanups.add(timer);
  }

  private cleanupMessages(operationId: string): void {
    const messages = this.messageTracker.getAndClear(operationId);

    for (const msg of messages) {
      if (!INTERMEDIATE_MESSAGE_TYPES.has(msg.type)) {
        continue;
      }

      const channel = this.channels.find(
        (c) => c.getChannelType() === msg.channel,
      );

      if (!channel) {
        this.logger.warn(
          `No se encontró el canal "${msg.channel}" para borrar el mensaje ${msg.messageId} de la operación ${operationId}.`,
        );
        continue;
      }

      void channel.deleteMessage(msg.messageId).then((deleted) => {
        if (!deleted) {
          this.logger.warn(
            `No se pudo borrar el mensaje ${msg.messageId} (tipo=${msg.type}) de la operación ${operationId}.`,
          );
        }
      });
    }
  }
}
