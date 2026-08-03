/**
 * Factory de configuración para @nestjs/config.
 *
 * Centraliza la lectura de `process.env` en un único lugar: el resto de la
 * aplicación nunca debe leer `process.env` directamente, solo `ConfigService`.
 */
export default () => ({
  app: {
    port: parseInt(process.env.PORT ?? '3000', 10),
  },
  admin: {
    // Sin default: si no está definida, el endpoint admin falla cerrado
    // (siempre Unauthorized) en vez de aceptar una contraseña predecible.
    password: process.env.ADMIN_PASSWORD,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  tipminer: {
    baseUrl:
      process.env.TIPMINER_BASE_URL ?? 'https://api.core.public.tipminer.com',
    providerId:
      process.env.TIPMINER_PROVIDER_ID ??
      'cc71e81d-8b56-4868-91c7-7224be543dce',
    timezone: process.env.TIPMINER_TIMEZONE ?? 'America/Sao_Paulo',
    // Reservado para cuando la API requiera autenticación (ver API.MD: hoy es pública).
    apiKey: process.env.TIPMINER_API_KEY,
  },
});
