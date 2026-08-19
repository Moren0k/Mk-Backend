/**
 * Contrato público de `GET /api/v1/reports/summary`: la misma foto que
 * calcula el comando admin RESUMEN (`SummaryReportService.getSnapshot()`),
 * pero de solo lectura — pensada para que el dashboard del frontend la
 * sondee con la frecuencia que quiera sin disparar un mensaje de Telegram
 * en cada llamada (a diferencia de `POST /admin/reports`).
 *
 * Expone EXCLUSIVAMENTE el contexto oficial (Mk-Api.md, requisito de
 * independencia PRUEBAS/OFICIAL): la API propia que consume el frontend
 * nunca debe representar el contexto de pruebas, ni siquiera como un valor
 * en cero — el contrato en sí no le da espacio. Quien necesite el resumen
 * de pruebas debe pedirlo explícitamente por Telegram
 * (`POST /api/v1/admin/reports?channel=pruebas`), nunca por esta API.
 */
export type ReportsChannelSummaryVm = {
  readonly won: number;
  readonly lost: number;
  readonly alertsSent: number;
};

export type ReportsSummaryVm = {
  readonly uptimeMs: number;
  readonly oficial: ReportsChannelSummaryVm;
};
