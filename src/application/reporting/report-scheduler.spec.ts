import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { HourlyReportGeneratedEvent } from '../../core/domain-events/reporting/hourly-report-generated.event';
import { OperationState } from '../../core/enums/operation-state.enum';
import type { OperationReportStore } from '../../core/reporting/interfaces/operation-report-store.interface';
import { ReportScheduler } from './report-scheduler';

describe('ReportScheduler', () => {
  let domainEventBus: jest.Mocked<DomainEventBus>;
  let store: jest.Mocked<OperationReportStore>;
  let scheduler: ReportScheduler;

  beforeEach(() => {
    jest.useFakeTimers();

    domainEventBus = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      publish: jest.fn(),
      publishMany: jest.fn(),
      clear: jest.fn(),
    };
    store = {
      recordOpened: jest.fn(),
      recordClosed: jest.fn(),
      getOpenedBetween: jest.fn().mockReturnValue([]),
      getClosedBetween: jest.fn().mockReturnValue([]),
      getAllOpened: jest.fn().mockReturnValue([]),
      getAllClosed: jest.fn().mockReturnValue([]),
    };
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    jest.useRealTimers();
  });

  function start(now: string): void {
    jest.setSystemTime(new Date(now));
    scheduler = new ReportScheduler(domainEventBus, store);
    scheduler.onModuleInit();
  }

  function publishedEvents(): ReadonlyArray<{ eventName: string }> {
    return domainEventBus.publish.mock.calls.map(
      ([event]) =>
        event as {
          eventName: string;
        },
    );
  }

  it('publishes an hourly report per group (oficial + pruebas) exactly at the next clock hour, inside operating hours', () => {
    // now = 10:30 Bogotá (15:30Z) -> próximo límite 16:00Z = 11:00 Bogotá.
    // El bloque que cierra (10:00-11:00 Bogotá) sí es horario operativo.
    start('2026-08-01T15:30:00.000Z');

    jest.advanceTimersByTime(30 * 60 * 1000);

    expect(publishedEvents()).toEqual([
      expect.objectContaining({
        eventName: HourlyReportGeneratedEvent.eventName,
      }),
      expect.objectContaining({
        eventName: HourlyReportGeneratedEvent.eventName,
      }),
    ]);

    const groups = (
      domainEventBus.publish.mock.calls as [HourlyReportGeneratedEvent][]
    ).map(([event]) => event.payload.group);
    expect(groups.sort()).toEqual(['oficial', 'pruebas']);
  });

  it('does not publish an hourly report for a block outside operating hours', () => {
    // now = 09:30 Bogotá (14:30Z) -> próximo límite 15:00Z = 10:00 Bogotá.
    // El bloque que cierra (09:00-10:00 Bogotá) todavía está fuera de horario.
    start('2026-08-01T14:30:00.000Z');

    jest.advanceTimersByTime(30 * 60 * 1000);

    expect(domainEventBus.publish).not.toHaveBeenCalled();
  });

  it('builds the report window (Bogotá 10:00-11:00) and its metrics from the store', () => {
    store.getOpenedBetween.mockReturnValue([
      {
        operationId: 'op-1',
        strategyId: 'streak-3',
        openedAt: new Date('2026-08-01T15:10:00.000Z'),
      },
      {
        operationId: 'op-2',
        strategyId: 'streak-3',
        openedAt: new Date('2026-08-01T15:20:00.000Z'),
      },
    ]);
    store.getClosedBetween.mockReturnValue([
      {
        operationId: 'op-1',
        strategyId: 'streak-3',
        openedAt: new Date('2026-08-01T15:10:00.000Z'),
        closedAt: new Date('2026-08-01T15:15:00.000Z'),
        result: OperationState.WON,
        martingalesUsed: 0,
        maxMartingales: 2,
      },
    ]);

    start('2026-08-01T15:30:00.000Z');
    jest.advanceTimersByTime(30 * 60 * 1000);

    expect(store.getOpenedBetween).toHaveBeenCalledWith(
      new Date('2026-08-01T15:00:00.000Z'),
      new Date('2026-08-01T16:00:00.000Z'),
    );

    const [event] = domainEventBus.publish.mock.calls[0] as [
      HourlyReportGeneratedEvent,
    ];
    const report = event.payload;

    expect(report.windowFrom.toISOString()).toBe('2026-08-01T15:00:00.000Z');
    expect(report.windowTo.toISOString()).toBe('2026-08-01T16:00:00.000Z');
    expect(report.metrics.alertsSent).toBe(2);
    expect(report.metrics.closedOperations).toBe(1);
    expect(report.metrics.won).toBe(1);
    expect(report.metrics.directWins).toBe(1);
  });

  it('splits records between the oficial and pruebas snapshots, never mixing them', () => {
    store.getOpenedBetween.mockReturnValue([
      {
        operationId: 'op-1',
        strategyId: 'streak-3',
        openedAt: new Date('2026-08-01T15:10:00.000Z'),
      },
      {
        operationId: 'op-2',
        strategyId: 'streak-4',
        openedAt: new Date('2026-08-01T15:20:00.000Z'),
      },
    ]);
    store.getClosedBetween.mockReturnValue([
      {
        operationId: 'op-2',
        strategyId: 'streak-4',
        openedAt: new Date('2026-08-01T15:20:00.000Z'),
        closedAt: new Date('2026-08-01T15:25:00.000Z'),
        result: OperationState.WON,
        martingalesUsed: 0,
        maxMartingales: 2,
      },
    ]);

    start('2026-08-01T15:30:00.000Z');
    jest.advanceTimersByTime(30 * 60 * 1000);

    const events = domainEventBus.publish.mock.calls.map(
      ([event]) => (event as HourlyReportGeneratedEvent).payload,
    );
    const oficial = events.find((report) => report.group === 'oficial')!;
    const pruebas = events.find((report) => report.group === 'pruebas')!;

    expect(oficial.metrics.alertsSent).toBe(2);
    expect(oficial.metrics.closedOperations).toBe(1);
    expect(oficial.metrics.won).toBe(1);
    expect(pruebas.metrics.alertsSent).toBe(0);
    expect(pruebas.metrics.closedOperations).toBe(0);
  });

  it('reschedules itself for the following hour after firing', () => {
    start('2026-08-01T15:30:00.000Z');
    jest.advanceTimersByTime(30 * 60 * 1000); // dispara a las 16:00Z
    domainEventBus.publish.mockClear();

    jest.advanceTimersByTime(60 * 60 * 1000); // 17:00Z

    expect(domainEventBus.publish).toHaveBeenCalledTimes(2);
  });

  it('stops firing after onModuleDestroy', () => {
    start('2026-08-01T15:30:00.000Z');

    scheduler.onModuleDestroy();
    jest.advanceTimersByTime(3 * 60 * 60 * 1000);

    expect(domainEventBus.publish).not.toHaveBeenCalled();
  });
});
