/**
 * Resultado de NotificationChannel.send(). Extiende el booleano original
 * con el messageId necesario para operaciones de borrado posteriores.
 */
export type SendResult = {
  readonly delivered: boolean;
  readonly messageId?: number;
};
