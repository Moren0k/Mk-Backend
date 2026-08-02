/**
 * Estado interno de la conexión del GameEventCollector con el SSE.
 *
 * Es un detalle puramente operativo del collector (no un concepto de
 * dominio), pensado para exponer métricas/health-checks en el futuro.
 */
export enum CollectorStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
}
