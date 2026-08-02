import { NotificationChannelType } from '../../enums/notification-channel-type.enum';
import { AbstractDomainEvent } from '../base/domain-event';

export type NotificationFailedPayload = {
  readonly notificationId: string;
  readonly channel: NotificationChannelType;
  readonly reason: string;
};

/**
 * Se publica cuando un NotificationChannel agota sus reintentos (o lanza
 * una excepción inesperada) sin lograr entregar una Notification.
 */
export class NotificationFailedEvent extends AbstractDomainEvent<NotificationFailedPayload> {
  static readonly eventName = 'NotificationFailedEvent';

  constructor(payload: NotificationFailedPayload) {
    super(NotificationFailedEvent.eventName, 1, payload);
  }
}
