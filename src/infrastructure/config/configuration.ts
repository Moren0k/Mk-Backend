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
  auth: {
    // Contraseña única del login del panel frontend (AccessGate,
    // POST /api/v1/auth/login, ver auth.controller.ts). Nunca viaja
    // incrustada en el JS del frontend: se compara acá y, si acierta, se
    // devuelve `api.key` (arriba) recién en ese momento. Sin definir, el
    // endpoint falla cerrado (nunca acepta ninguna contraseña).
    accessPassword: process.env.ACCESS_PASSWORD,
  },
  cors: {
    // Lista blanca de orígenes permitidos, separados por coma (p. ej.
    // "https://mi-frontend.com,https://staging.mi-frontend.com"). Sin
    // definir, `main.ts` cae a `origin: true` (cualquier origen) para no
    // romper el flujo de desarrollo local antes de tener un dominio fijo.
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  },
  rateLimit: {
    // Ventana y tope por IP para el ThrottlerGuard global (AppModule).
    // Defaults generosos: el frontend legítimo hace sondeo (polling) de
    // GET /api/v1/reports/summary en un intervalo propio, más algunos GETs
    // puntuales al cargar cada página — 300 req/min por IP da margen de
    // sobra sin dejar de frenar un abuso real (script en loop apretado).
    ttlMs: parseInt(process.env.RATE_LIMIT_TTL_MS ?? '60000', 10),
    limit: parseInt(process.env.RATE_LIMIT_LIMIT ?? '300', 10),
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
