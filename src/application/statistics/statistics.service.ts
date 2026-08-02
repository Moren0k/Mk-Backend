import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { DOMAIN_EVENT_BUS } from '../../core/constants/injection-tokens.constants';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import type { DomainEventHandler } from '../../core/domain-events/base/domain-event-handler.interface';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { Statistics } from '../../core/statistics/statistics.entity';
import { StatisticsSnapshot } from '../../core/statistics/types/statistics-snapshot.type';

/**
 * Escucha únicamente GameReceivedEvent y alimenta a Statistics (core), que
 * mantiene los contadores de forma incremental. Nunca consulta HistoryStore:
 * cada partida llega una única vez, vía evento.
 *
 * A diferencia de StrategyCoordinator, cuenta TODAS las partidas sin
 * importar `isHistorical`: es analítica descriptiva ("¿qué pasó?"), no una
 * decisión accionable, así que el historial inicial debe reflejarse aquí.
 */
@Injectable()
export class StatisticsService implements OnModuleInit, OnModuleDestroy {
  private readonly statistics = new Statistics();

  private readonly gameReceivedHandler: DomainEventHandler<GameReceivedEvent> =
    {
      handle: (event) => this.statistics.recordGame(event.payload.game),
    };

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.domainEventBus.subscribe(
      GameReceivedEvent.eventName,
      this.gameReceivedHandler,
    );
  }

  onModuleDestroy(): void {
    this.domainEventBus.unsubscribe(
      GameReceivedEvent.eventName,
      this.gameReceivedHandler,
    );
  }

  getSnapshot(): StatisticsSnapshot {
    return this.statistics.toSnapshot();
  }
}
