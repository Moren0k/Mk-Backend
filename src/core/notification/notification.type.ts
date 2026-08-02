import { randomUUID } from 'node:crypto';

import { NotificationChannelType } from '../enums/notification-channel-type.enum';
import { NotificationSeverity } from '../enums/notification-severity.enum';

/**
 * Entidad de dominio, independiente de cualquier canal concreto. Un
 * TelegramChannel (o cualquier canal futuro) solo la lee, nunca la
 * construye: eso es responsabilidad exclusiva de NotificationFactory.
 */
export type Notification = {
  readonly notificationId: string;
  readonly title: string;
  readonly message: string;
  readonly createdAt: Date;
  readonly severity: NotificationSeverity;
  readonly channel: NotificationChannelType;
  readonly metadata: Readonly<Record<string, unknown>>;
};

export type CreateNotificationParams = {
  readonly title: string;
  readonly message: string;
  readonly severity: NotificationSeverity;
  readonly channel: NotificationChannelType;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/**
 * Único punto de creación de una Notification: siempre congelada, con
 * notificationId/createdAt generados aquí, para no duplicar esa lógica en
 * cada método de NotificationFactory.
 */
export function createNotification(
  params: CreateNotificationParams,
): Notification {
  return Object.freeze({
    notificationId: randomUUID(),
    title: params.title,
    message: params.message,
    createdAt: new Date(),
    severity: params.severity,
    channel: params.channel,
    metadata: Object.freeze({ ...(params.metadata ?? {}) }),
  });
}
