import { Module } from '@nestjs/common';

import { AdminModule } from './resources/admin/admin.module';
import { AuthModule } from './resources/auth/auth.module';
import { ChannelsModule } from './resources/channels/channels.module';
import { EventsModule } from './resources/events/events.module';
import { HealthModule } from './resources/health/health.module';
import { HistoryModule } from './resources/history/history.module';
import { OperationsModule } from './resources/operations/operations.module';
import { ReportsModule } from './resources/reports/reports.module';
import { StatisticsModule } from './resources/statistics/statistics.module';
import { StrategiesModule } from './resources/strategies/strategies.module';

/**
 * Composition root de la capa de presentación (Mk-Api.md §3/§5): nunca
 * importa nada de `src/infrastructure/` (regla verificada en CI, ver
 * `eslint.config.mjs`). Solo `AppModule` la conoce.
 *
 * El envelope de éxito/error y `ApiKeyGuard` NO se registran aquí como
 * `APP_FILTER`/`APP_INTERCEPTOR`/`APP_GUARD`: esos tokens son globales a
 * toda la app Nest (afectarían también a `AdminController`, ajeno a
 * `api/`, con su propia autenticación). Cada controller de `resources/`
 * los aplica vía `@ApiResource()` en su lugar (ver
 * `common/decorators/api-resource.decorator.ts`) — salvo `EventsModule`
 * (SSE), que compone el filtro/guard manualmente sin el interceptor de
 * envelope (ver `events.controller.ts`).
 *
 * Con esto queda completo el roadmap F1-F5 de Mk-Api.md §20 (F6 sigue
 * fuera de alcance, Anexo D §1).
 */
@Module({
  imports: [
    HealthModule,
    StatisticsModule,
    HistoryModule,
    OperationsModule,
    AdminModule,
    AuthModule,
    ChannelsModule,
    EventsModule,
    ReportsModule,
    StrategiesModule,
  ],
})
export class ApiModule {}
