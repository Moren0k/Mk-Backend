import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

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
import type { OperationSnapshot } from '../../core/operation/types/operation-snapshot.type';
import { RollingStatsReadModel } from './rolling-stats.read-model';
import type { PublicEvent, PublicEventType } from './types/public-event.type';

type EventClass = { readonly eventName: string };
type Subscription = {
  readonly eventName: string;
  readonly handler: DomainEventHandler;
};

const OPERATION_EVENT_TYPES: ReadonlyArray<
  readonly [EventClass, PublicEventType]
> = [
  [OperationOpenedEvent, 'operation.opened'],
  [MartingaleOneReachedEvent, 'operation.mg1'],
  [MartingaleTwoReachedEvent, 'operation.mg2'],
  [OperationTieOccurredEvent, 'operation.tie'],
  [OperationWonEvent, 'operation.won'],
  [OperationLostEvent, 'operation.lost'],
  [OperationCancelledEvent, 'operation.cancelled'],
];

/**
 * Payload público de una operación para SSE — duplica a propósito el
 * mapeo de `api/contracts/mappers/operation.mapper.ts` (mismos campos de
 * OperationVm, Anexo D §10: "el payload es el OperationVm completo, no un
 * diff"): `application/` no puede importar `api/contracts/` (la
 * dependencia va al revés), y no vale la pena una abstracción cruzada de
 * capas para una transformación de 9 líneas.
 */
function toOperationPayload(snapshot: OperationSnapshot) {
  return {
    operationId: snapshot.operationId,
    strategyId: snapshot.strategyId,
    recommendedWinner: snapshot.recommendedWinner,
    streakWinner: snapshot.streakWinner,
    currentState: snapshot.currentState,
    currentMartingale: snapshot.currentMartingale,
    reason: snapshot.reason,
    openedAt: snapshot.openedAt.toISOString(),
    closedAt: snapshot.closedAt?.toISOString() ?? null,
  };
}

/**
 * Proyecta el `DomainEventBus` (Mk-Api.md §13.2, Anexo D §9/§10) hacia un
 * único `Subject` de RxJS que `GET /api/v1/events/stream` reenvía por
 * SSE. Nunca expone un `DomainEvent` crudo: cada tipo tiene su propia
 * proyección explícita (tabla §13.4).
 *
 * Un solo `Subject` compartido entre todas las conexiones (broadcast):
 * cada cliente filtra por `channel`/`strategyId` del lado del frontend
 * (Anexo D §2/§10), esta clase no segmenta nada. Backpressure/límite de
 * clientes queda como Pendiente explícito (Anexo B.5) — no implementado.
 */
@Injectable()
export class EventsReadModel implements OnModuleInit, OnModuleDestroy {
  private readonly subject = new Subject<PublicEvent>();

  private readonly gameReceivedHandler: DomainEventHandler<GameReceivedEvent> =
    {
      handle: (event) => this.onGameReceived(event),
    };

  private readonly operationSubscriptions: ReadonlyArray<Subscription> =
    OPERATION_EVENT_TYPES.map(([eventClass, type]) => ({
      eventName: eventClass.eventName,
      handler: {
        handle: (event: DomainEvent<OperationSnapshot>) =>
          this.emit(type, toOperationPayload(event.payload)),
      },
    }));

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
    private readonly rollingStats: RollingStatsReadModel,
  ) {}

  onModuleInit(): void {
    this.domainEventBus.subscribe(
      GameReceivedEvent.eventName,
      this.gameReceivedHandler,
    );

    for (const { eventName, handler } of this.operationSubscriptions) {
      this.domainEventBus.subscribe(eventName, handler);
    }
  }

  onModuleDestroy(): void {
    this.domainEventBus.unsubscribe(
      GameReceivedEvent.eventName,
      this.gameReceivedHandler,
    );

    for (const { eventName, handler } of this.operationSubscriptions) {
      this.domainEventBus.unsubscribe(eventName, handler);
    }

    this.subject.complete();
  }

  /** Un `Observable` nuevo por conexión SSE; todas comparten el mismo `Subject` (broadcast). */
  stream(): Observable<PublicEvent> {
    return this.subject.asObservable();
  }

  private onGameReceived(event: GameReceivedEvent): void {
    if (event.payload.isHistorical) {
      return;
    }

    const { game } = event.payload;

    this.emit('game.received', {
      roundId: game.uuid,
      winner: game.winner,
      score: game.score,
      playedAt: game.playedAt.toISOString(),
    });
    this.emit('stats.rolling', this.rollingStats.compute(200));
    this.emit('stats.rolling', this.rollingStats.compute(50));
  }

  private emit(type: PublicEventType, payload: unknown): void {
    this.subject.next({
      type,
      payload,
      occurredAt: new Date().toISOString(),
    });
  }
}
