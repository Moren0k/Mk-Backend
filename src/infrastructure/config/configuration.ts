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
  api: {
    // Secreto compartido de src/api/ (X-Api-Key, Anexo D §5 de Mk-Api.md):
    // sin JWT ni roles, un único cliente de confianza (el frontend propio).
    // Sin default: sin definir, ApiKeyGuard falla cerrado (nunca acepta
    // nada) en vez de aceptar un secreto predecible.
    key: process.env.API_KEY,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    // Bot/chat separado usado exclusivamente por las estrategias marcadas
    // como "solo pruebas" en strategy-group.ts (hoy, ninguna estrategia
    // registrada cae en ese grupo): nunca reciben nada del canal oficial
    // ni viceversa.
    pruebas: {
      botToken: process.env.TELEGRAM_PRUEBAS_BOT_TOKEN,
      chatId: process.env.TELEGRAM_PRUEBAS_CHAT_ID,
      // Interruptor de modo pruebas: en "false" el canal de pruebas no
      // envía absolutamente nada (ni alertas en vivo ni el resumen
      // manual/horario), sin afectar la evaluación interna de las
      // estrategias. Default true (habilitado) si no está definida, para
      // no romper el comportamiento actual en despliegues existentes.
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
    // Reservado para cuando la API requiera autenticación (ver API.md: hoy es pública).
    apiKey: process.env.TIPMINER_API_KEY,
  },
  database: {
    // Sin defaults: mientras no estén definidas, PrismaService arranca
    // deshabilitado (ver src/infrastructure/persistence/) sin afectar al
    // resto del motor.
    url: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
  },
});
