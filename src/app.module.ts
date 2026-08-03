import { Module } from '@nestjs/common';

import { AppConfigModule } from './infrastructure/config/app-config.module';
import { AdminModule } from './application/admin/admin.module';
import { HistoryModule } from './application/history/history.module';
import { StrategyModule } from './application/strategy/strategy.module';
import { OperationModule } from './application/operation/operation.module';
import { NotificationModule } from './application/notification/notification.module';
import { StatisticsModule } from './application/statistics/statistics.module';
import { ObservabilityModule } from './application/observability/observability.module';
import { ReportingModule } from './application/reporting/reporting.module';

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
    HistoryModule,
    OperationModule,
    StrategyModule,
    NotificationModule,
    StatisticsModule,
    ObservabilityModule,
    ReportingModule,
    AdminModule,
  ],
})
export class AppModule {}
