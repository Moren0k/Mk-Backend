/**
 * Política de reintentos simple para el envío a Telegram: 3 intentos con
 * una espera fija entre cada uno, y luego se abandona (se registra el
 * error y se descarta la notificación, sin bloquear el resto del sistema).
 */
export const MAX_SEND_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 1_000;
