import { Logger } from '@nestjs/common';

import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { NotificationFailedEvent } from '../../core/domain-events/notification/notification-failed.event';
import { NotificationSentEvent } from '../../core/domain-events/notification/notification-sent.event';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { Notification } from '../../core/notification/notification.type';
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
   */
  dispatchToAll(
    buildNotification: (channelType: NotificationChannelType) => Notification,
  ): void {
    for (const channel of this.channels) {
      if (!channel.enabled()) {
        continue;
      }

      const notification = buildNotification(channel.getChannelType());

      if (!channel.supports(notification)) {
        continue;
      }

      this.sendAndReport(channel, notification);
    }
  }

  private sendAndReport(
    channel: NotificationChannel,
    notification: Notification,
  ): void {
    void channel.send(notification).then(
      (delivered) => {
        this.domainEventBus.publish(
          delivered
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
