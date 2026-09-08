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
  /**
   * `won - lost * 7`: progresión de martingala 1+2+4 — una pérdida cuesta
   * las 7 unidades de la progresión completa, una victoria siempre deja 1
   * unidad neta.
   *
   * ATENCIÓN: **SOBREESTIMA**, y no por poco. No descuenta el peaje de los
   * empates. Un empate no cierra la operación y no consume gale, pero la
   * mesa devuelve el 90 % de lo apostado, así que cuesta el 10 % del
   * importe del nivel donde cae — y el importe se duplica en cada nivel.
   * Medido sobre el histórico de Analytics: 0,0386 unidades por operación,
   * lo que sobre 4.218 operaciones convierte un `netUnits` reportado de
   * +162 en **−0,9 reales**.
   *
   * Corregirlo exige que `Operation` cuente los empates POR NIVEL (hoy solo
   * reporta `tieOccurred` por jugada, sin recordar dónde ocurrió),
   * propagarlo por `OperationSnapshot` y `OperationClosedRecord`, y añadir
   * la columna correspondiente a `report_checkpoints` para que el acumulado
   * sobreviva a un reinicio. Queda como trabajo separado; el cálculo de
   * referencia está en `core/tres-al-tres/equilibrio.ts` y las funciones SQL
   * que lo miden en `racha3_ties_por_nivel()` (ver ANALYTICS.md).
   */
  readonly netUnits: number;
};

export type ReportsSummaryVm = {
  readonly uptimeMs: number;
  readonly oficial: ReportsChannelSummaryVm;
};
