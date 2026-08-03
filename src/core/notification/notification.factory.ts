import { NotificationChannelType } from '../enums/notification-channel-type.enum';
import { NotificationSeverity } from '../enums/notification-severity.enum';
import { WinnerType } from '../enums/winner-type.enum';
import type { DistributionMetricValue } from '../metrics/types/distribution-metric-value.type';
import { OperationSnapshot } from '../operation/types/operation-snapshot.type';
import { createNotification, Notification } from './notification.type';

function buildPatronLine(strategyId: string): string {
  return `📊 PATRON: ${strategyId}`;
}

function formatWinnerPct(
  distribution: DistributionMetricValue | undefined,
  recommendedWinner: WinnerType,
): string {
  if (!distribution) return '--';
  const pct =
    recommendedWinner === WinnerType.PLAYER
      ? distribution.playerPct
      : distribution.bankerPct;
  return pct.toFixed(2);
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
    const pct = formatWinnerPct(distribution, snapshot.recommendedWinner);

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
          `💣 INGRESAR DESPUES DE :${snapshot.recommendedWinner} ${pct}%`,
          `🔥APUESTA EN: ${snapshot.recommendedWinner} (${pct}%)`,
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
    const pct = formatWinnerPct(distribution, snapshot.recommendedWinner);

    return createNotification({
      channel,
      severity: NotificationSeverity.WARNING,
      title: '',
      message: this.appendDistribution(
        [
          '🔁 MARTINGALA 1',
          '',
          buildPatronLine(snapshot.strategyId),
          `🔥 DOBLA TU APUESTA ANTERIOR AL: ${snapshot.recommendedWinner} ${pct}%`,
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
    const pct = formatWinnerPct(distribution, snapshot.recommendedWinner);

    return createNotification({
      channel,
      severity: NotificationSeverity.WARNING,
      title: '',
      message: this.appendDistribution(
        [
          '🔁 MARTINGALA 2',
          '',
          buildPatronLine(snapshot.strategyId),
          `🔥 DOBLA TU APUESTA ANTERIOR AL: ${snapshot.recommendedWinner} ${pct}%`,
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
          `☠️ DERROTA: ${snapshot.recommendedWinner}`,
          `🔁 MARTINGALAS FINAL: ${snapshot.currentMartingale}`,
          '',
          '🧊 MENTE FRIA, NOS RECUPERAMOS EN LA PROXIMA',
        ].join('\n'),
        distribution,
      ),
      metadata: { operationId: snapshot.operationId },
    });
  }

  createForTieOccurred(
    snapshot: OperationSnapshot,
    channel: NotificationChannelType,
    distribution?: DistributionMetricValue,
  ): Notification {
    const pct = formatWinnerPct(distribution, snapshot.recommendedWinner);

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
          `🔥 APUESTA LO ANTERIOR AL: ${snapshot.recommendedWinner} ${pct}%`,
          '',
          '💸 ESTA GANAREMOS 💸',
        ].join('\n'),
        distribution,
      ),
      metadata: { operationId: snapshot.operationId },
    });
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
