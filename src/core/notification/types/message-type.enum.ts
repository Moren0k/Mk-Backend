/**
 * Tipos de notificación que emite NotificationFactory.
 * Usado por MessageTracker para distinguir qué mensajes deben borrarse
 * (MG1, MG2, TIE) de los que deben conservarse (ENTRY, WON, LOST).
 */
export enum MessageType {
  ENTRY = 'ENTRY',
  MG1 = 'MG1',
  MG2 = 'MG2',
  TIE = 'TIE',
  WON = 'WON',
  LOST = 'LOST',
}
