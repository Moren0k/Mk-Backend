import { InMemoryDomainEventBus } from '../../core/domain-events/base/in-memory-domain-event-bus';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { Game } from '../../core/history/game.type';
import { InMemoryHistoryStore } from '../../core/history/in-memory-history-store';
import { InMemoryOperationReportStore } from '../../core/reporting/in-memory-operation-report-store';
import { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { NotificationFactory } from '../../core/notification/notification.factory';
import { Notification } from '../../core/notification/notification.type';
import type { SendResult } from '../../core/notification/types/send-result.type';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { Strategy } from '../../core/strategy/interfaces/strategy.interface';
import { StrategyResult } from '../../core/strategy/types/strategy-result.type';
import { StrategyContext } from '../../core/strategy/types/strategy-context.type';
import { WinnerType } from '../../core/enums/winner-type.enum';
import { toReportsSummaryVm } from '../../api/contracts/mappers/reports-summary.mapper';
import { ActiveOperationRegistry } from '../operation/active-operation-registry';
import { OperationCoordinator } from '../operation/operation.coordinator';
import { InMemoryStrategyRuntimeState } from '../strategy/in-memory-strategy-runtime-state';
import { StrategyChannelRegistry } from '../strategy/strategy-channel-registry';
import { StrategyCoordinator } from '../strategy/strategy.coordinator';
import { OperationReportRecorder } from './operation-report-recorder';
import { SummaryReportService } from './summary-report.service';

/**
 * Prueba end-to-end de la regla de negocio "CONTEXTO != ESTRATEGIA": el
 * contexto (oficial/pruebas) de una Operation se decide una única vez, al
 * abrirla, y nunca se recalcula — ni siquiera si la estrategia que la
 * originó se reasigna después a otro canal.
 *
 * Usa las clases reales del motor (StrategyCoordinator, OperationCoordinator,
 * StrategyChannelRegistry, OperationReportRecorder, InMemoryOperationReportStore,
 * SummaryReportService) sobre un DomainEventBus real. Los únicos dobles son
 * la Strategy (controlada manualmente, en vez de esperar una racha real) y
 * el NotificationChannel (evita tocar Telegram) — mismo criterio que
 * `src/e2e/full-pipeline.e2e.spec.ts`.
 */

/** Estrategia de prueba: solo dispara señal cuando se arma explícitamente con `arm()`. */
class ManualStrategy implements Strategy {
  readonly name = 'ManualStrategy';
  readonly description = 'Estrategia de prueba disparada manualmente.';
  private armed = false;

  constructor(readonly id: string) {}

  enabled(): boolean {
    return true;
  }

  arm(): void {
    this.armed = true;
  }

  evaluate(context: StrategyContext): StrategyResult {
    if (!this.armed || !context.execution.canExecute(this.id)) {
      return { triggered: false };
    }

    this.armed = false;

    return {
      triggered: true,
      strategyId: this.id,
      strategyName: this.name,
      triggeredAt: context.timestamp,
      // maxMartingales: 0 hace que el resultado de la siguiente partida
      // decida la operación de inmediato (WON si coincide con BANKER, LOST
      // en caso contrario) — no se necesita simular una racha completa.
      recommendedWinner: WinnerType.BANKER,
      streakWinner: WinnerType.PLAYER,
      maxMartingales: 0,
      triggerGameUuid: context.currentGame.uuid,
      reason: 'Señal manual de prueba.',
      metadata: {},
    };
  }
}

class FakeNotificationChannel implements NotificationChannel {
  readonly sent: Notification[] = [];

  constructor(private readonly channelType: NotificationChannelType) {}

  getChannelType(): NotificationChannelType {
    return this.channelType;
  }

  name(): string {
    return `Fake(${this.channelType})`;
  }

  enabled(): boolean {
    return true;
  }

  supports(): boolean {
    return true;
  }

  send(notification: Notification): Promise<SendResult> {
    this.sent.push(notification);
    return Promise.resolve({ delivered: true, messageId: this.sent.length });
  }

  deleteMessage(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

function buildGame(uuid: string, winner: WinnerType): Game {
  return {
    uuid,
    winner,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('Context independence (CONTEXTO != ESTRATEGIA, end-to-end)', () => {
  const STRATEGY_ID = 'manual-strategy';

  function buildEngine() {
    const historyStore = new InMemoryHistoryStore();
    const domainEventBus = new InMemoryDomainEventBus();
    const errorTracker = new EngineErrorTracker();
    const activeOperationRegistry = new ActiveOperationRegistry();
    const strategyRuntimeState = new InMemoryStrategyRuntimeState();
    const strategyChannelRegistry = new StrategyChannelRegistry(
      activeOperationRegistry,
    );
    const strategy = new ManualStrategy(STRATEGY_ID);

    const strategyCoordinator = new StrategyCoordinator(
      historyStore,
      domainEventBus,
      [strategy],
      errorTracker,
      activeOperationRegistry,
      strategyRuntimeState,
      strategyChannelRegistry,
    );
    const operationCoordinator = new OperationCoordinator(
      domainEventBus,
      errorTracker,
      activeOperationRegistry,
    );
    const reportStore = new InMemoryOperationReportStore();
    const reportRecorder = new OperationReportRecorder(
      domainEventBus,
      reportStore,
    );
    const oficialChannel = new FakeNotificationChannel(
      NotificationChannelType.TELEGRAM,
    );
    const pruebasChannel = new FakeNotificationChannel(
      NotificationChannelType.TELEGRAM_PRUEBAS,
    );
    const summaryReportService = new SummaryReportService(
      reportStore,
      domainEventBus,
      [oficialChannel, pruebasChannel],
      new NotificationFactory(),
      errorTracker,
    );

    strategyCoordinator.onModuleInit();
    operationCoordinator.onModuleInit();
    reportRecorder.onModuleInit();

    return {
      historyStore,
      domainEventBus,
      strategy,
      strategyChannelRegistry,
      operationCoordinator,
      summaryReportService,
      oficialChannel,
      pruebasChannel,
    };
  }

  function feedGame(engine: ReturnType<typeof buildEngine>, game: Game): void {
    engine.historyStore.append(game);
    engine.domainEventBus.publish(
      new GameReceivedEvent({ game, isHistorical: false }),
    );
  }

  it('Casos 1, 2, 3 y 6: dos operaciones de la MISMA estrategia, reasignada de canal entre una y otra, terminan en resúmenes separados y la reasignación no reclasifica la ya cerrada', () => {
    const engine = buildEngine();

    // --- Operación A: la estrategia está asignada a "oficial". ---
    engine.strategyChannelRegistry.assignStrategyToChannel(
      STRATEGY_ID,
      'oficial',
    );
    engine.strategyChannelRegistry.setActive('oficial', true);

    engine.strategy.arm();
    feedGame(engine, buildGame('1', WinnerType.TIE)); // dispara la señal
    feedGame(engine, buildGame('2', WinnerType.BANKER)); // Operación A -> WON

    expect(engine.operationCoordinator.activeCount()).toBe(0);

    // --- Reasignación: la MISMA estrategia pasa a "pruebas". Nada impide
    // esto porque la Operación A ya cerró (canExecute vuelve a ser true). ---
    const reassigned = engine.strategyChannelRegistry.assignStrategyToChannel(
      STRATEGY_ID,
      'pruebas',
    );
    expect(reassigned).toBe(true);
    engine.strategyChannelRegistry.setActive('pruebas', true);

    // --- Operación B: se abre DESPUÉS de la reasignación, con la MISMA
    // estrategia, pero ahora corresponde a "pruebas". ---
    engine.strategy.arm();
    feedGame(engine, buildGame('3', WinnerType.TIE)); // dispara la señal
    feedGame(engine, buildGame('4', WinnerType.PLAYER)); // Operación B -> LOST (maxMartingales: 0)

    expect(engine.operationCoordinator.activeCount()).toBe(0);

    // Caso 6: ambos contextos coexisten, cada uno con exactamente su propia operación.
    const snapshot = engine.summaryReportService.getSnapshot();
    expect(snapshot.oficial.alertsSent).toBe(1);
    expect(snapshot.oficial.won).toBe(1);
    expect(snapshot.oficial.lost).toBe(0);
    expect(snapshot.pruebas.alertsSent).toBe(1);
    expect(snapshot.pruebas.won).toBe(0);
    expect(snapshot.pruebas.lost).toBe(1);

    // Caso 3, la prueba central: la Operación A (ya cerrada, WON) SIGUE
    // contando como "oficial" aunque `manual-strategy` esté asignada a
    // "pruebas" en este mismo instante. Si el contexto se derivara de
    // strategyId (el bug original, o su variante "dinámica" descartada en
    // la auditoría), la Operación A terminaría contada como "pruebas" aquí.
    expect(engine.strategyChannelRegistry.getChannelFor(STRATEGY_ID)).toBe(
      'pruebas',
    );
    expect(snapshot.oficial.won).toBe(1); // sigue siendo 1, no 0

    // Caso 1 y 2 combinados: la API propia expone EXCLUSIVAMENTE oficial.
    const apiResponse = toReportsSummaryVm(snapshot);
    expect(apiResponse).toEqual({
      uptimeMs: snapshot.oficial.uptimeMs,
      oficial: { won: 1, lost: 0, alertsSent: 1 },
    });
    expect(apiResponse).not.toHaveProperty('pruebas');
  });

  it('Casos 4 y 5: "enviar resumen oficial" y "enviar resumen de pruebas" son dos envíos independientes, cada uno con sus propios datos', () => {
    const engine = buildEngine();

    engine.strategyChannelRegistry.assignStrategyToChannel(
      STRATEGY_ID,
      'oficial',
    );
    engine.strategyChannelRegistry.setActive('oficial', true);
    engine.strategy.arm();
    feedGame(engine, buildGame('1', WinnerType.TIE));
    feedGame(engine, buildGame('2', WinnerType.BANKER)); // oficial: 1 alerta, 1 ganada

    engine.strategyChannelRegistry.assignStrategyToChannel(
      STRATEGY_ID,
      'pruebas',
    );
    engine.strategyChannelRegistry.setActive('pruebas', true);
    engine.strategy.arm();
    feedGame(engine, buildGame('3', WinnerType.TIE));
    feedGame(engine, buildGame('4', WinnerType.PLAYER)); // pruebas: 1 alerta, 1 perdida

    // "Enviar resumen oficial": solo el canal oficial recibe un mensaje, y
    // ese mensaje refleja solo los datos oficiales.
    engine.summaryReportService.generateAndDispatch('oficial');
    expect(engine.oficialChannel.sent).toHaveLength(1);
    expect(engine.pruebasChannel.sent).toHaveLength(0);
    expect(engine.oficialChannel.sent[0].message).toContain('Ganadas: 1');
    expect(engine.oficialChannel.sent[0].message).toContain('Perdidas: 0');

    // "Enviar resumen de pruebas": simétrico, solo el canal de pruebas.
    engine.summaryReportService.generateAndDispatch('pruebas');
    expect(engine.oficialChannel.sent).toHaveLength(1); // sin cambios
    expect(engine.pruebasChannel.sent).toHaveLength(1);
    expect(engine.pruebasChannel.sent[0].message).toContain('Ganadas: 0');
    expect(engine.pruebasChannel.sent[0].message).toContain('Perdidas: 1');

    // "todos": dos mensajes independientes, nunca uno combinado.
    engine.summaryReportService.generateAndDispatch('todos');
    expect(engine.oficialChannel.sent).toHaveLength(2);
    expect(engine.pruebasChannel.sent).toHaveLength(2);
  });
});
