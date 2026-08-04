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
    // Bot/chat separado usado exclusivamente por estrategias de prueba
    // (ver Streak4Strategy y NotificationModule): nunca reciben nada del
    // canal oficial ni viceversa.
    pruebas: {
      botToken: process.env.TELEGRAM_PRUEBAS_BOT_TOKEN,
      chatId: process.env.TELEGRAM_PRUEBAS_CHAT_ID,
      // Interruptor de modo pruebas: en "false" el canal de pruebas no
      // envía absolutamente nada (ni alertas en vivo de streak-4 ni el
      // resumen manual/horario), sin afectar la evaluación interna de la
      // estrategia. Default true (habilitado) si no está definida, para no
      // romper el comportamiento actual en despliegues existentes.
      enabled: process.env.TELEGRAM_PRUEBAS_ENABLED !== 'false',
    },
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
