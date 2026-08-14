/**
 * Contrato público de `GET /api/v1/reports/summary`: la misma foto que
 * calcula el comando admin RESUMEN (`SummaryReportService.getSnapshot()`),
 * pero de solo lectura — pensada para que el dashboard del frontend la
 * sondee con la frecuencia que quiera sin disparar un mensaje de Telegram
 * en cada llamada (a diferencia de `POST /admin/reports`).
 *
 * `uptimeMs` es el mismo para `oficial` y `pruebas` (se calcula una sola
 * vez por snapshot), así que se expone una única vez a nivel raíz.
 */
export type ReportsChannelSummaryVm = {
  readonly won: number;
  readonly lost: number;
  readonly alertsSent: number;
};

export type ReportsSummaryVm = {
  readonly uptimeMs: number;
  readonly oficial: ReportsChannelSummaryVm;
  readonly pruebas: ReportsChannelSummaryVm;
};
