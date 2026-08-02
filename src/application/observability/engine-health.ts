import { Inject, Injectable } from '@nestjs/common';

import {
  HISTORY_STORE,
  NOTIFICATION_CHANNELS,
  STRATEGIES,
} from '../../core/constants/injection-tokens.constants';
import type { HistoryStore } from '../../core/interfaces/history-store.interface';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { EngineHealthSnapshot } from '../../core/observability/types/engine-health-snapshot.type';
import type { Strategy } from '../../core/strategy/interfaces/strategy.interface';
import { CollectorStatus } from '../../infrastructure/collector/collector-status.enum';
import { GameEventCollector } from '../../infrastructure/collector/game-event-collector';
import { OperationCoordinator } from '../operation/operation.coordinator';

/**
 * Clase de consulta pura: no escucha eventos ni acumula nada, solo lee el
 * estado actual de los componentes vivos del motor cuando se le pregunta.
 * No expone HTTP; es responsabilidad de quien la use (logs, un futuro
 * dashboard, etc.) decidir cómo mostrarla.
 */
@Injectable()
export class EngineHealth {
  constructor(
    @Inject(HISTORY_STORE) private readonly historyStore: HistoryStore,
    private readonly gameEventCollector: GameEventCollector,
    private readonly operationCoordinator: OperationCoordinator,
    @Inject(STRATEGIES) private readonly strategies: readonly Strategy[],
    @Inject(NOTIFICATION_CHANNELS)
    private readonly channels: readonly NotificationChannel[],
    private readonly errorTracker: EngineErrorTracker,
  ) {}

  getSnapshot(): EngineHealthSnapshot {
    return Object.freeze({
      collectorConnected:
        this.gameEventCollector.getStatus() === CollectorStatus.CONNECTED,
      lastGameReceivedAt: this.historyStore.getLatest()?.playedAt,
      gamesInMemory: this.historyStore.size(),
      activeOperations: this.operationCoordinator.activeCount(),
      registeredStrategies: this.strategies.length,
      registeredChannels: this.channels.length,
      lastError: this.errorTracker.getLastError(),
    });
  }
}
