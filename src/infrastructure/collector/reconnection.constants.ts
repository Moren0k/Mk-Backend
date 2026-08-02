/**
 * Política de backoff exponencial para la reconexión del SSE.
 *
 * 1s, 2s, 4s, 8s, 16s, 30s (tope), 30s, ...
 */
export const INITIAL_RECONNECT_DELAY_MS = 1_000;
export const MAX_RECONNECT_DELAY_MS = 30_000;
export const RECONNECT_BACKOFF_FACTOR = 2;
