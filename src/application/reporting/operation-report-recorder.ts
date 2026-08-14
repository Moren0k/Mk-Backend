import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import {
  DOMAIN_EVENT_BUS,
  OPERATION_REPORT_STORE,
} from '../../core/constants/injection-tokens.constants';
import type { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import type { DomainEventHandler } from '../../core/domain-events/base/domain-event-handler.interface';
import { OperationLostEvent } from '../../core/domain-events/operation/operation-lost.event';
import { OperationOpenedEvent } from '../../core/domain-events/operation/operation-opened.event';
import { OperationWonEvent } from '../../core/domain-events/operation/operation-won.event';
import { OperationState } from '../../core/enums/operation-state.enum';
import type { OperationReportStore } from '../../core/reporting/interfaces/operation-report-store.interface';
import { OperationSnapshot } from '../../core/operation/types/operation-snapshot.type';

/**
 * Escucha únicamente OperationOpenedEvent/OperationWonEvent/OperationLostEvent
 * y guarda en OperationReportStore lo mínimo indispensable para calcular
 * métricas después (ver OperationOpenedRecord/OperationClosedRecord).
 *
 * Completamente ajeno a Telegram, a los reportes horario/diario y a su
 * scheduling: solo registra hechos. ReportScheduler es quien decide cuándo
 * leerlos y qué hacer con ellos.
 */
@Injectable()
export class OperationReportRecorder implements OnModuleInit, OnModuleDestroy {
  private readonly openedHandler: DomainEventHandler<OperationOpenedEvent> = {
    handle: (event) => this.recordOpened(event.payload),
  };

  private readonly wonHandler: DomainEventHandler<OperationWonEvent> = {
    handle: (event) => this.recordClosed(event.payload),
  };

  private readonly lostHandler: DomainEventHandler<OperationLostEvent> = {
    handle: (event) => this.recordClosed(event.payload),
  };

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly domainEventBus: DomainEventBus,
    @Inject(OPERATION_REPORT_STORE)
    private readonly store: OperationReportStore,
  ) {}

  onModuleInit(): void {
    this.domainEventBus.subscribe(
      OperationOpenedEvent.eventName,
      this.openedHandler,
    );
    this.domainEventBus.subscribe(OperationWonEvent.eventName, this.wonHandler);
    this.domainEventBus.subscribe(
      OperationLostEvent.eventName,
      this.lostHandler,
    );
  }

  onModuleDestroy(): void {
    this.domainEventBus.unsubscribe(
      OperationOpenedEvent.eventName,
      this.openedHandler,
    );
    this.domainEventBus.unsubscribe(
      OperationWonEvent.eventName,
      this.wonHandler,
    );
    this.domainEventBus.unsubscribe(
      OperationLostEvent.eventName,
      this.lostHandler,
    );
  }

  private recordOpened(snapshot: OperationSnapshot): void {
    this.store.recordOpened({
      operationId: snapshot.operationId,
      strategyId: snapshot.strategyId,
      openedAt: snapshot.openedAt,
    });
  }

  private recordClosed(snapshot: OperationSnapshot): void {
    // Garantizado por quién dispara este handler: OperationCoordinator solo
    // publica OperationWonEvent/OperationLostEvent con currentState WON/LOST
    // respectivamente, y siempre después de fijar closedAt (ver
    // Operation.applyTransition).
    this.store.recordClosed({
      operationId: snapshot.operationId,
      strategyId: snapshot.strategyId,
      openedAt: snapshot.openedAt,
      closedAt: snapshot.closedAt ?? new Date(),
      result: snapshot.currentState as OperationState.WON | OperationState.LOST,
      martingalesUsed: snapshot.currentMartingale,
      maxMartingales: snapshot.maxMartingales,
    });
  }
}
