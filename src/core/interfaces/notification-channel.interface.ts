import { NotificationChannelType } from '../enums/notification-channel-type.enum';
import { Notification } from '../notification/notification.type';
import type { SendResult } from '../notification/types/send-result.type';

/**
 * Contrato para cualquier canal de notificación (Telegram, Discord,
 * WhatsApp, email...). El dominio nunca conoce el canal concreto, solo
 * este contrato: agregar un canal nuevo nunca requiere tocar
 * NotificationCoordinator, solo registrar una nueva implementación vía DI.
 */
export interface NotificationChannel {
  /** Qué tipo de canal es. Permite a NotificationFactory construir la
   *  Notification ya dirigida a este canal, sin que el propio canal tenga
   *  que reconocerse a sí mismo con un `if`/`switch`. */
  getChannelType(): NotificationChannelType;
  name(): string;
  enabled(): boolean;
  /** ¿Puede este canal manejar esta Notification en particular? (por
   *  ejemplo, filtrando por severidad en el futuro). */
  supports(notification: Notification): boolean;
  /**
   * @returns SendResult con `delivered: true` y `messageId` si logró
   * entregarla (incluso tras reintentar), `delivered: false` si agotó sus
   * intentos. Nunca rechaza la promesa por un fallo de envío "normal" (solo
   * por un error verdaderamente inesperado).
   */
  send(notification: Notification): Promise<SendResult>;
  /**
   * Elimina un mensaje previamente enviado. Sin reintentos: un solo intento.
   * Si el mensaje ya no existe o el canal rechaza la operación, retorna
   * `false` sin lanzar excepción.
   */
  deleteMessage(messageId: number): Promise<boolean>;
}
