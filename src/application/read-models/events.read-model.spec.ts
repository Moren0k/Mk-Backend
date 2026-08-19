import { firstValueFrom, take, toArray } from 'rxjs';

import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { MartingaleOneReachedEvent } from '../../core/domain-events/operation/martingale-one-reached.event';
import { OperationCancelledEvent } from '../../core/domain-events/operation/operation-cancelled.event';
import { OperationOpenedEvent } from '../../core/domain-events/operation/operation-opened.event';
import { OperationWonEvent } from '../../core/domain-events/operation/operation-won.event';
import { OperationState } from '../../core/enums/operation-state.enum';
import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import type { DomainEventHandler } from '../../core/domain-events/base/domain-event-handler.interface';
import { OperationSnapshot } from '../../core/operation/types/operation-snapshot.type';
import { EventsReadModel } from './events.read-model';
import { RollingStatsReadModel } from './rolling-stats.read-model';

function buildGame(uuid: string, winner: WinnerType): Game {
  return {
    uuid,
    winner,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function buildSnapshot(
  overrides: Partial<OperationSnapshot> = {},
): OperationSnapshot {
  return {
    operationId: 'op-1',
    strategyId: 'streak-4',
    context: 'oficial',
    recommendedWinner: WinnerType.BANKER,
    streakWinner: WinnerType.PLAYER,
    currentState: OperationState.OPEN,
    currentMartingale: 0,
    maxMartingales: 2,
    openedAt: new Date('2026-08-10T12:00:00.000Z'),
    closedAt: undefined,
    reason: 'test',
    history: [],
    ...overrides,
  };
}

function buildDomainEventBus(): {
  bus: DomainEventBus;
  handlers: Map<string, DomainEventHandler[]>;
} {
  const handlers = new Map<string, DomainEventHandler[]>();
  const bus: DomainEventBus = {
    subscribe: jest.fn((eventName: string, handler: DomainEventHandler) => {
      const list = handlers.get(eventName) ?? [];
      list.push(handler);
      handlers.set(eventName, list);
    }),
    unsubscribe: jest.fn((eventName: string, handler: DomainEventHandler) => {
      const list = handlers.get(eventName) ?? [];
      handlers.set(
        eventName,
        list.filter((h) => h !== handler),
      );
    }),
    publish: jest.fn((event: { eventName: string }) => {
      for (const handler of handlers.get(event.eventName) ?? []) {
        handler.handle(event as never);
      }
    }),
    publishMany: jest.fn(),
    clear: jest.fn(),
  };

  return { bus, handlers };
}

describe('EventsReadModel', () => {
  it('emits game.received followed by two stats.rolling events for a live game', async () => {
    const { bus } = buildDomainEventBus();
    const rollingStats = {
      compute: jest.fn().mockImplementation((window: number) => ({
        window,
        playerPct: 50,
        bankerPct: 50,
        tiePct: 0,
      })),
    } as unknown as RollingStatsReadModel;
    const readModel = new EventsReadModel(bus, rollingStats);
    readModel.onModuleInit();

    const eventsPromise = firstValueFrom(
      readModel.stream().pipe(take(3), toArray()),
    );

    bus.publish(
      new GameReceivedEvent({
        game: buildGame('1', WinnerType.PLAYER),
        isHistorical: false,
      }),
    );

    const events = await eventsPromise;

    expect(events.map((e) => e.type)).toEqual([
      'game.received',
      'stats.rolling',
      'stats.rolling',
    ]);
    expect(events[0].payload).toEqual({
      roundId: '1',
      winner: 'PLAYER',
      score: 8,
      playedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(rollingStats.compute).toHaveBeenCalledWith(200);
    expect(rollingStats.compute).toHaveBeenCalledWith(50);
  });

  it('never emits anything for historical games (initial backfill)', () => {
    const { bus } = buildDomainEventBus();
    const rollingStats = {
      compute: jest.fn(),
    } as unknown as RollingStatsReadModel;
    const readModel = new EventsReadModel(bus, rollingStats);
    readModel.onModuleInit();

    const emitted: unknown[] = [];
    readModel.stream().subscribe((event) => emitted.push(event));

    bus.publish(
      new GameReceivedEvent({
        game: buildGame('1', WinnerType.PLAYER),
        isHistorical: true,
      }),
    );

    expect(emitted).toEqual([]);
    expect(rollingStats.compute).not.toHaveBeenCalled();
  });

  it('projects OperationOpenedEvent to operation.opened with the full OperationVm-shaped payload', async () => {
    const { bus } = buildDomainEventBus();
    const rollingStats = {
      compute: jest.fn(),
    } as unknown as RollingStatsReadModel;
    const readModel = new EventsReadModel(bus, rollingStats);
    readModel.onModuleInit();

    const eventPromise = firstValueFrom(readModel.stream());

    bus.publish(new OperationOpenedEvent(buildSnapshot()));

    const event = await eventPromise;

    expect(event.type).toBe('operation.opened');
    expect(event.payload).toEqual({
      operationId: 'op-1',
      strategyId: 'streak-4',
      recommendedWinner: 'BANKER',
      streakWinner: 'PLAYER',
      currentState: 'OPEN',
      currentMartingale: 0,
      reason: 'test',
      openedAt: '2026-08-10T12:00:00.000Z',
      closedAt: null,
    });
  });

  it.each([
    [MartingaleOneReachedEvent, 'operation.mg1'],
    [OperationWonEvent, 'operation.won'],
    [OperationCancelledEvent, 'operation.cancelled'],
  ] as const)('projects %p to "%s"', async (EventClass, expectedType) => {
    const { bus } = buildDomainEventBus();
    const rollingStats = {
      compute: jest.fn(),
    } as unknown as RollingStatsReadModel;
    const readModel = new EventsReadModel(bus, rollingStats);
    readModel.onModuleInit();

    const eventPromise = firstValueFrom(readModel.stream());
    bus.publish(new EventClass(buildSnapshot()));

    expect((await eventPromise).type).toBe(expectedType);
  });

  it('stops emitting after onModuleDestroy unsubscribes from the bus', () => {
    const { bus } = buildDomainEventBus();
    const rollingStats = {
      compute: jest.fn(),
    } as unknown as RollingStatsReadModel;
    const readModel = new EventsReadModel(bus, rollingStats);
    readModel.onModuleInit();
    readModel.onModuleDestroy();

    const emitted: unknown[] = [];
    readModel.stream().subscribe({
      next: (event) => emitted.push(event),
      error: () => {
        // the subject completes on destroy; ignore for this assertion
      },
    });

    bus.publish(new OperationOpenedEvent(buildSnapshot()));

    expect(emitted).toEqual([]);
  });
});
