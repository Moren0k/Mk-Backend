import { SummaryMetricsSnapshot } from './summary-metrics-snapshot.type';

/**
 * Resultado de un resumen bajo demanda (comando RESUMEN): siempre incluye
 * ambos grupos calculados por separado, independientemente de a qué
 * chat(s) se haya despachado el mensaje — para que la respuesta HTTP sea
 * consistente y se pueda inspeccionar cualquiera de los dos grupos aunque
 * el `channel` pedido haya sido solo uno de ellos.
 */
export type SummaryReportResult = {
  readonly oficial: SummaryMetricsSnapshot;
  readonly pruebas: SummaryMetricsSnapshot;
};
