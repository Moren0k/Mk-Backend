import { NotificationChannelType } from '../enums/notification-channel-type.enum';
import { NotificationSeverity } from '../enums/notification-severity.enum';
import { WinnerType } from '../enums/winner-type.enum';
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

function buildPatronLine(strategyId: string): string {
  return `📊 PATRON: ${strategyId}`;
}

function formatWinnerBall(winner: WinnerType): string {
  return winner === WinnerType.PLAYER ? '🔵 P' : '🔴 B';
}

export class NotificationFactory {
  createForOperationOpened(
    snapshot: OperationSnapshot,
    channel: NotificationChannelType,
    distribution?: DistributionMetricValue,
  ): Notification {
    const streakBall = formatWinnerBall(snapshot.streakWinner);
    const entryBall = formatWinnerBall(snapshot.recommendedWinner);

    return createNotification({
      channel,
      severity: NotificationSeverity.INFO,
      title: '',
      message: this.appendDistribution(
        [
          '🚨 NUEVA ENTRADA 🚨',
          '',
          '🎯 JUEGO: Bac Bo - Evolution',
          buildPatronLine(snapshot.strategyId),
          '',
          `💣 INGRESAR DESPUES DE :${streakBall}`,
          `🔥APUESTA EN: ${entryBall}`,
          '',
          `🔁 MARTINGALAS MAXIMO: ${snapshot.maxMartingales}`,
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
    const ball = formatWinnerBall(snapshot.recommendedWinner);

    return createNotification({
      channel,
      severity: NotificationSeverity.WARNING,
      title: '',
      message: this.appendDistribution(
        [
          '🔁 MARTINGALA 1',
          '',
          buildPatronLine(snapshot.strategyId),
          `🔥 DOBLA TU APUESTA ANTERIOR AL: ${ball}`,
        ].join('\n'),
        distribution,
      ),
      metadata: { operationId: snapshot.operationId, martingaleNumber: 1 },
    });
  }

  createForMartingaleTwoReached(
    snapshot: OperationSnapshot,
    channel: NotificationChannelType,
    distribution?: DistributionMetricValue,
  ): Notification {
    const ball = formatWinnerBall(snapshot.recommendedWinner);

    return createNotification({
      channel,
      severity: NotificationSeverity.WARNING,
      title: '',
      message: this.appendDistribution(
        [
          '🔁 MARTINGALA 2',
          '',
          buildPatronLine(snapshot.strategyId),
          `🔥 DOBLA TU APUESTA ANTERIOR AL: ${ball}`,
        ].join('\n'),
        distribution,
      ),
      metadata: { operationId: snapshot.operationId, martingaleNumber: 2 },
    });
  }

  createForOperationWon(
    snapshot: OperationSnapshot,
    channel: NotificationChannelType,
    distribution?: DistributionMetricValue,
  ): Notification {
    return createNotification({
      channel,
      severity: NotificationSeverity.SUCCESS,
      title: '',
      message: this.appendDistribution(
        [
          '✅ OPERACION GANADA ✅',
          '',
          buildPatronLine(snapshot.strategyId),
          '',
          `🏆 VICTORIA EN: ${snapshot.recommendedWinner}`,
          `🔁 MARTINGALAS FINAL: ${snapshot.currentMartingale}`,
          '',
          '💸 VAMOS POR MAS 💸',
        ].join('\n'),
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
    const ball = formatWinnerBall(snapshot.recommendedWinner);

    return createNotification({
      channel,
      severity: NotificationSeverity.ERROR,
      title: '',
      message: this.appendDistribution(
        [
          '❌ OPERACION PERDIDA ❌',
          '',
          buildPatronLine(snapshot.strategyId),
          '',
          `☠️ DERROTA: ${ball}`,
          `🔁 MARTINGALAS FINAL: ${snapshot.currentMartingale}`,
          '',
          '🧊 MENTE FRIA, NOS RECUPERAMOS EN LA PROXIMA',
        ].join('\n'),
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
    const ball = formatWinnerBall(snapshot.recommendedWinner);

    return createNotification({
      channel,
      severity: NotificationSeverity.WARNING,
      title: '',
      message: this.appendDistribution(
        [
          '🟰 EMPATE 🟰',
          '',
          buildPatronLine(snapshot.strategyId),
          '',
          `🔥 APUESTA LO ANTERIOR AL: ${ball}`,
          '',
          '💸 ESTA GANAREMOS 💸',
        ].join('\n'),
        distribution,
      ),
      metadata: { operationId: snapshot.operationId },
    });
  }

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
