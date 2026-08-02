import { Module } from '@nestjs/common';

import { DomainEventBusModule } from '../../application/domain-events/domain-event-bus.module';
import { HistoryModule } from '../../application/history/history.module';
import { ErrorTrackingModule } from '../../application/observability/error-tracking.module';
import { GAME_HISTORY_CLIENT, SSE_CLIENT } from './collector-tokens';
import { GameEventCollector } from './game-event-collector';
import { GameMapper } from './game.mapper';
import { TipminerGameHistoryClient } from './tipminer-game-history.client';
import { TipminerSseClient } from './tipminer-sse.client';

/**
 * Punto de registro del GameEventCollector (consumo del SSE de BacBo).
 *
 * Único módulo que conoce las implementaciones concretas de Tipminer
 * (TipminerGameHistoryClient, TipminerSseClient): el resto del proyecto
 * solo ve a GameEventCollector arrancar y poblar el HistoryStore.
 */
@Module({
  imports: [HistoryModule, DomainEventBusModule, ErrorTrackingModule],
  providers: [
    GameEventCollector,
    GameMapper,
    {
      provide: GAME_HISTORY_CLIENT,
      useClass: TipminerGameHistoryClient,
    },
    {
      provide: SSE_CLIENT,
      useClass: TipminerSseClient,
    },
  ],
  exports: [GameEventCollector],
})
export class CollectorModule {}
