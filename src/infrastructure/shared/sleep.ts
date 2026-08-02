/**
 * Espera `ms` milisegundos sin bloquear el event loop.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
