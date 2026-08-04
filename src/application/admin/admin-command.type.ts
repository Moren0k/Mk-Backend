/** Comandos administrativos soportados hoy. Solo RESUMEN existe por ahora. */
export const AdminCommand = {
  RESUMEN: 'RESUMEN',
} as const;

/**
 * Destino de las notificaciones que dispara el comando RESUMEN. Default
 * "todos" si el cliente no lo especifica (ver AdminController).
 */
export const AdminNotificationChannel = {
  OFICIAL: 'oficial',
  PRUEBAS: 'pruebas',
  TODOS: 'todos',
} as const;

export type AdminNotificationChannel =
  (typeof AdminNotificationChannel)[keyof typeof AdminNotificationChannel];

export type AdminCommandRequest = {
  readonly password?: string;
  readonly command?: string;
  readonly channel?: string;
};
