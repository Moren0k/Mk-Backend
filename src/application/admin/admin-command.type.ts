/**
 * Destino de las notificaciones que dispara `POST /api/v1/admin/reports`
 * (comando RESUMEN). Default "todos" si el cliente no lo especifica (ver
 * `api/resources/admin/admin.controller.ts`).
 */
export const AdminNotificationChannel = {
  OFICIAL: 'oficial',
  PRUEBAS: 'pruebas',
  TODOS: 'todos',
} as const;

export type AdminNotificationChannel =
  (typeof AdminNotificationChannel)[keyof typeof AdminNotificationChannel];
