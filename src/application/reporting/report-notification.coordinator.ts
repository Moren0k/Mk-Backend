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
import { HourlyReportGeneratedEvent } from '../../core/domain-events/reporting/hourly-report-generated.event';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { NotificationFactory } from '../../core/notification/notification.factory';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { ReportSnapshot } from '../../core/reporting/types/report-snapshot.type';
import { NotificationChannelDispatcher } from '../notification/notification-channel-dispatcher';
import { selectChannelsByGroup } from '../notification/notification-channel-selector';

/**
 * Escucha HourlyReportGeneratedEvent, construye la Notification
 * correspondiente (vía NotificationFactory) y la envía a través de los
 * mismos NOTIFICATION_CHANNELS que usa NotificationCoordinator —
 * reutilizando NotificationChannelDispatcher, nunca conociendo Telegram
 * directamente. Vive separado de NotificationCoordinator porque escucha una
 * familia de eventos distinta (reportes agregados, no eventos de una
 * Operation puntual): mismo principio de responsabilidad única que separa
 * StrategyCoordinator de OperationCoordinator.
 *
 * El reporte horario es exclusivamente del grupo oficial (ver
 * ReportScheduler, que ya filtra los datos): el destino se elige de forma
 * explícita con `selectChannelsByGroup(..., 'oficial')` y `dispatchTo`, en
 * vez de `dispatchToAll`/`supports()`. Antes dependía de que la Notification
 * llevara `metadata` vacía para que el canal de pruebas la descartara "por
 * casualidad" — una regla de negocio no debe depender de un efecto
 * colateral.
 */
@Injectable()
export class ReportNotificationCoordinator
  implements OnModuleInit, OnModuleDestroy
{
  private readonly channelDispatcher: NotificationChannelDispatcher;
  private readonly officialChannels: readonly NotificationChannel[];

  private readonly hourlyHandler: DomainEventHandler<HourlyReportGeneratedEvent> =
    {
      handle: (event) => this.dispatch(event.payload),
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
    this.officialChannels = selectChannelsByGroup(channels, 'oficial');
  }

  onModuleInit(): void {
    this.domainEventBus.subscribe(
      HourlyReportGeneratedEvent.eventName,
      this.hourlyHandler,
    );
  }

  onModuleDestroy(): void {
    this.domainEventBus.unsubscribe(
      HourlyReportGeneratedEvent.eventName,
      this.hourlyHandler,
    );
  }

  private dispatch(report: ReportSnapshot): void {
    this.channelDispatcher.dispatchTo(this.officialChannels, (channelType) =>
      this.notificationFactory.createForHourlyReport(report, channelType),
    );
  }
}
