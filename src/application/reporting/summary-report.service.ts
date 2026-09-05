import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  DOMAIN_EVENT_BUS,
  NOTIFICATION_CHANNELS,
  OPERATION_REPORT_STORE,
  REPORT_CHECKPOINT_STORE,
} from '../../core/constants/injection-tokens.constants';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { NotificationFactory } from '../../core/notification/notification.factory';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { buildGroupMetrics } from '../../core/reporting/build-group-metrics';
import type { OperationReportStore } from '../../core/reporting/interfaces/operation-report-store.interface';
import type {
  ReportCheckpointSnapshot,
  ReportCheckpointStore,
} from '../../core/reporting/interfaces/report-checkpoint-store.interface';
import {
  LOSS_UNIT_MULTIPLIER,
  rate,
} from '../../core/reporting/report-metrics.calculator';
import { calculateSummaryMetrics } from '../../core/reporting/summary-metrics.calculator';
import { SummaryMetricsSnapshot } from '../../core/reporting/types/summary-metrics-snapshot.type';
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

const REPORT_GROUPS: readonly StrategyGroup[] = ['oficial', 'pruebas'];

/** Offset persistido (checkpoint de un proceso/deploy anterior) que se
 *  suma a lo ocurrido en memoria desde que arrancó el proceso actual. */
type ChannelCheckpointOffset = Readonly<{
  won: number;
  lost: number;
  alertsSent: number;
  firstStartedAt: Date;
}>;

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
 *
 * `OperationReportStore` (en memoria) nunca sobrevive un redeploy: por eso
 * este servicio también mantiene un offset por canal, cargado desde
 * ReportCheckpointStore (Postgres/Supabase) vía `hydrateFromCheckpoint` y
 * refrescado en la base periódicamente por ReportCheckpointScheduler — así
 * won/lost/alertsSent/uptimeMs (los mismos campos que expone GET
 * /api/v1/reports/summary) nunca vuelven a cero tras un reinicio, aunque
 * el detalle fino (rachas, distribución, martingalas) sí se reconstruye
 * desde cero en cada proceso, deliberadamente — ver ReportCheckpoint en
 * prisma/schema.prisma.
 */
@Injectable()
export class SummaryReportService {
  private readonly logger = new Logger(SummaryReportService.name);
  private readonly processStartedAt = new Date();
  private readonly channelDispatcher: NotificationChannelDispatcher;
  private offsets: Record<StrategyGroup, ChannelCheckpointOffset>;

  constructor(
    @Inject(OPERATION_REPORT_STORE)
    private readonly store: OperationReportStore,
    @Inject(DOMAIN_EVENT_BUS) domainEventBus: DomainEventBus,
    @Inject(NOTIFICATION_CHANNELS)
    private readonly channels: readonly NotificationChannel[],
    private readonly notificationFactory: NotificationFactory,
    errorTracker: EngineErrorTracker,
    @Inject(REPORT_CHECKPOINT_STORE)
    private readonly checkpointStore: ReportCheckpointStore,
  ) {
    this.channelDispatcher = new NotificationChannelDispatcher(
      domainEventBus,
      channels,
      errorTracker,
    );
    this.offsets = {
      oficial: this.emptyOffset(),
      pruebas: this.emptyOffset(),
    };
  }

  private emptyOffset(): ChannelCheckpointOffset {
    return {
      won: 0,
      lost: 0,
      alertsSent: 0,
      firstStartedAt: this.processStartedAt,
    };
  }

  /**
   * Carga el checkpoint persistido (si existe) como punto de partida de
   * won/lost/alertsSent/uptime. Debe invocarse explícitamente desde
   * main.ts, ANTES de `GameEventCollector.start()` — mismo criterio que el
   * propio collector (ver ARCHITECTURE.md §8): así ninguna operación real
   * puede cerrarse y contarse antes de que el offset esté cargado. Nunca
   * lanza: si la persistencia no está disponible, `loadAll()` devuelve
   * `[]` y el offset queda en cero (comportamiento idéntico al actual, sin
   * checkpoint).
   */
  async hydrateFromCheckpoint(): Promise<void> {
    const rows = await this.checkpointStore.loadAll();

    for (const row of rows) {
      this.offsets[row.channel] = {
        won: row.won,
        lost: row.lost,
        alertsSent: row.alertsSent,
        firstStartedAt: row.firstStartedAt,
      };
    }

    if (rows.length > 0) {
      this.logger.log(
        `Checkpoint de reportes restaurado: ${rows
          .map(
            (row) =>
              `${row.channel}(won=${row.won}, lost=${row.lost}, alertsSent=${row.alertsSent})`,
          )
          .join(', ')}.`,
      );
    }
  }

