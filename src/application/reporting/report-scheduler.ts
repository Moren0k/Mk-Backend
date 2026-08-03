import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import {
  DOMAIN_EVENT_BUS,
  OPERATION_REPORT_STORE,
} from '../../core/constants/injection-tokens.constants';
import { HourlyReportGeneratedEvent } from '../../core/domain-events/reporting/hourly-report-generated.event';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { calculateReportMetrics } from '../../core/reporting/report-metrics.calculator';
import {
  getNextHourBoundary,
  isOperatingHour,
} from '../../core/reporting/report-clock';
import { ONE_HOUR_MS } from '../../core/reporting/reporting.constants';
import type { OperationReportStore } from '../../core/reporting/interfaces/operation-report-store.interface';
import { ReportSnapshot } from '../../core/reporting/types/report-snapshot.type';

/**
 * Dispara el reporte horario exactamente en las horas de reloj que
 * corresponden (hora de Bogotá), sin depender de cuánto tiempo lleva
 * corriendo el proceso: nunca `setInterval` desde el arranque, siempre
 * `setTimeout` recalculado contra el próximo límite real (ver
 * report-clock.ts). Sin librería de scheduling: mismo criterio que el resto
 * del proyecto (SSE, backoff, ring buffer) de no sumar una dependencia para
 * algo que un `setTimeout` recursivo resuelve con precisión.
 *
 * No conoce Telegram ni ningún NotificationChannel: solo lee
 * OperationReportStore, calcula las métricas y publica el evento de
 * dominio correspondiente. ReportNotificationCoordinator es quien convierte
 * eso en una notificación real.
 */
@Injectable()
export class ReportScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportScheduler.name);
  private hourlyTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
    @Inject(OPERATION_REPORT_STORE)
    private readonly store: OperationReportStore,
  ) {}

  onModuleInit(): void {
    this.scheduleNextHourlyTick();
  }

  onModuleDestroy(): void {
    clearTimeout(this.hourlyTimer);
  }

  private scheduleNextHourlyTick(): void {
    const now = new Date();
    const boundary = getNextHourBoundary(now);

    this.hourlyTimer = setTimeout(() => {
      this.onHourlyTick(boundary);
      this.scheduleNextHourlyTick();
    }, boundary.getTime() - now.getTime());
  }

  private onHourlyTick(hourEnd: Date): void {
    const hourStart = new Date(hourEnd.getTime() - ONE_HOUR_MS);

    if (!isOperatingHour(hourStart)) {
      return;
    }

    this.logger.log(
      `Generando reporte horario ${hourStart.toISOString()} - ${hourEnd.toISOString()}.`,
    );
    this.publishReport(hourStart, hourEnd);
  }

  private publishReport(from: Date, to: Date): void {
    const opened = this.store.getOpenedBetween(from, to);
    const closed = this.store.getClosedBetween(from, to);
    const metrics = calculateReportMetrics(opened, closed);

    const snapshot: ReportSnapshot = Object.freeze({
      windowFrom: from,
      windowTo: to,
      metrics,
    });

    this.domainEventBus.publish(new HourlyReportGeneratedEvent(snapshot));
  }
}
