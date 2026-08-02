import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import {
  DOMAIN_EVENT_BUS,
  HISTORY_STORE,
} from '../../core/constants/injection-tokens.constants';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { Game } from '../../core/history/game.type';
import type { HistoryStore } from '../../core/interfaces/history-store.interface';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { CollectorStatus } from './collector-status.enum';
import { GAME_HISTORY_CLIENT, SSE_CLIENT } from './collector-tokens';
import type { GameHistoryClient } from './game-history-client.interface';
import { GameDto } from './game.dto';
import { GameMapper } from './game.mapper';
import {
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  RECONNECT_BACKOFF_FACTOR,
} from './reconnection.constants';
import type { SseClient } from './sse-client.interface';

/**
 * Único componente que consume la API del juego BacBo.
 *
 * Flujo: carga el historial inicial (últimas MAX_HISTORY_SIZE partidas) en
 * orden cronológico, luego abre el SSE. Cada evento válido se transforma en
 * Game, se guarda en HistoryStore y, solo si se insertó (no era un
 * duplicado), publica GameReceivedEvent en el DomainEventBus con
 * `isHistorical: true` para la carga inicial y `false` para el SSE en
 * vivo — así los subscribers deciden si esa partida es una oportunidad
 * accionable o solo contexto histórico. No conoce estrategias, operaciones
 * ni Telegram.
 *
 * Deliberadamente NO implementa OnModuleInit: el orden en que NestJS llama
 * a los `onModuleInit` de distintos módulos no es una garantía confiable
 * (se verificó empíricamente en la Etapa 8 que StatisticsModule podía
 * quedar suscrito después de que el collector ya hubiera publicado la
 * carga inicial). En cambio, expone `start()`, que `main.ts` invoca
 * explícitamente después de `app.listen()`, momento en el que NestJS sí
 * garantiza que absolutamente todos los `onModuleInit` de la aplicación ya
 * terminaron.
 */
@Injectable()
export class GameEventCollector implements OnModuleDestroy {
  private readonly logger = new Logger(GameEventCollector.name);
  private status: CollectorStatus = CollectorStatus.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private destroyed = false;

  constructor(
    @Inject(HISTORY_STORE) private readonly historyStore: HistoryStore,
    @Inject(GAME_HISTORY_CLIENT)
    private readonly historyClient: GameHistoryClient,
    @Inject(SSE_CLIENT) private readonly sseClient: SseClient,
    private readonly gameMapper: GameMapper,
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
    private readonly errorTracker: EngineErrorTracker,
  ) {}

  async start(): Promise<void> {
    await this.loadInitialHistory();
    this.connect();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    this.clearReconnectTimer();
    this.sseClient.close();
    this.status = CollectorStatus.DISCONNECTED;
  }

  getStatus(): CollectorStatus {
    return this.status;
  }

  private async loadInitialHistory(): Promise<void> {
    try {
      const dtos = await this.historyClient.fetchInitialHistory();
      // La API entrega las rondas de más reciente a más antigua; se
      // insertan en orden cronológico para respetar el contrato del HistoryStore.
      const chronological = [...dtos].reverse();

      for (const dto of chronological) {
        this.mapAndStore(dto, true);
      }

      this.logger.log(
        `Historial inicial cargado (${this.historyStore.size()} partidas).`,
      );
    } catch (error) {
      this.logger.error(
        'No se pudo cargar el historial inicial.',
        error as Error,
      );
      this.errorTracker.recordError('No se pudo cargar el historial inicial.');
    }
  }

  private connect(): void {
    this.status = CollectorStatus.CONNECTING;

    this.sseClient.connect({
      onOpen: () => this.handleOpen(),
      onMessage: (data) => this.handleMessage(data),
      onError: (error) => this.handleError(error),
    });
  }

  private handleOpen(): void {
    this.status = CollectorStatus.CONNECTED;
    this.reconnectAttempts = 0;
    this.logger.log('Conexión SSE establecida.');
  }

  private handleMessage(raw: string): void {
    let dto: GameDto;

    try {
      dto = JSON.parse(raw) as GameDto;
    } catch {
      this.logger.warn('Evento SSE con JSON inválido, ignorado.');
      return;
    }

    this.mapAndStore(dto, false);
  }

  private mapAndStore(dto: GameDto, isHistorical: boolean): void {
    const game = this.gameMapper.toDomain(dto);

    if (!game) {
      const source = isHistorical ? 'carga inicial' : 'SSE';
      this.logger.warn(`Evento inválido ignorado (origen: ${source}).`);
      return;
    }

    this.storeGame(game, isHistorical);
  }

  private storeGame(game: Game, isHistorical: boolean): void {
    const wasInserted = this.historyStore.append(game);

    if (wasInserted) {
      this.domainEventBus.publish(
        new GameReceivedEvent({ game, isHistorical }),
      );
    }
  }

  private handleError(error: unknown): void {
    if (this.destroyed) {
      return;
    }

    this.logger.error('Error de conexión SSE.', error as Error);
    this.errorTracker.recordError('Error de conexión SSE.');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.status = CollectorStatus.RECONNECTING;
    const delay = this.nextReconnectDelay();

    this.logger.warn(`Reintentando conexión SSE en ${delay / 1000}s.`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private nextReconnectDelay(): number {
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS *
        RECONNECT_BACKOFF_FACTOR ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    );

    this.reconnectAttempts += 1;
    return delay;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}
