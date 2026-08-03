import {
  Inject,
  Injectable,
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
import { OperationSnapshot } from '../../core/operation/types/operation-snapshot.type';
import { DistributionMetric } from '../metrics/distribution.metric';
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
  private readonly subscriptions: readonly Subscription[];
  private readonly channelDispatcher: NotificationChannelDispatcher;

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
    @Inject(NOTIFICATION_CHANNELS)
    channels: readonly NotificationChannel[],
    private readonly notificationFactory: NotificationFactory,
    errorTracker: EngineErrorTracker,
    private readonly distributionMetric: DistributionMetric,
  ) {
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
      ),
      this.buildSubscription(
        MartingaleOneReachedEvent,
        (snapshot, channel, distribution) =>
          this.notificationFactory.createForMartingaleOneReached(
            snapshot,
            channel,
            distribution,
          ),
      ),
      this.buildSubscription(
        MartingaleTwoReachedEvent,
        (snapshot, channel, distribution) =>
          this.notificationFactory.createForMartingaleTwoReached(
            snapshot,
            channel,
            distribution,
          ),
      ),
      this.buildSubscription(
        OperationWonEvent,
        (snapshot, channel, distribution) =>
          this.notificationFactory.createForOperationWon(
            snapshot,
            channel,
            distribution,
          ),
      ),
      this.buildSubscription(
        OperationLostEvent,
        (snapshot, channel, distribution) =>
          this.notificationFactory.createForOperationLost(
            snapshot,
            channel,
            distribution,
          ),
      ),
      this.buildSubscription(
        OperationTieOccurredEvent,
        (snapshot, channel, distribution) =>
          this.notificationFactory.createForTieOccurred(
            snapshot,
            channel,
            distribution,
          ),
      ),
    ];
  }

  onModuleInit(): void {
    for (const { eventName, handler } of this.subscriptions) {
      this.domainEventBus.subscribe(eventName, handler);
    }
  }

  onModuleDestroy(): void {
    for (const { eventName, handler } of this.subscriptions) {
      this.domainEventBus.unsubscribe(eventName, handler);
    }
  }

  private buildSubscription(
    eventClass: EventClass,
    buildNotification: NotificationBuilder,
  ): Subscription {
    return {
      eventName: eventClass.eventName,
      handler: {
        handle: (event: DomainEvent<OperationSnapshot>) =>
          this.dispatch(event.payload, buildNotification),
      },
    };
  }

  /**
   * Construye una Notification por cada canal habilitado que la soporte y
   * la envía, delegando la entrega en NotificationChannelDispatcher. Nunca
   * espera (`await`) el envío: el motor de dominio (que disparó este
   * handler de forma síncrona) no debe bloquearse mientras Telegram
   * responde o reintenta. El resultado (entregada o no) se publica como
   * NotificationSentEvent/NotificationFailedEvent, único mecanismo por el
   * que EngineMetrics se entera de esto.
   */
  private dispatch(
    snapshot: OperationSnapshot,
    buildNotification: NotificationBuilder,
  ): void {
    const distribution = this.distributionMetric.getSnapshot();

    this.channelDispatcher.dispatchToAll((channelType) =>
      buildNotification(snapshot, channelType, distribution),
    );
  }
}
