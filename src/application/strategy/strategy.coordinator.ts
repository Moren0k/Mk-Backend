import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import {
  DOMAIN_EVENT_BUS,
  HISTORY_STORE,
  STRATEGIES,
  STRATEGY_EXECUTION_GUARD,
} from '../../core/constants/injection-tokens.constants';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import type { DomainEventHandler } from '../../core/domain-events/base/domain-event-handler.interface';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { StrategyTriggeredEvent } from '../../core/domain-events/strategy/strategy-triggered.event';
import type { HistoryStore } from '../../core/interfaces/history-store.interface';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import type { StrategyExecutionGuard } from '../../core/strategy/interfaces/strategy-execution-guard.interface';
import type { Strategy } from '../../core/strategy/interfaces/strategy.interface';
import {
  createStrategyContext,
  StrategyContext,
} from '../../core/strategy/types/strategy-context.type';
import { InMemoryStrategyRuntimeState } from './in-memory-strategy-runtime-state';
import { StrategyChannelRegistry } from './strategy-channel-registry';

/**
 * Subscriber de GameReceivedEvent: por cada jugada nueva EN VIVO, arma un
 * StrategyContext, ejecuta todas las estrategias registradas y publica un
 * StrategyTriggeredEvent por cada una que detecte una oportunidad.
 *
 * Las partidas con `isHistorical: true` (la carga inicial del collector)
 * nunca se evalúan: una racha que ya ocurrió y se resolvió horas atrás no
 * es una oportunidad de apuesta accionable ahora. El historial sigue
 * sirviendo de contexto (HistorySnapshot) para evaluar las partidas en
 * vivo, solo que no dispara señales por sí mismo.
 *
 * No conoce ninguna estrategia concreta (nunca `instanceof`/`switch`) ni
 * ningún subscriber de StrategyTriggeredEvent: solo publica y sigue.
 *
 * **Gate de encendido/apagado (2026-08-11, a pedido explícito):** una
 * estrategia solo se evalúa si `StrategyChannelRegistry.isActiveFor(id)`
 * es `true` — es decir, está asignada a un canal y ese canal está activo,
 * ambos configurados vía `PATCH /api/v1/channels/:channel`. Por default
 * ninguna estrategia está asignada a ningún canal, así que el motor no
 * genera señales hasta que se configure explícitamente. `strategy.enabled()`
 * ya no es una fuente de verdad de negocio (queda como interruptor de
 * código, hoy siempre `true` en las tres estrategias registradas); el
 * único "encendido" real es el registro mutable, nunca una constante.
 */
@Injectable()
export class StrategyCoordinator
  implements
    DomainEventHandler<GameReceivedEvent>,
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger = new Logger(StrategyCoordinator.name);

  constructor(
    @Inject(HISTORY_STORE) private readonly historyStore: HistoryStore,
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
    @Inject(STRATEGIES) private readonly strategies: readonly Strategy[],
    private readonly errorTracker: EngineErrorTracker,
    @Inject(STRATEGY_EXECUTION_GUARD)
    private readonly executionGuard: StrategyExecutionGuard,
    private readonly runtimeState: InMemoryStrategyRuntimeState,
    private readonly configProvider: StrategyChannelRegistry,
  ) {}

  onModuleInit(): void {
    this.domainEventBus.subscribe(GameReceivedEvent.eventName, this);
  }

  onModuleDestroy(): void {
    this.domainEventBus.unsubscribe(GameReceivedEvent.eventName, this);
  }

  handle(event: GameReceivedEvent): void {
    if (event.payload.isHistorical) {
      return;
    }

    const context = createStrategyContext(
      event.payload.game,
      this.historyStore.createSnapshot(),
      this.executionGuard,
      this.runtimeState,
      this.configProvider,
      new Date(),
    );

    for (const strategy of this.strategies) {
      this.evaluateStrategy(strategy, context);
    }
  }

  private evaluateStrategy(strategy: Strategy, context: StrategyContext): void {
    if (!strategy.enabled()) {
      return;
    }

    if (!this.configProvider.isActiveFor(strategy.id)) {
      return;
    }

    try {
      const result = strategy.evaluate(context);

      if (result.triggered) {
        // Garantizado no-undefined por el chequeo isActiveFor() de arriba:
        // una estrategia solo llega aquí si está asignada a un canal. El
        // fallback es puramente defensivo, nunca una fuente real de verdad.
        const strategyContext =
          this.configProvider.getChannelFor(strategy.id) ?? 'oficial';

        this.domainEventBus.publish(
          new StrategyTriggeredEvent({ ...result, context: strategyContext }),
        );
      }
    } catch (error) {
      const message = `La estrategia "${strategy.name}" falló al evaluar.`;
      this.logger.error(message, error as Error);
      this.errorTracker.recordError(message);
    }
  }
}
