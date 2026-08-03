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
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import type { DomainEventHandler } from '../../core/domain-events/base/domain-event-handler.interface';
import { DailyReportGeneratedEvent } from '../../core/domain-events/reporting/daily-report-generated.event';
import { HourlyReportGeneratedEvent } from '../../core/domain-events/reporting/hourly-report-generated.event';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { NotificationFactory } from '../../core/notification/notification.factory';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { ReportSnapshot } from '../../core/reporting/types/report-snapshot.type';
import { NotificationChannelDispatcher } from '../notification/notification-channel-dispatcher';

/**
 * Escucha HourlyReportGeneratedEvent/DailyReportGeneratedEvent, construye
 * la Notification correspondiente (vía NotificationFactory) y la envía a
 * través de los mismos NOTIFICATION_CHANNELS que usa NotificationCoordinator
 * — reutilizando NotificationChannelDispatcher, nunca conociendo Telegram
 * directamente. Vive separado de NotificationCoordinator porque escucha una
 * familia de eventos distinta (reportes agregados, no eventos de una
 * Operation puntual): mismo principio de responsabilidad única que separa
 * StrategyCoordinator de OperationCoordinator.
 */
@Injectable()
export class ReportNotificationCoordinator
  implements OnModuleInit, OnModuleDestroy
{
  private readonly channelDispatcher: NotificationChannelDispatcher;

  private readonly hourlyHandler: DomainEventHandler<HourlyReportGeneratedEvent> =
    {
      handle: (event) => this.dispatch(event.payload, true),
    };

  private readonly dailyHandler: DomainEventHandler<DailyReportGeneratedEvent> =
    {
      handle: (event) => this.dispatch(event.payload, false),
    };

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
    @Inject(NOTIFICATION_CHANNELS)
    channels: readonly NotificationChannel[],
    private readonly notificationFactory: NotificationFactory,
    errorTracker: EngineErrorTracker,
  ) {
    this.channelDispatcher = new NotificationChannelDispatcher(
      domainEventBus,
      channels,
      errorTracker,
    );
  }

  onModuleInit(): void {
    this.domainEventBus.subscribe(
      HourlyReportGeneratedEvent.eventName,
      this.hourlyHandler,
    );
    this.domainEventBus.subscribe(
      DailyReportGeneratedEvent.eventName,
      this.dailyHandler,
    );
  }

  onModuleDestroy(): void {
    this.domainEventBus.unsubscribe(
      HourlyReportGeneratedEvent.eventName,
      this.hourlyHandler,
    );
    this.domainEventBus.unsubscribe(
      DailyReportGeneratedEvent.eventName,
      this.dailyHandler,
    );
  }

  private dispatch(report: ReportSnapshot, isHourly: boolean): void {
    this.channelDispatcher.dispatchToAll((channelType) =>
      isHourly
        ? this.notificationFactory.createForHourlyReport(report, channelType)
        : this.notificationFactory.createForDailyReport(report, channelType),
    );
  }
}
