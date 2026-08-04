import { Inject, Injectable } from '@nestjs/common';

import {
  DOMAIN_EVENT_BUS,
  NOTIFICATION_CHANNELS,
  OPERATION_REPORT_STORE,
} from '../../core/constants/injection-tokens.constants';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { NotificationFactory } from '../../core/notification/notification.factory';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import type { OperationReportStore } from '../../core/reporting/interfaces/operation-report-store.interface';
import { calculateSummaryMetrics } from '../../core/reporting/summary-metrics.calculator';
import { SummaryMetricsSnapshot } from '../../core/reporting/types/summary-metrics-snapshot.type';
import { NotificationChannelDispatcher } from '../notification/notification-channel-dispatcher';

/**
 * A qué destino(s) enviar el resumen, elegido explícitamente por quien pide
 * el reporte (ver AdminController): a diferencia del resto de
 * notificaciones, el resumen no está atado a ninguna estrategia, así que su
 * destino no se decide por `channel.supports()` sino por este selector.
 */
export type SummaryReportChannelSelector = 'oficial' | 'pruebas' | 'todos';

/**
 * Genera y despacha el resumen completo del historial en memoria
 * (comando admin RESUMEN): a diferencia de ReportScheduler, no tiene
 * scheduling propio ni ventana de tiempo — lee todo lo que haya en
 * OperationReportStore desde que arrancó el proceso.
 *
 * Deliberadamente independiente de ReportScheduler/ReportNotificationCoordinator:
 * construye su propio NotificationChannelDispatcher (mismo patrón que
 * ambos) para no acoplar el flujo bajo demanda al flujo automático del
 * reporte horario.
 */
@Injectable()
export class SummaryReportService {
  private readonly processStartedAt = new Date();
  private readonly channelDispatcher: NotificationChannelDispatcher;

  constructor(
    @Inject(OPERATION_REPORT_STORE)
    private readonly store: OperationReportStore,
    @Inject(DOMAIN_EVENT_BUS) domainEventBus: DomainEventBus,
    @Inject(NOTIFICATION_CHANNELS)
    private readonly channels: readonly NotificationChannel[],
    private readonly notificationFactory: NotificationFactory,
    errorTracker: EngineErrorTracker,
  ) {
    this.channelDispatcher = new NotificationChannelDispatcher(
      domainEventBus,
      channels,
      errorTracker,
    );
  }

  generateAndDispatch(
    channelSelector: SummaryReportChannelSelector = 'todos',
  ): SummaryMetricsSnapshot {
    const now = new Date();
    const opened = this.store.getAllOpened();
    const closed = this.store.getAllClosed();
    const metrics = calculateSummaryMetrics(
      opened,
      closed,
      this.processStartedAt,
      now,
    );

    this.channelDispatcher.dispatchTo(
      this.selectChannels(channelSelector),
      (channelType) =>
        this.notificationFactory.createForSummaryReport(
          metrics,
          now,
          channelType,
        ),
    );

    return metrics;
  }

  /**
   * El selector elige por destino de negocio ("oficial"/"pruebas"/"todos"),
   * no por instancia concreta: se resuelve mirando `getChannelType()` de
   * cada canal registrado, igual que ya distingue MessageTracker al borrar
   * mensajes (ver TelegramChannelConfig.channelType).
   */
  private selectChannels(
    selector: SummaryReportChannelSelector,
  ): readonly NotificationChannel[] {
    switch (selector) {
      case 'oficial':
        return this.channels.filter(
          (channel) =>
            channel.getChannelType() === NotificationChannelType.TELEGRAM,
        );
      case 'pruebas':
        return this.channels.filter(
          (channel) =>
            channel.getChannelType() ===
            NotificationChannelType.TELEGRAM_PRUEBAS,
        );
      case 'todos':
        return this.channels;
    }
  }
}
