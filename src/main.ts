import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { EngineHealth } from './application/observability/engine-health';
import { StatisticsService } from './application/statistics/statistics.service';
import { GameEventCollector } from './infrastructure/collector/game-event-collector';

async function bootstrap(): Promise<void> {
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

  // CORS: abierto a propósito mientras el proyecto está en desarrollo y
  // todavía no hay un dominio de frontend fijo que poner en una allowlist
  // (decisión explícita del dueño del sistema, revierte Mk-Api.md Anexo D
  // §6). `origin: true` refleja el header `Origin` de cada request — no es
  // `"*"` literal, así que sigue funcionando si en algún momento se agregan
  // credenciales/cookies, pero equivale a "cualquier origen puede llamar a
  // la API". **Antes de producción, reemplazar por una allowlist explícita
  // de dominios.**
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Api-Key', 'X-Request-Id'],
  });

  // Rate limiting: diferido a cuando existan recursos reales que proteger
  // más allá de /health (F4, Mk-Api.md §20) — hoy no hay superficie que
  // abusar.

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
