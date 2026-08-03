import { NotificationChannelType } from '../enums/notification-channel-type.enum';
import { NotificationSeverity } from '../enums/notification-severity.enum';
import type { DistributionMetricValue } from '../metrics/types/distribution-metric-value.type';
import { OperationSnapshot } from '../operation/types/operation-snapshot.type';
import { formatDurationLabel } from '../reporting/duration-formatter';
import { formatBogotaHourLabel } from '../reporting/report-clock';
import { ReportMetricsSnapshot } from '../reporting/types/report-metrics-snapshot.type';
import { ReportSnapshot } from '../reporting/types/report-snapshot.type';
import { SummaryMetricsSnapshot } from '../reporting/types/summary-metrics-snapshot.type';
import { createNotification, Notification } from './notification.type';

const REPORT_DIVIDER = '━━━━━━━━━━━━━━━━━━━━';

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
    const from = formatBogotaHourLabel(report.windowFrom);
    const to = formatBogotaHourLabel(report.windowTo);

    return createNotification({
      channel,
      severity: NotificationSeverity.INFO,
      title: `📊 Reporte Horario · ${from} - ${to} (COL)`,
      message: this.buildReportMessage(report.metrics),
      metadata: {},
    });
  }

  /**
   * Resumen completo bajo demanda (endpoint admin, comando RESUMEN): todo
   * el historial en memoria desde que arrancó el proceso, sin ventana de
   * tiempo. Mismo estilo que el reporte horario (REPORT_DIVIDER, emojis
   * consistentes) pero agrupado en más secciones porque el detalle
   * adicional (rachas, martingalas, destacados por hora) sí aporta valor
   * cuando se pide explícitamente, a diferencia del vistazo horario.
   */
  createForSummaryReport(
    metrics: SummaryMetricsSnapshot,
    generatedAt: Date,
    channel: NotificationChannelType,
  ): Notification {
    return createNotification({
      channel,
      severity: NotificationSeverity.INFO,
      title: `🧭 Resumen Completo del Sistema · ${formatTime(generatedAt)}`,
      message: this.buildSummaryMessage(metrics),
      metadata: {},
    });
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
   * Resumen breve pensado para leerse de un vistazo: solo alertas, el
   * resultado global y la distribución (conteo + %) por tipo de cierre. No
   * incluye operaciones cerradas ni martingalas agotadas por separado —
   * esa profundidad queda para el resumen completo bajo demanda
   * (ver createForSummaryReport).
   */
  private buildReportMessage(metrics: ReportMetricsSnapshot): string {
    return [
      REPORT_DIVIDER,
      `🚨 Alertas enviadas: ${metrics.alertsSent}`,
      REPORT_DIVIDER,
      `🏆 Ganadas: ${metrics.won}`,
      `❌ Perdidas: ${metrics.lost}`,
      `🎯 Efectividad: ${metrics.effectivenessPct.toFixed(2)}%`,
      REPORT_DIVIDER,
      '📈 Distribución de resultados',
      '',
      `⚡ Directas: ${metrics.directWins} - ${metrics.distribution.directPct.toFixed(2)}%`,
      `🥈 Martingala 1: ${metrics.martingaleOneWins} - ${metrics.distribution.martingaleOnePct.toFixed(2)}%`,
      `🥉 Martingala 2: ${metrics.martingaleTwoWins} - ${metrics.distribution.martingaleTwoPct.toFixed(2)}%`,
      `🔻 Perdidas: ${metrics.distribution.lostPct.toFixed(2)}%`,
    ].join('\n');
  }

  private buildSummaryMessage(metrics: SummaryMetricsSnapshot): string {
    const currentStreakLabel =
      metrics.currentStreak.result === 'NONE'
        ? 'Sin datos'
        : `${metrics.currentStreak.length} ${metrics.currentStreak.result === 'WON' ? 'ganadas' : 'perdidas'}`;

    return [
      '🎛️ Información general',
      `🕐 Tiempo activo: ${formatDurationLabel(metrics.uptimeMs)}`,
      `🚨 Alertas enviadas: ${metrics.alertsSent}`,
      `✅ Operaciones cerradas: ${metrics.closedOperations}`,
      `🏆 Ganadas: ${metrics.won}`,
      `❌ Perdidas: ${metrics.lost}`,
      `🎯 Efectividad: ${metrics.effectivenessPct.toFixed(2)}%`,
      REPORT_DIVIDER,
      '📈 Desglose de victorias',
      `⚡ Directas: ${metrics.directWins}`,
      `🥈 Martingala 1: ${metrics.martingaleOneWins}`,
      `🥉 Martingala 2: ${metrics.martingaleTwoWins}`,
      `⛔ Martingalas agotadas: ${metrics.martingalesExhausted}`,
      REPORT_DIVIDER,
      '📊 Distribución porcentual',
      `⚡ Directa: ${metrics.distribution.directPct.toFixed(2)}%`,
      `🥈 MG1: ${metrics.distribution.martingaleOnePct.toFixed(2)}%`,
      `🥉 MG2: ${metrics.distribution.martingaleTwoPct.toFixed(2)}%`,
      `🔻 Perdidas: ${metrics.distribution.lostPct.toFixed(2)}%`,
      REPORT_DIVIDER,
      '🔍 Métricas adicionales',
      `🔥 Mejor racha de victorias: ${metrics.bestWinStreak}`,
      `🧊 Peor racha de derrotas: ${metrics.worstLossStreak}`,
      `📌 Racha actual: ${currentStreakLabel}`,
      `⚖️ Ratio Ganadas/Perdidas: ${this.formatRatio(metrics.winLossRatio)}`,
      `🎲 Martingalas usadas (total): ${metrics.totalMartingalesUsed}`,
      `🎯 Promedio MG por victoria: ${metrics.avgMartingalesPerWin.toFixed(2)}`,
      `📎 % victorias directas: ${metrics.directWinPctOfWins.toFixed(2)}%`,
      `📎 % victorias con MG1: ${metrics.martingaleOneWinPctOfWins.toFixed(2)}%`,
      `📎 % victorias con MG2: ${metrics.martingaleTwoWinPctOfWins.toFixed(2)}%`,
      `📬 Promedio alertas/hora: ${metrics.alertsPerHourAvg.toFixed(2)}`,
      `📈 Efectividad promedio/hora: ${metrics.avgEffectivenessPerHour.toFixed(2)}%`,
      ...this.buildHourHighlightLines(metrics),
    ].join('\n');
  }

  private buildHourHighlightLines(metrics: SummaryMetricsSnapshot): string[] {
    const lines: string[] = [];

    if (metrics.bestAlertsHour) {
      lines.push(
        `⏰ Hora con más alertas: ${metrics.bestAlertsHour.label} (${metrics.bestAlertsHour.value})`,
      );
    }
    if (metrics.bestEffectivenessHour) {
      lines.push(
        `🌟 Mejor hora (efectividad): ${metrics.bestEffectivenessHour.label} (${metrics.bestEffectivenessHour.value.toFixed(2)}%)`,
      );
    }
    if (metrics.worstEffectivenessHour) {
      lines.push(
        `⚠️ Peor hora (efectividad): ${metrics.worstEffectivenessHour.label} (${metrics.worstEffectivenessHour.value.toFixed(2)}%)`,
      );
    }

    return lines;
  }

  private formatRatio(ratio: number): string {
    if (!Number.isFinite(ratio)) {
      return '∞';
    }
    return ratio.toFixed(2);
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
