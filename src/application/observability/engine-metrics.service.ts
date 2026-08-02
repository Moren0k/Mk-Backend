import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { DOMAIN_EVENT_BUS } from '../../core/constants/injection-tokens.constants';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import type { DomainEventHandler } from '../../core/domain-events/base/domain-event-handler.interface';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { NotificationFailedEvent } from '../../core/domain-events/notification/notification-failed.event';
import { NotificationSentEvent } from '../../core/domain-events/notification/notification-sent.event';
import { MartingaleOneReachedEvent } from '../../core/domain-events/operation/martingale-one-reached.event';
import { MartingaleTwoReachedEvent } from '../../core/domain-events/operation/martingale-two-reached.event';
import { OperationLostEvent } from '../../core/domain-events/operation/operation-lost.event';
import { OperationOpenedEvent } from '../../core/domain-events/operation/operation-opened.event';
import { OperationWonEvent } from '../../core/domain-events/operation/operation-won.event';
import { StrategyTriggeredEvent } from '../../core/domain-events/strategy/strategy-triggered.event';
import { EngineMetrics } from '../../core/observability/engine-metrics.entity';
import { EngineMetricsSnapshot } from '../../core/observability/types/engine-metrics-snapshot.type';

type EventClass = { readonly eventName: string };
type Subscription = {
  readonly eventName: string;
  readonly handler: DomainEventHandler;
};

/**
 * Alimenta a EngineMetrics (core) escuchando únicamente eventos de
 * dominio, nunca consultando otro módulo directamente. Una tabla
 * evento -> contador en vez de 9 pares de campos casi idénticos (mismo
 * patrón que NotificationCoordinator).
 */
@Injectable()
export class EngineMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly metrics = new EngineMetrics();
  private readonly subscriptions: readonly Subscription[];

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
  ) {
    this.subscriptions = [
      this.buildSubscription(GameReceivedEvent, () =>
        this.metrics.recordGameReceived(),
      ),
      this.buildSubscription(StrategyTriggeredEvent, () =>
        this.metrics.recordSignalGenerated(),
      ),
      this.buildSubscription(OperationOpenedEvent, () =>
        this.metrics.recordOperationOpened(),
      ),
      this.buildSubscription(OperationWonEvent, () =>
        this.metrics.recordOperationWon(),
      ),
      this.buildSubscription(OperationLostEvent, () =>
        this.metrics.recordOperationLost(),
      ),
      this.buildSubscription(MartingaleOneReachedEvent, () =>
        this.metrics.recordMartingaleOneReached(),
      ),
      this.buildSubscription(MartingaleTwoReachedEvent, () =>
        this.metrics.recordMartingaleTwoReached(),
      ),
      this.buildSubscription(NotificationSentEvent, () =>
        this.metrics.recordNotificationSent(),
      ),
      this.buildSubscription(NotificationFailedEvent, () =>
        this.metrics.recordNotificationFailed(),
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

  getSnapshot(): EngineMetricsSnapshot {
    return this.metrics.toSnapshot();
  }

  private buildSubscription(
    eventClass: EventClass,
    record: () => void,
  ): Subscription {
    return {
      eventName: eventClass.eventName,
      handler: { handle: () => record() },
    };
  }
}
