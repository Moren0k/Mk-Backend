/**
 * Canales de notificación soportados por el sistema.
 *
 * TELEGRAM_PRUEBAS es una instancia adicional de TelegramChannel (mismo bot
 * de Telegram, otro token/chat), no un canal distinto: existe como valor
 * separado para que MessageTracker/NotificationCoordinator puedan identificar
 * a qué instancia concreta pertenece un mensaje ya enviado (necesario para
 * borrar el mensaje correcto en cleanupMessages).
 */
export enum NotificationChannelType {
  TELEGRAM = 'TELEGRAM',
  TELEGRAM_PRUEBAS = 'TELEGRAM_PRUEBAS',
}
