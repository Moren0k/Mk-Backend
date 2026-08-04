import { NotificationChannelType } from '../enums/notification-channel-type.enum';
import { NotificationSeverity } from '../enums/notification-severity.enum';
import { OperationState } from '../enums/operation-state.enum';
import { WinnerType } from '../enums/winner-type.enum';
import type { DistributionMetricValue } from '../metrics/types/distribution-metric-value.type';
import { OperationSnapshot } from '../operation/types/operation-snapshot.type';
import { ReportMetricsSnapshot } from '../reporting/types/report-metrics-snapshot.type';
import { ReportSnapshot } from '../reporting/types/report-snapshot.type';
import { SummaryMetricsSnapshot } from '../reporting/types/summary-metrics-snapshot.type';
import { NotificationFactory } from './notification.factory';

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

function buildSnapshot(
  overrides: Partial<OperationSnapshot> = {},
): OperationSnapshot {
  return {
    operationId: 'op-1',
    strategyId: 'streak-3',
    recommendedWinner: WinnerType.PLAYER,
    streakWinner: WinnerType.BANKER,
    currentState: OperationState.OPEN,
    currentMartingale: 0,
    maxMartingales: 2,
    openedAt: new Date('2026-08-01T21:15:03.000Z'),
    closedAt: undefined,
    reason: 'Racha de 3 resultados consecutivos de BANKER.',
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

  describe('createForOperationOpened', () => {
    it('shows streakWinner ball in INGRESAR and recommendedWinner ball in APUESTA', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.severity).toBe(NotificationSeverity.INFO);
      expect(notification.title).toBe('');
      expect(notification.message).toContain(
        '\u{1F4A3} INGRESAR DESPUES DE :\u{1F534} B',
      );
      expect(notification.message).toContain(
        '\u{1F525}APUESTA EN: \u{1F535} P',
      );
      expect(notification.message).toContain('\u{1F501} MARTINGALAS MAXIMO: 2');
    });

    it('shows balls even when distribution is undefined', () => {
      const snapshot = buildSnapshot();

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).toContain('INGRESAR DESPUES DE :');
      expect(notification.message).toContain('APUESTA EN:');
    });
  });

  describe('createForMartingaleOneReached', () => {
    it('shows recommendedWinner as ball', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForMartingaleOneReached(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.severity).toBe(NotificationSeverity.WARNING);
      expect(notification.title).toBe('');
      expect(notification.message).toContain('DOBLA TU APUESTA ANTERIOR AL:');
      expect(notification.metadata).toEqual({
        operationId: 'op-1',
        strategyId: 'streak-3',
        martingaleNumber: 1,
      });
    });
  });

  describe('createForMartingaleTwoReached', () => {
    it('shows recommendedWinner as ball', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForMartingaleTwoReached(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.message).toContain('DOBLA TU APUESTA ANTERIOR AL:');
      expect(notification.metadata).toEqual({
        operationId: 'op-1',
        strategyId: 'streak-3',
        martingaleNumber: 2,
      });
    });
  });

  describe('createForOperationWon', () => {
    it('builds SUCCESS notification', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot({
        currentState: OperationState.WON,
        currentMartingale: 1,
      });

      const notification = factory.createForOperationWon(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.severity).toBe(NotificationSeverity.SUCCESS);
      expect(notification.title).toBe('');
      expect(notification.message).toContain('VICTORIA EN: PLAYER');
      expect(notification.message).toContain('MARTINGALAS FINAL: 1');
    });
  });

  describe('createForOperationLost', () => {
    it('shows recommendedWinner as ball in DERROTA', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot({
        currentState: OperationState.LOST,
        currentMartingale: 2,
      });

      const notification = factory.createForOperationLost(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.severity).toBe(NotificationSeverity.ERROR);
      expect(notification.title).toBe('');
      expect(notification.message).toContain('MARTINGALAS FINAL: 2');
    });
  });

  describe('createForTieOccurred', () => {
    it('shows recommendedWinner as ball', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForTieOccurred(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.severity).toBe(NotificationSeverity.WARNING);
      expect(notification.title).toBe('');
      expect(notification.message).toContain('APUESTA LO ANTERIOR AL:');
    });
  });

  describe('distribution line', () => {
    it('appends the distribution line when provided', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.message).toContain(
        '\u{1F535} 48.50%  \u{1F7E1} 12.00%  \u{1F534} 39.50%',
      );
    });

    it('does not append distribution numbers when distribution is undefined', () => {
      const snapshot = buildSnapshot();

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).not.toContain('48.50%');
    });

    it('maintains distribution emoji order', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      const blueAt = notification.message.indexOf('48.50%');
      const yellowAt = notification.message.indexOf('12.00%');
      const redAt = notification.message.indexOf('39.50%');

      expect(blueAt).toBeLessThan(yellowAt);
      expect(yellowAt).toBeLessThan(redAt);
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
