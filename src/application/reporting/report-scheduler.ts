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
import { buildGroupMetrics } from '../../core/reporting/build-group-metrics';
import { calculateReportMetrics } from '../../core/reporting/report-metrics.calculator';
import {
  getNextHourBoundary,
  isOperatingHour,
} from '../../core/reporting/report-clock';
import { ONE_HOUR_MS } from '../../core/reporting/reporting.constants';
import type { OperationReportStore } from '../../core/reporting/interfaces/operation-report-store.interface';
import { ReportSnapshot } from '../../core/reporting/types/report-snapshot.type';
import { StrategyGroup } from '../../core/strategy/strategy-group';

/**
 * Grupos para los que se genera y publica un reporte horario automático de
 * forma independiente. Agregar un grupo nuevo aquí es el único cambio
 * necesario para que el scheduler también lo cubra (ver
 * ReportNotificationCoordinator, que enruta cada evento según su `group`).
 */
const HOURLY_REPORT_GROUPS: readonly StrategyGroup[] = ['oficial', 'pruebas'];

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
 *
 * Genera un reporte horario independiente por cada grupo en
 * HOURLY_REPORT_GROUPS: oficial y pruebas nunca comparten un mismo evento
 * ni un mismo cálculo (ver buildGroupMetrics), aunque ambos se disparen en
 * el mismo tick de reloj.
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

  /**
   * Lee los registros de la ventana una sola vez (sin filtrar) y publica un
   * ReportSnapshot por grupo, cada uno con sus propios registros filtrados
   * y sus propias métricas (ver buildGroupMetrics) — así oficial y pruebas
   * nunca se mezclan en un mismo reporte.
   */
  private publishReport(from: Date, to: Date): void {
    const opened = this.store.getOpenedBetween(from, to);
    const closed = this.store.getClosedBetween(from, to);

    for (const group of HOURLY_REPORT_GROUPS) {
      const metrics = buildGroupMetrics(
        opened,
        closed,
        group,
        calculateReportMetrics,
      );

      const snapshot: ReportSnapshot = Object.freeze({
        windowFrom: from,
        windowTo: to,
        group,
        metrics,
      });

      this.domainEventBus.publish(new HourlyReportGeneratedEvent(snapshot));
    }
  }
}