  /**
   * Persiste won/lost/alertsSent/firstStartedAt acumulados (offset + lo
   * ocurrido en memoria desde que arrancó este proceso) para ambos
   * canales — invocado periódicamente por ReportCheckpointScheduler. Nunca
   * lanza (ReportCheckpointStore.save ya absorbe cualquier error).
   */
  async persistCheckpoint(now: Date = new Date()): Promise<void> {
    const snapshot = this.getSnapshot(now);

    for (const group of REPORT_GROUPS) {
      const metrics = snapshot[group];
      const checkpoint: ReportCheckpointSnapshot = {
        channel: group,
        won: metrics.won,
        lost: metrics.lost,
        alertsSent: metrics.alertsSent,
        firstStartedAt: this.offsets[group].firstStartedAt,
      };
      await this.checkpointStore.save(checkpoint);
    }
  }

  /**
   * Variante de solo lectura de `generateAndDispatch`: mismo cálculo
   * (oficial + pruebas, nunca mezclados) combinado con el offset del
   * checkpoint, pero sin tocar `NotificationChannelDispatcher` — pensada
   * para que un `GET` bajo demanda (dashboard del frontend, sondeado con
   * frecuencia) pueda leer won/lost/alertsSent/uptimeMs sin disparar un
   * mensaje de Telegram en cada llamada.
   */
  getSnapshot(now: Date = new Date()): SummaryReportResult {
    const opened = this.store.getAllOpened();
    const closed = this.store.getAllClosed();

    return {
      oficial: this.combineWithOffset(
        buildGroupMetrics(opened, closed, 'oficial', (o, c) =>
          calculateSummaryMetrics(o, c, this.processStartedAt, now),
        ),
        'oficial',
        now,
      ),
      pruebas: this.combineWithOffset(
        buildGroupMetrics(opened, closed, 'pruebas', (o, c) =>
          calculateSummaryMetrics(o, c, this.processStartedAt, now),
        ),
        'pruebas',
        now,
      ),
    };
  }

  /**
   * Suma el offset persistido (checkpoint de un proceso/deploy anterior) a
   * las métricas calculadas sobre lo ocurrido en memoria desde que arrancó
   * ESTE proceso. Solo ajusta los campos que dependen directamente de
   * won/lost/alertsSent/uptime (los mismos que expone GET
   * /api/v1/reports/summary): el resto de SummaryMetricsSnapshot (rachas,
   * distribución, martingalas, horas destacadas) sigue reflejando
   * únicamente lo ocurrido desde el arranque de este proceso — el
   * checkpoint es deliberadamente mínimo (ver ReportCheckpoint en
   * prisma/schema.prisma).
   */
  private combineWithOffset(
    metrics: SummaryMetricsSnapshot,
    group: StrategyGroup,
    now: Date,
  ): SummaryMetricsSnapshot {
    const offset = this.offsets[group];
    const won = metrics.won + offset.won;
    const lost = metrics.lost + offset.lost;
    const alertsSent = metrics.alertsSent + offset.alertsSent;
    const closedOperations =
      metrics.closedOperations + offset.won + offset.lost;

    return {
      ...metrics,
      won,
      lost,
      alertsSent,
      closedOperations,
      effectivenessPct: rate(won, closedOperations),
      netUnits: won - lost * LOSS_UNIT_MULTIPLIER,
      uptimeMs: now.getTime() - offset.firstStartedAt.getTime(),
    };
  }

  generateAndDispatch(
    channelSelector: SummaryReportChannelSelector = 'todos',
  ): SummaryReportResult {
    const now = new Date();
    const result = this.getSnapshot(now);

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
