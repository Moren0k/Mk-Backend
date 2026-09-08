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
  /**
   * Canal dedicado al DEBUG de la estrategia experimental Racha 3 Test.
   * Tercera instancia de TelegramChannel, deliberadamente FUERA del token
   * NOTIFICATION_CHANNELS: si estuviera ahí, NotificationCoordinator le
   * enviaría también las alertas reales de producción (ver
   * `application/racha3-test/racha3-test.module.ts`).
   */
  TELEGRAM_RACHA3_TEST = 'TELEGRAM_RACHA3_TEST',
}
