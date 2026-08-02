import { NotificationChannelType } from '../../enums/notification-channel-type.enum';
import { AbstractDomainEvent } from '../base/domain-event';

export type NotificationSentPayload = {
  readonly notificationId: string;
  readonly channel: NotificationChannelType;
};

/**
 * Se publica cuando un NotificationChannel confirma que entregó una
 * Notification. Es lo único que le permite a EngineMetrics contar
 * "notificaciones enviadas" sin consultar directamente a
 * NotificationCoordinator ni a ningún canal.
 */
export class NotificationSentEvent extends AbstractDomainEvent<NotificationSentPayload> {
  static readonly eventName = 'NotificationSentEvent';

  constructor(payload: NotificationSentPayload) {
    super(NotificationSentEvent.eventName, 1, payload);
  }
}
