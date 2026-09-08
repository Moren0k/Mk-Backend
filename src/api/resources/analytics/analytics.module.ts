import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../../../application/analytics/analytics.module';
import { Racha3AnalyticsController } from './racha3-analytics.controller';

/**
 * Recurso `analytics/racha3` de la capa de presentación.
 *
 * Importa el módulo de aplicación, nunca infrastructure/ (regla verificada
 * en CI, ver `eslint.config.mjs`): el controller solo conoce
 * `Racha3AnalyticsReadModel`, y quién resuelve las consultas contra
 * PostgreSQL queda del otro lado de esa frontera.
 */
@Module({
  imports: [AnalyticsModule],
  controllers: [Racha3AnalyticsController],
})
export class Racha3AnalyticsApiModule {}
