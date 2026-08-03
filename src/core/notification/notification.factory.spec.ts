import { NotificationChannelType } from '../enums/notification-channel-type.enum';
import { NotificationSeverity } from '../enums/notification-severity.enum';
import { OperationState } from '../enums/operation-state.enum';
import { WinnerType } from '../enums/winner-type.enum';
import type { DistributionMetricValue } from '../metrics/types/distribution-metric-value.type';
import { Game } from '../history/game.type';
import { OperationSnapshot } from '../operation/types/operation-snapshot.type';
import { OperationTransition } from '../operation/types/operation-transition.type';
import { ReportMetricsSnapshot } from '../reporting/types/report-metrics-snapshot.type';
import { ReportSnapshot } from '../reporting/types/report-snapshot.type';
import { SummaryMetricsSnapshot } from '../reporting/types/summary-metrics-snapshot.type';
import { NotificationFactory } from './notification.factory';

function buildGame(uuid: string, winner: WinnerType): Game {
  return {
    uuid,
    winner,
    score: 8,
    playedAt: new Date('2026-08-01T21:15:03.000Z'),
  };
}

function buildDistribution(
  overrides: Partial<DistributionMetricValue> = {},
): DistributionMetricValue {
  return Object.freeze({
    playerPct: 48.5,
    tiePct: 12.0,
    bankerPct: 39.5,
    totalGames: 200,
    ...overrides,
  });
}

function buildTransition(
  overrides: Partial<OperationTransition> = {},
): OperationTransition {
  return {
    from: OperationState.OPEN,
    to: OperationState.MARTINGALE_ONE,
    game: buildGame('1', WinnerType.PLAYER),
    timestamp: new Date('2026-08-01T21:15:03.000Z'),
    reason:
      'La partida no coincidió con el ganador recomendado (martingala 1).',
    ...overrides,
  };
}

function buildSnapshot(
  overrides: Partial<OperationSnapshot> = {},
): OperationSnapshot {
  return {
    operationId: 'op-1',
    strategyId: 'streak-3',
    recommendedWinner: WinnerType.BANKER,
    currentState: OperationState.OPEN,
    currentMartingale: 0,
    maxMartingales: 2,
    openedAt: new Date('2026-08-01T21:15:03.000Z'),
    closedAt: undefined,
    reason: 'Racha de 3 resultados consecutivos de PLAYER.',
    history: [],
    ...overrides,
  };
}

function buildReportMetrics(
  overrides: Partial<ReportMetricsSnapshot> = {},
): ReportMetricsSnapshot {
  return {
    alertsSent: 5,
    closedOperations: 4,
    won: 3,
    lost: 1,
    effectivenessPct: 75,
    directWins: 2,
    martingaleOneWins: 1,
    martingaleTwoWins: 0,
    martingalesExhausted: 1,
    distribution: {
      directPct: 50,
      martingaleOnePct: 25,
      martingaleTwoPct: 0,
      lostPct: 25,
    },
    ...overrides,
  };
}

function buildReportSnapshot(
  overrides: Partial<ReportSnapshot> = {},
): ReportSnapshot {
  return {
    windowFrom: new Date('2026-08-01T18:00:00.000Z'), // 13:00 Bogotá
    windowTo: new Date('2026-08-01T19:00:00.000Z'), // 14:00 Bogotá
    metrics: buildReportMetrics(),
    ...overrides,
  };
}

function buildSummaryMetrics(
  overrides: Partial<SummaryMetricsSnapshot> = {},
): SummaryMetricsSnapshot {
  return {
    ...buildReportMetrics(),
    uptimeMs: 2 * 60 * 60 * 1000 + 15 * 60 * 1000,
    bestWinStreak: 3,
    worstLossStreak: 1,
    currentStreak: { result: 'WON', length: 2 },
    totalMartingalesUsed: 4,
    avgMartingalesPerWin: 1.33,
    directWinPctOfWins: 66.67,
    martingaleOneWinPctOfWins: 33.33,
    martingaleTwoWinPctOfWins: 0,
    winLossRatio: 3,
    alertsPerHourAvg: 2.5,
    avgEffectivenessPerHour: 75,
    bestAlertsHour: { label: '01/08 10:00', value: 5 },
    bestEffectivenessHour: { label: '01/08 10:00', value: 100 },
    worstEffectivenessHour: { label: '01/08 13:00', value: 40 },
    ...overrides,
  };
}

