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

  // Shutdown hooks: en SIGTERM/SIGINT (p. ej. un redeploy o un `docker stop`,
  // sin importar el orquestador) NestJS ejecuta los OnModuleDestroy y
  // GameEventCollector cierra el SSE limpio.
  app.enableShutdownHooks();

  // Health check sin estado: útil para health-checks de plataforma y
  // monitoreo externo. No toca la lógica del motor.
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
