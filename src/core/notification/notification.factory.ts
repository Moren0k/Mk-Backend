import { NotificationChannelType } from '../enums/notification-channel-type.enum';
import { NotificationSeverity } from '../enums/notification-severity.enum';
import type { DistributionMetricValue } from '../metrics/types/distribution-metric-value.type';
import { OperationSnapshot } from '../operation/types/operation-snapshot.type';
import { formatBogotaHourLabel } from '../reporting/report-clock';
import { ReportKind } from '../reporting/types/report-kind.enum';
import { ReportMetricsSnapshot } from '../reporting/types/report-metrics-snapshot.type';
import { ReportSnapshot } from '../reporting/types/report-snapshot.type';
import { createNotification, Notification } from './notification.type';

const REPORT_DIVIDER = '━━━━━━━━━━━━━━━━━━━━';

const REPORT_TITLE_BY_KIND: Readonly<Record<ReportKind, string>> = {
  [ReportKind.HOURLY]: '📊 Reporte Horario',
  [ReportKind.DAILY]: '📅 Reporte Diario',
};

function humanizeStrategyId(strategyId: string): string {
  return strategyId
    .split('-')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatTime(date: Date): string {
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function buildOperationSummary(snapshot: OperationSnapshot): string {
  return [
    `Estrategia: ${humanizeStrategyId(snapshot.strategyId)}`,
    `Entrada: ${snapshot.recommendedWinner}`,
  ].join('\n');
}

/**
 * Convierte eventos de dominio (siempre un OperationSnapshot, en esta
 * etapa) en Notification. No conoce Telegram ni ningún canal concreto: solo
 * decide título/mensaje/severidad según qué ocurrió, y a qué channelType
 * queda dirigida (lo decide quién la llama, nunca esta clase).
 */
export class NotificationFactory {
  createForOperationOpened(
    snapshot: OperationSnapshot,
    channel: NotificationChannelType,
    distribution?: DistributionMetricValue,
  ): Notification {
    return createNotification({
      channel,
      severity: NotificationSeverity.INFO,
      title: '🚨 Nueva operación',
      message: this.appendDistribution(
        [
          buildOperationSummary(snapshot),
          `Martingalas máximas: ${snapshot.maxMartingales}`,
          `Motivo: ${snapshot.reason}`,
          `Hora: ${formatTime(snapshot.openedAt)}`,
        ].join('\n'),
        distribution,
      ),
      metadata: { operationId: snapshot.operationId },
    });
  }

  createForMartingaleOneReached(
    snapshot: OperationSnapshot,
    channel: NotificationChannelType,
    distribution?: DistributionMetricValue,
  ): Notification {
    return this.createForMartingaleReached(
      snapshot,
      channel,
      1,
      '⚠️ Martingala 1',
      distribution,
    );
  }

  createForMartingaleTwoReached(
    snapshot: OperationSnapshot,
    channel: NotificationChannelType,
    distribution?: DistributionMetricValue,
  ): Notification {
    return this.createForMartingaleReached(
      snapshot,
      channel,
      2,
      '⚠️ Martingala 2',
      distribution,
    );
  }

  createForOperationWon(
    snapshot: OperationSnapshot,
    channel: NotificationChannelType,
    distribution?: DistributionMetricValue,
  ): Notification {
    return createNotification({
      channel,
      severity: NotificationSeverity.SUCCESS,
      title: '✅ Operación ganada',
      message: this.appendDistribution(
        this.buildClosingMessage(snapshot),
        distribution,
      ),
      metadata: { operationId: snapshot.operationId },
    });
  }

  createForOperationLost(
    snapshot: OperationSnapshot,
    channel: NotificationChannelType,
    distribution?: DistributionMetricValue,
  ): Notification {
    return createNotification({
      channel,
      severity: NotificationSeverity.ERROR,
      title: '❌ Operación perdida',
      message: this.appendDistribution(
        this.buildClosingMessage(snapshot),
        distribution,
      ),
      metadata: { operationId: snapshot.operationId },
    });
  }

  createForHourlyReport(
    report: ReportSnapshot,
    channel: NotificationChannelType,
  ): Notification {
    return this.createForReport(report, channel);
  }

  createForDailyReport(
    report: ReportSnapshot,
    channel: NotificationChannelType,
  ): Notification {
    return this.createForReport(report, channel);
  }

  createForTieOccurred(
    snapshot: OperationSnapshot,
    channel: NotificationChannelType,
    distribution?: DistributionMetricValue,
  ): Notification {
    return createNotification({
      channel,
      severity: NotificationSeverity.WARNING,
      title: '⚠️ Empate',
      message: this.appendDistribution(
        [
          `Estrategia: ${humanizeStrategyId(snapshot.strategyId)}`,
          `Entrada: ${snapshot.recommendedWinner}`,
          `Estado: ${snapshot.currentState}`,
          `Hora: ${formatTime(new Date())}`,
        ].join('\n'),
        distribution,
      ),
      metadata: { operationId: snapshot.operationId },
    });
  }

  /**
   * Un único builder para reportes horarios y diarios: usan exactamente el
   * mismo cuerpo de métricas (según lo pedido), solo cambia el título por
   * `ReportKind`.
   */
  private createForReport(
    report: ReportSnapshot,
    channel: NotificationChannelType,
  ): Notification {
    const from = formatBogotaHourLabel(report.windowFrom);
    const to = formatBogotaHourLabel(report.windowTo);

    return createNotification({
      channel,
      severity: NotificationSeverity.INFO,
      title: `${REPORT_TITLE_BY_KIND[report.kind]} · ${from} - ${to} (COL)`,
      message: this.buildReportMessage(report.metrics),
      metadata: { kind: report.kind },
    });
  }

  private buildReportMessage(metrics: ReportMetricsSnapshot): string {
    return [
      REPORT_DIVIDER,
      `🚨 Alertas enviadas: ${metrics.alertsSent}`,
      `✅ Operaciones cerradas: ${metrics.closedOperations}`,
      REPORT_DIVIDER,
      `🏆 Ganadas: ${metrics.won}`,
      `❌ Perdidas: ${metrics.lost}`,
      `🎯 Efectividad: ${metrics.effectivenessPct.toFixed(2)}%`,
      REPORT_DIVIDER,
      '📈 Desglose de victorias',
      `⚡ Directas: ${metrics.directWins}`,
      `🥈 Martingala 1: ${metrics.martingaleOneWins}`,
      `🥉 Martingala 2: ${metrics.martingaleTwoWins}`,
      REPORT_DIVIDER,
      '📊 Distribución de resultados',
      `⚡ Directa: ${metrics.distribution.directPct.toFixed(2)}%`,
      `🥈 MG1: ${metrics.distribution.martingaleOnePct.toFixed(2)}%`,
      `🥉 MG2: ${metrics.distribution.martingaleTwoPct.toFixed(2)}%`,
      `🔻 Perdidas: ${metrics.distribution.lostPct.toFixed(2)}%`,
      REPORT_DIVIDER,
      `⚠️ Martingalas agotadas: ${metrics.martingalesExhausted}`,
    ].join('\n');
  }

  private createForMartingaleReached(
    snapshot: OperationSnapshot,
    channel: NotificationChannelType,
    martingaleNumber: number,
    title: string,
    distribution?: DistributionMetricValue,
  ): Notification {
    const lastTransition = snapshot.history[snapshot.history.length - 1];

    return createNotification({
      channel,
      severity: NotificationSeverity.WARNING,
      title,
      message: this.appendDistribution(
        [
          buildOperationSummary(snapshot),
          `Motivo: ${lastTransition?.reason ?? snapshot.reason}`,
          `Hora: ${formatTime(lastTransition?.timestamp ?? new Date())}`,
        ].join('\n'),
        distribution,
      ),
      metadata: { operationId: snapshot.operationId, martingaleNumber },
    });
  }

  private buildClosingMessage(snapshot: OperationSnapshot): string {
    return [
      buildOperationSummary(snapshot),
      `Martingala final: ${snapshot.currentMartingale}`,
      `Hora: ${formatTime(snapshot.closedAt ?? new Date())}`,
    ].join('\n');
  }

  private appendDistribution(
    message: string,
    distribution?: DistributionMetricValue,
  ): string {
    if (!distribution) {
      return message;
    }

    return `${message}\n\n${this.formatDistribution(distribution)}`;
  }

  private formatDistribution(distribution: DistributionMetricValue): string {
    const p = distribution.playerPct.toFixed(2);
    const t = distribution.tiePct.toFixed(2);
    const b = distribution.bankerPct.toFixed(2);

    return `🔵 ${p}%  🟡 ${t}%  🔴 ${b}%`;
  }
}
