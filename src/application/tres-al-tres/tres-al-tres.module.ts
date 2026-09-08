import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module';
import { DomainEventBusModule } from '../domain-events/domain-event-bus.module';
import { HistoryModule } from '../history/history.module';
import { OperationModule } from '../operation/operation.module';
import { StrategyChannelRegistryModule } from '../strategy/strategy-channel-registry.module';
import { StrategyModule } from '../strategy/strategy.module';
import { TresAlTresCoordinator } from './tres-al-tres.coordinator';
import { TresAlTresEvidenceProvider } from './tres-al-tres.evidence-provider';

/**
 * Estrategia 3al3.
 *
 * Importa `StrategyModule` por tres cosas, todas ya existentes: el token
 * `STRATEGIES` (para localizar la instancia real de `Streak3Strategy` con la
 * que detecta), `STRATEGY_EXECUTION_GUARD` (el guard real de operaciones
 * activas) y `StrategyChannelRegistry` (asignación de canal y
 * `maxMartingales`, ambos administrados por `PATCH /api/v1/channels/:channel`).
 *
 * No registra ningún canal de notificación propio, a propósito: cuando 3al3
 * decide TOMAR publica `StrategyTriggeredEvent` y la alerta sale por el
 * pipeline de producción con el formato de siempre. La estrategia no tiene
 * mensajes propios ni chat propio.
 *
 * `TresAlTresStrategy` (la identidad que aparece en
 * `GET /api/v1/strategies`) se registra en `StrategyModule` junto al resto,
 * no acá: es una `Strategy` como las demás desde el punto de vista del
 * catálogo.
 *
 * Sin variables de entorno: el único interruptor es asignarla a un canal
 * activo con `PATCH /api/v1/channels/:channel`, igual que el resto de las
 * estrategias. Sin asignar no emite; asignada, emite.
 */
@Module({
  imports: [
    DomainEventBusModule,
    HistoryModule,
    // Token STRATEGIES: para localizar la instancia real de Streak3Strategy.
    StrategyModule,
    // STRATEGY_EXECUTION_GUARD: el guard real de operaciones activas.
    OperationModule,
    // StrategyChannelRegistry: asignacion de canal y maxMartingales.
    StrategyChannelRegistryModule,
    AnalyticsModule,
  ],
  providers: [TresAlTresEvidenceProvider, TresAlTresCoordinator],
  exports: [TresAlTresCoordinator],
})
export class TresAlTresModule {}
