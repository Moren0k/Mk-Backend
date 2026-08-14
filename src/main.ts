import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';

import { AppModule } from './app.module';
import { EngineHealth } from './application/observability/engine-health';
import { StatisticsService } from './application/statistics/statistics.service';
import { GameEventCollector } from './infrastructure/collector/game-event-collector';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 3000);

  // Prefijo fijo de toda la API propia (Mk-Api.md §17): `setGlobalPrefix`
  // afecta a TODOS los controllers de Nest. El único endpoint administrativo
  // hoy es `POST /api/v1/admin/reports` (dentro de `api/`, F7 completo — el
  // legado `POST /admin/commands` con contraseña se retiró). `/healthz` (más
  // abajo) se registra directo en el adapter de Fastify, así que nunca pasa
  // por `setGlobalPrefix` en absoluto.
  app.setGlobalPrefix('api/v1');

  // CORS: allowlist explícita vía CORS_ALLOWED_ORIGINS (coma-separado, ver
  // configuration.ts). Sin esa variable definida, cae a `origin: true`
  // (refleja el header `Origin` de cada request, no es `"*"` literal) para
  // no romper el flujo de desarrollo local antes de tener un dominio fijo
  // — pero en cuanto se define la variable en el entorno de despliegue,
  // solo esos orígenes pueden llamar a la API.
  const allowedOrigins = configService.get<string[]>('cors.allowedOrigins', []);

  if (allowedOrigins.length === 0) {
    logger.warn(
      'CORS_ALLOWED_ORIGINS no está definida: aceptando peticiones de ' +
        'cualquier origen (origin: true). Definir esta variable antes de ' +
        'exponer la API a Internet.',
    );
  }

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Api-Key', 'X-Request-Id'],
  });

  // Helmet (@fastify/helmet): headers de seguridad estándar (X-Content-Type-
  // Options, X-Frame-Options, Strict-Transport-Security, etc.). API pura
  // JSON/SSE, sin HTML servido desde acá, así que la CSP por defecto no
  // tiene efecto práctico pero tampoco estorba.
  await app.register(helmet);

  // Rate limiting: ver ThrottlerModule en app.module.ts (global vía
  // APP_GUARD). GET /api/v1/events/stream (SSE) está exento (@SkipThrottle
  // en EventsController): es una única conexión larga, no peticiones
  // repetidas, y contarla penalizaría reconexiones legítimas.

  // Shutdown hooks: ante SIGTERM/SIGINT (p. ej. Ctrl+C) NestJS ejecuta los
  // OnModuleDestroy y GameEventCollector cierra el SSE limpio.
  app.enableShutdownHooks();

  // Health check sin estado: útil para health-checks de plataforma y
  // monitoreo externo. No toca la lógica del motor. Coexiste con
  // GET /api/v1/health (Mk-Api.md Anexo D §7): este es el legado, crudo y
  // sin envelope; el otro es el contrato estable para el frontend.
  const health = app.get(EngineHealth);
  app.getHttpAdapter().get('/healthz', () => ({
    status: 'ok',
    ...health.getSnapshot(),
  }));

  // `app.listen()` garantiza que TODOS los `onModuleInit` de la aplicación
  // ya corrieron (Strategy, Operation, Notification, Statistics,
  // EngineMetrics ya están suscritos al DomainEventBus). Solo después de
  // eso arrancamos el collector explícitamente: así la carga inicial de
  // partidas nunca puede perderse, sin depender del orden de `imports`.
  await app.listen(port, '0.0.0.0');
  await app.get(GameEventCollector).start();

  logStartupSnapshot(app);
}

function logStartupSnapshot(app: NestFastifyApplication): void {
  const logger = new Logger('Bootstrap');
  const health = app.get(EngineHealth).getSnapshot();
  const statistics = app.get(StatisticsService).getSnapshot();

  logger.log(
    `Motor iniciado. Partidas en memoria: ${health.gamesInMemory}. ` +
      `Estrategias registradas: ${health.registeredStrategies}. ` +
      `Canales de notificación registrados: ${health.registeredChannels}. ` +
      `Estadísticas acumuladas: ${statistics.totalGames} partidas ` +
      `(racha actual: ${statistics.currentStreak.length} ${statistics.currentStreak.winner ?? 'N/A'}).`,
  );
}

bootstrap().catch((error: unknown) => handleBootstrapError(error));

/**
 * Sin esto, un puerto ocupado (el caso más común en desarrollo: un proceso
 * anterior que no llegó a cerrarse) se ve como un stack trace crudo de
 * Node. Un mensaje explícito ahorra el "¿por qué no arranca?" tanto en
 * local como leyendo logs de cualquier plataforma de despliegue.
 */
function handleBootstrapError(error: unknown): void {
  const logger = new Logger('Bootstrap');

  if (isAddressInUseError(error)) {
    logger.error(
      `El puerto ya está en uso. Verifica que no haya otra instancia de la ` +
        `aplicación corriendo (por ejemplo, un proceso anterior que no se ` +
        `cerró del todo) o define PORT con un valor libre.`,
    );
  } else {
    logger.error('Error fatal al iniciar la aplicación.', error as Error);
  }

  process.exit(1);
}

function isAddressInUseError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EADDRINUSE'
  );
}
