import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { ApiModule } from './api/api.module';
import { AppConfigModule } from './infrastructure/config/app-config.module';
import { HistoryModule } from './application/history/history.module';
import { StrategyModule } from './application/strategy/strategy.module';
import { OperationModule } from './application/operation/operation.module';
import { NotificationModule } from './application/notification/notification.module';
import { StatisticsModule } from './application/statistics/statistics.module';
import { ObservabilityModule } from './application/observability/observability.module';
import { ReportingModule } from './application/reporting/reporting.module';
import { AnalyticsModule } from './application/analytics/analytics.module';
import { Racha3TestModule } from './application/racha3-test/racha3-test.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';

/**
 * Composition root: aquí se conectan infrastructure y application.
 * Ni core ni application conocen esta clase.
 *
 * El orden de `imports` ya NO afecta la corrección del motor (a
 * diferencia de las etapas 6 y 7). Se comprobó empíricamente en la
 * Etapa 8 que el orden en que NestJS llama a los `onModuleInit` de
 * distintos módulos no es una garantía confiable: StatisticsModule podía
 * quedar suscrito después de que GameEventCollector ya hubiera publicado
 * la carga inicial, incluso respetando el orden "correcto" en este
 * arreglo.
 *
 * Por eso GameEventCollector ya no arranca solo (no implementa
 * OnModuleInit): expone `start()`, y es `main.ts` quien lo invoca
 * explícitamente después de `app.listen()`, momento en el que NestJS sí
 * garantiza que absolutamente todos los `onModuleInit` de la aplicación
 * (Strategy, Operation, Notification, Statistics, EngineMetrics) ya
 * terminaron. Ver GameEventCollector y main.ts.
 *
 * De la misma forma, cada Operation recuerda el uuid de la partida que la
 * disparó (`triggerGameId`, ver operation.entity.ts) e ignora esa partida
 * si le llega como actualización, sin importar qué subscriber del bus
 * corra primero. El resultado: ninguna garantía de corrección de este
 * proyecto depende del orden de inicialización de NestJS.
 */
@Module({
  imports: [
    AppConfigModule,
    // Rate limiting global por IP (ver configuration.ts `rateLimit`).
    // Aplicado como APP_GUARD (a diferencia de ApiKeyGuard/interceptor de
    // envelope en ApiModule): frenar abuso es una preocupación transversal
    // a toda la app, no específica de la capa `api/`, así que no hay
    // conflicto de contrato en aplicarlo globalmente.
    // GET /api/v1/events/stream está exento vía @SkipThrottle() (conexión
    // SSE larga, no peticiones repetidas).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.get<number>('rateLimit.ttlMs', 60000),
          limit: configService.get<number>('rateLimit.limit', 300),
        },
      ],
    }),
    HistoryModule,
    OperationModule,
    StrategyModule,
    NotificationModule,
    StatisticsModule,
    ObservabilityModule,
    ReportingModule,
    // Analytics histórico de Racha 3. Deliberadamente desacoplado del motor
    // de alertas: no se suscribe al DomainEventBus, no conoce Strategy,
    // Operation ni Notification, y su único punto de contacto con el resto
    // del sistema es la conexión a Postgres. Si falla o queda deshabilitado,
    // la detección de rachas y el envío de alertas no se ven afectados.
    AnalyticsModule,
    // Estrategia EXPERIMENTAL "Racha 3 Test" (ver RACHA3-TEST.md). Arranca
    // apagada (RACHA3_TEST_ENABLED). No se registra en el token STRATEGIES,
    // así que OperationCoordinator nunca ve una señal suya y nunca crea una
    // operación real; sus mensajes van a un canal de Telegram propio que
    // está fuera de NOTIFICATION_CHANNELS. La estrategia `streak-3` de
    // producción no se ve afectada de ninguna forma.
    Racha3TestModule,
    PersistenceModule,
    ApiModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
