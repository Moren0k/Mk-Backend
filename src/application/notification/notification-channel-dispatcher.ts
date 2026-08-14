import { Logger } from '@nestjs/common';

import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { NotificationFailedEvent } from '../../core/domain-events/notification/notification-failed.event';
import { NotificationSentEvent } from '../../core/domain-events/notification/notification-sent.event';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { Notification } from '../../core/notification/notification.type';
import type { SendResult } from '../../core/notification/types/send-result.type';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';

const RETRIES_EXHAUSTED_REASON = 'El canal agotó sus reintentos.';

/**
 * Envía una Notification a cada canal habilitado que la soporte, sin
 * esperar (fire-and-forget) y reportando el resultado como
 * NotificationSentEvent/NotificationFailedEvent.
 *
 * Extraído de NotificationCoordinator para que cualquier otro coordinador
 * que construya Notification a partir de eventos distintos (por ejemplo
 * ReportNotificationCoordinator, con los reportes horario/diario) reutilice
 * exactamente la misma lógica de entrega en vez de duplicarla: lo único que
 * cambia entre ellos es qué Notification construir, nunca cómo entregarla.
 */
export class NotificationChannelDispatcher {
  private readonly logger = new Logger(NotificationChannelDispatcher.name);

  constructor(
    private readonly domainEventBus: DomainEventBus,
    private readonly channels: readonly NotificationChannel[],
    private readonly errorTracker: EngineErrorTracker,
  ) {}

  /**
   * Construye (vía `buildNotification`) y envía una Notification por cada
   * canal habilitado que la soporte. Se le pasa una función en vez de una
   * Notification ya armada porque cada canal puede requerir una instancia
   * distinta, dirigida a su propio `NotificationChannelType`.
   *
   * @param onSent Callback opcional que se invoca después de que el envío
   *   completa exitosamente, con la Notification y el SendResult del canal.
   *   Pensado para que el coordinator registre messageIds en MessageTracker.
   */
  dispatchToAll(
    buildNotification: (channelType: NotificationChannelType) => Notification,
    onSent?: (notification: Notification, result: SendResult) => void,
  ): void {
    this.dispatch(this.channels, buildNotification, true, onSent);
  }

  /**
   * Igual que `dispatchToAll`, pero dirigido a un subconjunto explícito de
   * canales en vez de `this.channels`, y sin aplicar `channel.supports()`:
   * quien llama ya decidió el destino a propósito (p. ej. el endpoint admin
   * de resumen eligiendo "oficial"/"pruebas"/"todos"), así que el filtro por
   * estrategia de `supports()` no debe volver a excluirlo.
   */
  dispatchTo(
    channels: readonly NotificationChannel[],
    buildNotification: (channelType: NotificationChannelType) => Notification,
    onSent?: (notification: Notification, result: SendResult) => void,
  ): void {
    this.dispatch(channels, buildNotification, false, onSent);
  }

  private dispatch(
    channels: readonly NotificationChannel[],
    buildNotification: (channelType: NotificationChannelType) => Notification,
    applySupportsFilter: boolean,
    onSent?: (notification: Notification, result: SendResult) => void,
  ): void {
    for (const channel of channels) {
      if (!channel.enabled()) {
        continue;
      }

      const notification = buildNotification(channel.getChannelType());

      if (applySupportsFilter && !channel.supports(notification)) {
        continue;
      }

      this.sendAndReport(channel, notification, onSent);
    }
  }

  private sendAndReport(
    channel: NotificationChannel,
    notification: Notification,
    onSent?: (notification: Notification, result: SendResult) => void,
  ): void {
    void channel.send(notification).then(
      (result) => {
        this.domainEventBus.publish(
          result.delivered
            ? new NotificationSentEvent({
                notificationId: notification.notificationId,
                channel: notification.channel,
              })
            : new NotificationFailedEvent({
                notificationId: notification.notificationId,
                channel: notification.channel,
                reason: RETRIES_EXHAUSTED_REASON,
              }),
        );

        if (result.delivered && onSent) {
          onSent(notification, result);
        }
      },
      (error: unknown) => {
        const message = `El canal "${channel.name()}" falló inesperadamente al enviar la notificación ${notification.notificationId}.`;
        this.logger.error(message, error as Error);
        this.errorTracker.recordError(message);
        this.domainEventBus.publish(
          new NotificationFailedEvent({
            notificationId: notification.notificationId,
            channel: notification.channel,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      },
    );
  }
}
