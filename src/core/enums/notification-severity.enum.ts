/**
 * Severidad de una Notification. Telegram hoy no hace ninguna diferencia
 * visual entre ellas, pero queda preparado para canales futuros que sí
 * puedan (colores, iconos, prioridad de entrega, etc.).
 */
export enum NotificationSeverity {
  INFO = 'INFO',
  SUCCESS = 'SUCCESS',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}
