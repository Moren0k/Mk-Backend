import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { DOMAIN_EVENT_BUS } from '../../core/constants/injection-tokens.constants';
import type { DomainEvent } from '../../core/domain-events/base/domain-event';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import type { DomainEventHandler } from '../../core/domain-events/base/domain-event-handler.interface';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { MartingaleOneReachedEvent } from '../../core/domain-events/operation/martingale-one-reached.event';
import { MartingaleTwoReachedEvent } from '../../core/domain-events/operation/martingale-two-reached.event';
import { OperationCancelledEvent } from '../../core/domain-events/operation/operation-cancelled.event';
import { OperationLostEvent } from '../../core/domain-events/operation/operation-lost.event';
import { OperationOpenedEvent } from '../../core/domain-events/operation/operation-opened.event';
import { OperationTieOccurredEvent } from '../../core/domain-events/operation/operation-tie-occurred.event';
import { OperationWonEvent } from '../../core/domain-events/operation/operation-won.event';
import { StrategyTriggeredEvent } from '../../core/domain-events/strategy/strategy-triggered.event';
import { OperationState } from '../../core/enums/operation-state.enum';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { Operation } from '../../core/operation/operation.entity';
import type { OperationSnapshot } from '../../core/operation/types/operation-snapshot.type';
import type { OperationUpdateResult } from '../../core/operation/types/operation-update-result.type';
import { ActiveOperationRegistry } from './active-operation-registry';

/**
 * Qué evento publicar según el estado al que acaba de llegar una Operation.
 * OPEN nunca aparece aquí (se publica aparte, al crear la operación). Una
 * tabla en vez de un if/switch: agregar un estado nuevo no toca el resto
 * del coordinador.
 */
const EVENT_FACTORY_BY_STATE: Readonly<
  Partial<Record<OperationState, (snapshot: OperationSnapshot) => DomainEvent>>
> = {
  [OperationState.MARTINGALE_ONE]: (snapshot) =>
    new MartingaleOneReachedEvent(snapshot),
  [OperationState.MARTINGALE_TWO]: (snapshot) =>
    new MartingaleTwoReachedEvent(snapshot),
  [OperationState.WON]: (snapshot) => new OperationWonEvent(snapshot),
  [OperationState.LOST]: (snapshot) => new OperationLostEvent(snapshot),
  [OperationState.CANCELLED]: (snapshot) =>
    new OperationCancelledEvent(snapshot),
};

/**
 * Administra todas las Operation activas, en memoria, sin persistencia.
 *
 * Escucha StrategyTriggeredEvent (para crear operaciones) y
 * GameReceivedEvent (para actualizar las ya abiertas). Nunca es invocado
 * manualmente: se suscribe solo durante el arranque de la aplicación.
 *
 * Toda la lógica de negocio vive en Operation; este coordinador solo
 * orquesta: crea, actualiza, publica lo que Operation reporta, y elimina
 * las que ya terminaron. Qué operaciones siguen activas vive en
 * ActiveOperationRegistry, no aquí: así cualquier otra capa (por ejemplo
 * StrategyCoordinator, vía StrategyExecutionGuard) puede consultarlo sin
 * depender de este coordinador.
 */
@Injectable()
export class OperationCoordinator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OperationCoordinator.name);

  private readonly strategyTriggeredHandler: DomainEventHandler<StrategyTriggeredEvent> =
    {
      handle: (event) => this.onStrategyTriggered(event),
    };

  private readonly gameReceivedHandler: DomainEventHandler<GameReceivedEvent> =
    {
      handle: (event) => this.onGameReceived(event),
    };

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
    private readonly errorTracker: EngineErrorTracker,
    private readonly registry: ActiveOperationRegistry,
  ) {}

  onModuleInit(): void {
    this.domainEventBus.subscribe(
      StrategyTriggeredEvent.eventName,
      this.strategyTriggeredHandler,
    );
    this.domainEventBus.subscribe(
      GameReceivedEvent.eventName,
      this.gameReceivedHandler,
    );
  }

  onModuleDestroy(): void {
    this.domainEventBus.unsubscribe(
      StrategyTriggeredEvent.eventName,
      this.strategyTriggeredHandler,
    );
    this.domainEventBus.unsubscribe(
      GameReceivedEvent.eventName,
      this.gameReceivedHandler,
    );
  }

  /** Cuántas operaciones siguen activas. Pensado para tests/inspección. */
  activeCount(): number {
    return this.registry.size();
  }

  /**
   * Snapshots de todas las operaciones activas, sin importar su
   * estrategia/canal. Solo lectura: pensado para read-models de la API
   * (Mk-Api.md §5.3 — el controller nunca inyecta `OperationCoordinator`
   * directo, siempre a través de un read-model de `application/`).
   */
  getActiveSnapshots(): ReadonlyArray<OperationSnapshot> {
    return this.registry.getAll().map((operation) => operation.toSnapshot());
  }

  /**
   * Cancela una operación activa por comando explícito (Mk-Api.md Anexo D
   * §4, caso de uso invocado desde `POST /api/v1/operations/:id/cancel`).
   * Devuelve `undefined` si `operationId` no corresponde a ninguna
   * operación activa (ya se resolvió sola o nunca existió) — quien llama
   * decide si eso es un 404.
   */
  cancel(operationId: string, reason: string): OperationSnapshot | undefined {
    const operation = this.registry.getById(operationId);

    if (!operation) {
      return undefined;
    }

    const result = operation.cancel(reason);

    if (result.stateChanged) {
      this.publishTransitionEvent(result);
    }

    if (result.completed) {
      this.registry.unregister(operationId);
    }

    return result.snapshot;
  }

  private onStrategyTriggered(event: StrategyTriggeredEvent): void {
    const operation = Operation.open(event.payload);
    this.registry.register(operation);
    this.domainEventBus.publish(
      new OperationOpenedEvent(operation.toSnapshot()),
    );
  }

  private onGameReceived(event: GameReceivedEvent): void {
    for (const operation of this.registry.getAll()) {
      this.updateOperation(operation, event);
    }
  }

  private updateOperation(
    operation: Operation,
    event: GameReceivedEvent,
  ): void {
    try {
      const result = operation.update(event.payload.game);

      if (result.stateChanged) {
        this.publishTransitionEvent(result);
      }

      if (result.tieOccurred) {
        this.domainEventBus.publish(
          new OperationTieOccurredEvent(result.snapshot),
        );
      }

      if (result.completed) {
        this.registry.unregister(operation.operationId);
      }
    } catch (error) {
      const message = `La operación "${operation.operationId}" falló al actualizarse; se descarta.`;
      this.logger.error(message, error as Error);
      this.errorTracker.recordError(message);
      this.registry.unregister(operation.operationId);
    }
  }

  private publishTransitionEvent(result: OperationUpdateResult): void {
    const buildEvent = EVENT_FACTORY_BY_STATE[result.newState];

    if (buildEvent) {
      this.domainEventBus.publish(buildEvent(result.snapshot));
    }
  }
}
