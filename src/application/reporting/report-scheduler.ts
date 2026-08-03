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
import { DailyReportGeneratedEvent } from '../../core/domain-events/reporting/daily-report-generated.event';
import { HourlyReportGeneratedEvent } from '../../core/domain-events/reporting/hourly-report-generated.event';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { calculateReportMetrics } from '../../core/reporting/report-metrics.calculator';
import {
  getDailyWindowStart,
  getNextDailyReportBoundary,
  getNextHourBoundary,
  isOperatingHour,
} from '../../core/reporting/report-clock';
import { ONE_HOUR_MS } from '../../core/reporting/reporting.constants';
import type { OperationReportStore } from '../../core/reporting/interfaces/operation-report-store.interface';
import { ReportKind } from '../../core/reporting/types/report-kind.enum';
import { ReportSnapshot } from '../../core/reporting/types/report-snapshot.type';

/**
 * Dispara los reportes horario y diario exactamente en las horas de reloj
 * que corresponden (hora de Bogotá), sin depender de cuánto tiempo lleva
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
  private dailyTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
    @Inject(OPERATION_REPORT_STORE)
    private readonly store: OperationReportStore,
  ) {}

  onModuleInit(): void {
    this.scheduleNextHourlyTick();
    this.scheduleNextDailyTick();
  }

  onModuleDestroy(): void {
    clearTimeout(this.hourlyTimer);
    clearTimeout(this.dailyTimer);
  }

  private scheduleNextHourlyTick(): void {
    const now = new Date();
    const boundary = getNextHourBoundary(now);

    this.hourlyTimer = setTimeout(() => {
      this.onHourlyTick(boundary);
      this.scheduleNextHourlyTick();
    }, boundary.getTime() - now.getTime());
  }

  private scheduleNextDailyTick(): void {
    const now = new Date();
    const boundary = getNextDailyReportBoundary(now);

    this.dailyTimer = setTimeout(() => {
      this.onDailyTick(boundary);
      this.scheduleNextDailyTick();
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
    this.publishReport(ReportKind.HOURLY, hourStart, hourEnd);
  }

  private onDailyTick(dailyEnd: Date): void {
    const dailyStart = getDailyWindowStart(dailyEnd);

    this.logger.log(
      `Generando reporte diario ${dailyStart.toISOString()} - ${dailyEnd.toISOString()}.`,
    );
    this.publishReport(ReportKind.DAILY, dailyStart, dailyEnd);

    // Ya quedó reportado (horario + diario acumulado): se libera la memoria
    // acotando el crecimiento del store a lo sumo a una jornada operativa.
    this.store.clear();
  }

  private publishReport(kind: ReportKind, from: Date, to: Date): void {
    const opened = this.store.getOpenedBetween(from, to);
    const closed = this.store.getClosedBetween(from, to);
    const metrics = calculateReportMetrics(opened, closed);

    const snapshot: ReportSnapshot = Object.freeze({
      kind,
      windowFrom: from,
      windowTo: to,
      metrics,
    });

    this.domainEventBus.publish(
      kind === ReportKind.HOURLY
        ? new HourlyReportGeneratedEvent(snapshot)
        : new DailyReportGeneratedEvent(snapshot),
    );
  }
}