describe('NotificationFactory', () => {
  let factory: NotificationFactory;

  beforeEach(() => {
    factory = new NotificationFactory();
  });

  it('builds an INFO notification for OperationOpenedEvent, targeted at the given channel', () => {
    const snapshot = buildSnapshot();

    const notification = factory.createForOperationOpened(
      snapshot,
      NotificationChannelType.TELEGRAM,
    );

    expect(notification.severity).toBe(NotificationSeverity.INFO);
    expect(notification.channel).toBe(NotificationChannelType.TELEGRAM);
    expect(notification.title).toContain('Nueva operación');
    expect(notification.message).toContain('Streak 3');
    expect(notification.message).toContain('BANKER');
    expect(notification.message).toContain('2');
    expect(notification.message).toContain(snapshot.reason);
    expect(notification.message).toContain('21:15:03');
    expect(notification.metadata).toEqual({ operationId: 'op-1' });
  });

  it('builds a WARNING notification for MartingaleOneReachedEvent, using the last transition reason', () => {
    const transition = buildTransition({
      reason:
        'La partida no coincidió con el ganador recomendado (martingala 1).',
      timestamp: new Date('2026-08-01T21:16:00.000Z'),
    });
    const snapshot = buildSnapshot({
      currentState: OperationState.MARTINGALE_ONE,
      currentMartingale: 1,
      history: [transition],
    });

    const notification = factory.createForMartingaleOneReached(
      snapshot,
      NotificationChannelType.TELEGRAM,
    );

    expect(notification.severity).toBe(NotificationSeverity.WARNING);
    expect(notification.title).toContain('Martingala 1');
    expect(notification.message).toContain(transition.reason);
    expect(notification.message).toContain('21:16:00');
    expect(notification.metadata).toEqual({
      operationId: 'op-1',
      martingaleNumber: 1,
    });
  });

  it('builds a WARNING notification for MartingaleTwoReachedEvent', () => {
    const snapshot = buildSnapshot({
      currentState: OperationState.MARTINGALE_TWO,
      currentMartingale: 2,
      history: [
        buildTransition(),
        buildTransition({ to: OperationState.MARTINGALE_TWO }),
      ],
    });

    const notification = factory.createForMartingaleTwoReached(
      snapshot,
      NotificationChannelType.TELEGRAM,
    );

    expect(notification.severity).toBe(NotificationSeverity.WARNING);
    expect(notification.title).toContain('Martingala 2');
    expect(notification.metadata).toEqual({
      operationId: 'op-1',
      martingaleNumber: 2,
    });
  });

  it('builds a SUCCESS notification for OperationWonEvent', () => {
    const snapshot = buildSnapshot({
      currentState: OperationState.WON,
      currentMartingale: 1,
      closedAt: new Date('2026-08-01T21:20:00.000Z'),
    });

    const notification = factory.createForOperationWon(
      snapshot,
      NotificationChannelType.TELEGRAM,
    );

    expect(notification.severity).toBe(NotificationSeverity.SUCCESS);
    expect(notification.title).toContain('ganada');
    expect(notification.message).toContain('Martingala final: 1');
    expect(notification.message).toContain('21:20:00');
  });

  it('builds an ERROR notification for OperationLostEvent', () => {
    const snapshot = buildSnapshot({
      currentState: OperationState.LOST,
      currentMartingale: 2,
      closedAt: new Date('2026-08-01T21:25:00.000Z'),
    });

    const notification = factory.createForOperationLost(
      snapshot,
      NotificationChannelType.TELEGRAM,
    );

    expect(notification.severity).toBe(NotificationSeverity.ERROR);
    expect(notification.title).toContain('perdida');
    expect(notification.message).toContain('Martingala final: 2');
  });

  it('never emits plain "unknown"-looking text: strategyId is humanized', () => {
    const snapshot = buildSnapshot({ strategyId: 'streak-3' });

    const notification = factory.createForOperationOpened(
      snapshot,
      NotificationChannelType.TELEGRAM,
    );

    expect(notification.message).toContain('Streak 3');
    expect(notification.message).not.toContain('streak-3');
  });

  describe('with distribution', () => {
    it('appends the distribution line with correct emoji order to an opened notification', () => {
      const distribution = buildDistribution({
        playerPct: 48.5,
        tiePct: 12.0,
        bankerPct: 39.5,
      });
      const snapshot = buildSnapshot();

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
        distribution,
      );

      expect(notification.message).toContain('🔵 48.50%  🟡 12.00%  🔴 39.50%');
      expect(notification.title).toContain('Nueva operación');
    });

    it('appends the distribution line to a MartingaleOneReached notification', () => {
      const distribution = buildDistribution();
      const snapshot = buildSnapshot({
        currentState: OperationState.MARTINGALE_ONE,
        currentMartingale: 1,
        history: [buildTransition()],
      });

      const notification = factory.createForMartingaleOneReached(
        snapshot,
        NotificationChannelType.TELEGRAM,
        distribution,
      );

      expect(notification.message).toContain('🔵');
      expect(notification.message).toContain('🟡');
      expect(notification.message).toContain('🔴');
    });

    it('appends the distribution line to a won notification', () => {
      const distribution = buildDistribution();
      const snapshot = buildSnapshot({
        currentState: OperationState.WON,
        currentMartingale: 0,
        closedAt: new Date('2026-08-01T21:20:00.000Z'),
      });

      const notification = factory.createForOperationWon(
        snapshot,
        NotificationChannelType.TELEGRAM,
        distribution,
      );

      expect(notification.message).toContain('🔵');
      expect(notification.title).toContain('ganada');
    });

    it('appends the distribution line to a lost notification', () => {
      const distribution = buildDistribution();
      const snapshot = buildSnapshot({
        currentState: OperationState.LOST,
        currentMartingale: 2,
        closedAt: new Date('2026-08-01T21:25:00.000Z'),
      });

      const notification = factory.createForOperationLost(
        snapshot,
        NotificationChannelType.TELEGRAM,
        distribution,
      );

      expect(notification.message).toContain('🔴');
      expect(notification.title).toContain('perdida');
    });

    it('does not append the distribution line when distribution is undefined', () => {
      const snapshot = buildSnapshot();

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).not.toContain('🔵');
      expect(notification.message).not.toContain('🟡');
      expect(notification.message).not.toContain('🔴');
    });

    it('maintains the mandatory emoji order: 🔵 player → 🟡 tie → 🔴 banker', () => {
      const distribution = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
        distribution,
      );

      const blueIndex = notification.message.indexOf('🔵');
      const yellowIndex = notification.message.indexOf('🟡');
      const redIndex = notification.message.indexOf('🔴');

      expect(blueIndex).toBeLessThan(yellowIndex);
      expect(yellowIndex).toBeLessThan(redIndex);
    });
  });

  describe('createForTieOccurred', () => {
    it('builds a WARNING notification with the operation state and tie context', () => {
      const snapshot = buildSnapshot({
        currentState: OperationState.OPEN,
      });

      const notification = factory.createForTieOccurred(
        snapshot,
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.severity).toBe(NotificationSeverity.WARNING);
      expect(notification.title).toContain('Empate');
      expect(notification.message).toContain('Streak 3');
      expect(notification.message).toContain('BANKER');
      expect(notification.message).toContain('OPEN');
      expect(notification.metadata).toEqual({ operationId: 'op-1' });
    });

    it('shows the current state OPEN when tie occurs at entry', () => {
      const snapshot = buildSnapshot({
        currentState: OperationState.OPEN,
      });

      const notification = factory.createForTieOccurred(
        snapshot,
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).toContain('Estado: OPEN');
    });

    it('shows the current state MG1 when tie occurs after first martingale', () => {
      const snapshot = buildSnapshot({
        currentState: OperationState.MARTINGALE_ONE,
        currentMartingale: 1,
      });

      const notification = factory.createForTieOccurred(
        snapshot,
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).toContain('Estado: MG1');
    });

    it('appends the distribution line when distribution is provided', () => {
      const distribution = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForTieOccurred(
        snapshot,
        NotificationChannelType.TELEGRAM,
        distribution,
      );

      expect(notification.message).toContain('🔵');
      expect(notification.message).toContain('🟡');
      expect(notification.message).toContain('🔴');
    });

    it('does not append the distribution line when distribution is undefined', () => {
      const snapshot = buildSnapshot();

      const notification = factory.createForTieOccurred(
        snapshot,
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).not.toContain('🔵');
    });
  });

  describe('createForHourlyReport', () => {
    it('builds an INFO notification with the Bogotá window in the title', () => {
      const report = buildReportSnapshot();

      const notification = factory.createForHourlyReport(
        report,
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.severity).toBe(NotificationSeverity.INFO);
      expect(notification.channel).toBe(NotificationChannelType.TELEGRAM);
      expect(notification.title).toContain('Reporte Horario');
      expect(notification.title).toContain('13:00');
      expect(notification.title).toContain('14:00');
    });

    it('includes the quick-glance metrics in the message', () => {
      const report = buildReportSnapshot({
        metrics: buildReportMetrics({
          alertsSent: 9,
          won: 9,
          lost: 0,
          effectivenessPct: 100,
          directWins: 4,
          martingaleOneWins: 4,
          martingaleTwoWins: 1,
          distribution: {
            directPct: 44.44,
            martingaleOnePct: 44.44,
            martingaleTwoPct: 11.11,
            lostPct: 0,
          },
        }),
      });

      const notification = factory.createForHourlyReport(
        report,
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).toContain('Alertas enviadas: 9');
      expect(notification.message).toContain('Ganadas: 9');
      expect(notification.message).toContain('Perdidas: 0');
      expect(notification.message).toContain('Efectividad: 100.00%');
      expect(notification.message).toContain('Directas: 4 - 44.44%');
      expect(notification.message).toContain('Martingala 1: 4 - 44.44%');
      expect(notification.message).toContain('Martingala 2: 1 - 11.11%');
      expect(notification.message).toContain('Perdidas: 0.00%');
    });

    it('does not include closed-operations count or exhausted-martingales breakdown', () => {
      const report = buildReportSnapshot();

      const notification = factory.createForHourlyReport(
        report,
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).not.toContain('Operaciones cerradas');
      expect(notification.message).not.toContain('Martingalas agotadas');
    });

    it('formats percentages with 2 decimals', () => {
      const report = buildReportSnapshot({
        metrics: buildReportMetrics({ effectivenessPct: 66.666 }),
      });

      const notification = factory.createForHourlyReport(
        report,
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).toContain('Efectividad: 66.67%');
    });
  });

  describe('createForSummaryReport', () => {
    it('builds an INFO notification titled as the full system summary', () => {
      const metrics = buildSummaryMetrics();

      const notification = factory.createForSummaryReport(
        metrics,
        new Date('2026-08-01T21:15:03.000Z'),
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.severity).toBe(NotificationSeverity.INFO);
      expect(notification.channel).toBe(NotificationChannelType.TELEGRAM);
      expect(notification.title).toContain('Resumen Completo del Sistema');
    });

    it('includes the general info section', () => {
      const metrics = buildSummaryMetrics({
        alertsSent: 20,
        closedOperations: 18,
        won: 15,
        lost: 3,
        effectivenessPct: 83.33,
      });

      const notification = factory.createForSummaryReport(
        metrics,
        new Date(),
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).toContain('Alertas enviadas: 20');
      expect(notification.message).toContain('Operaciones cerradas: 18');
      expect(notification.message).toContain('Ganadas: 15');
      expect(notification.message).toContain('Perdidas: 3');
      expect(notification.message).toContain('Efectividad: 83.33%');
      expect(notification.message).toContain('Tiempo activo: 2h 15min');
    });

    it('includes the win breakdown and percentage distribution sections', () => {
      const metrics = buildSummaryMetrics({
        directWins: 5,
        martingaleOneWins: 3,
        martingaleTwoWins: 2,
        martingalesExhausted: 1,
        distribution: {
          directPct: 50,
          martingaleOnePct: 30,
          martingaleTwoPct: 20,
          lostPct: 0,
        },
      });

      const notification = factory.createForSummaryReport(
        metrics,
        new Date(),
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).toContain('Directas: 5');
      expect(notification.message).toContain('Martingala 1: 3');
      expect(notification.message).toContain('Martingala 2: 2');
      expect(notification.message).toContain('Martingalas agotadas: 1');
      expect(notification.message).toContain('Directa: 50.00%');
      expect(notification.message).toContain('MG1: 30.00%');
      expect(notification.message).toContain('MG2: 20.00%');
    });

    it('includes streaks, martingale averages, ratio and hour highlights', () => {
      const metrics = buildSummaryMetrics({
        bestWinStreak: 6,
        worstLossStreak: 2,
        currentStreak: { result: 'WON', length: 4 },
        totalMartingalesUsed: 10,
        avgMartingalesPerWin: 1.5,
        winLossRatio: 4,
        bestAlertsHour: { label: '01/08 22:00', value: 7 },
        bestEffectivenessHour: { label: '01/08 22:00', value: 100 },
        worstEffectivenessHour: { label: '02/08 11:00', value: 20 },
      });

      const notification = factory.createForSummaryReport(
        metrics,
        new Date(),
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).toContain('Mejor racha de victorias: 6');
      expect(notification.message).toContain('Peor racha de derrotas: 2');
      expect(notification.message).toContain('Racha actual: 4 ganadas');
      expect(notification.message).toContain('Ratio Ganadas/Perdidas: 4.00');
      expect(notification.message).toContain('Martingalas usadas (total): 10');
      expect(notification.message).toContain('Promedio MG por victoria: 1.50');
      expect(notification.message).toContain(
        'Hora con más alertas: 01/08 22:00 (7)',
      );
      expect(notification.message).toContain(
        'Mejor hora (efectividad): 01/08 22:00 (100.00%)',
      );
      expect(notification.message).toContain(
        'Peor hora (efectividad): 02/08 11:00 (20.00%)',
      );
    });

    it('shows "∞" for the win/loss ratio when there are no losses', () => {
      const metrics = buildSummaryMetrics({ winLossRatio: Infinity });

      const notification = factory.createForSummaryReport(
        metrics,
        new Date(),
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).toContain('Ratio Ganadas/Perdidas: ∞');
    });

    it('shows "Sin datos" when there is no closed operation yet', () => {
      const metrics = buildSummaryMetrics({
        currentStreak: { result: 'NONE', length: 0 },
      });

      const notification = factory.createForSummaryReport(
        metrics,
        new Date(),
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).toContain('Racha actual: Sin datos');
    });

    it('omits hour-highlight lines entirely when there is no data for them', () => {
      const metrics = buildSummaryMetrics({
        bestAlertsHour: undefined,
        bestEffectivenessHour: undefined,
        worstEffectivenessHour: undefined,
      });

      const notification = factory.createForSummaryReport(
        metrics,
        new Date(),
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).not.toContain('Hora con más alertas');
      expect(notification.message).not.toContain('Mejor hora (efectividad)');
      expect(notification.message).not.toContain('Peor hora (efectividad)');
    });
  });
});
