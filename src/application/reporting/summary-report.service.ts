import { Inject, Injectable } from '@nestjs/common';

import {
  DOMAIN_EVENT_BUS,
  NOTIFICATION_CHANNELS,
  OPERATION_REPORT_STORE,
} from '../../core/constants/injection-tokens.constants';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { NotificationFactory } from '../../core/notification/notification.factory';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import type { OperationReportStore } from '../../core/reporting/interfaces/operation-report-store.interface';
import { filterByStrategyGroup } from '../../core/reporting/report-group-filter';
import { calculateSummaryMetrics } from '../../core/reporting/summary-metrics.calculator';
import { SummaryReportResult } from '../../core/reporting/types/summary-report-result.type';
import { StrategyGroup } from '../../core/strategy/strategy-group';
import { NotificationChannelDispatcher } from '../notification/notification-channel-dispatcher';
import { selectChannelsByGroup } from '../notification/notification-channel-selector';

/**
 * A qué destino(s) enviar el resumen, elegido explícitamente por quien pide
 * el reporte (ver AdminController): a diferencia del resto de
 * notificaciones, el resumen no está atado a ninguna estrategia, así que su
 * destino no se decide por `channel.supports()` sino por este selector.
 */
export type SummaryReportChannelSelector = 'oficial' | 'pruebas' | 'todos';

const GROUPS_BY_SELECTOR: Readonly<
  Record<SummaryReportChannelSelector, readonly StrategyGroup[]>
> = {
  oficial: ['oficial'],
  pruebas: ['pruebas'],
  todos: ['oficial', 'pruebas'],
};

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
 *
 * Oficial y pruebas nunca comparten un mismo mensaje: se calculan dos
 * SummaryMetricsSnapshot independientes (filtrando los registros por
 * grupo antes de calcular) y cada uno se despacha únicamente al chat que le
 * corresponde, incluso cuando el selector es "todos" (dos mensajes
 * distintos, uno por chat, nunca uno combinado).
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
  ): SummaryReportResult {
    const now = new Date();
    const opened = this.store.getAllOpened();
    const closed = this.store.getAllClosed();

    const result: SummaryReportResult = {
      oficial: calculateSummaryMetrics(
        filterByStrategyGroup(opened, 'oficial'),
        filterByStrategyGroup(closed, 'oficial'),
        this.processStartedAt,
        now,
      ),
      pruebas: calculateSummaryMetrics(
        filterByStrategyGroup(opened, 'pruebas'),
        filterByStrategyGroup(closed, 'pruebas'),
        this.processStartedAt,
        now,
      ),
    };

    for (const group of GROUPS_BY_SELECTOR[channelSelector]) {
      this.channelDispatcher.dispatchTo(
        selectChannelsByGroup(this.channels, group),
        (channelType) =>
          this.notificationFactory.createForSummaryReport(
            result[group],
            now,
            channelType,
          ),
      );
    }

    return result;
  }
}
