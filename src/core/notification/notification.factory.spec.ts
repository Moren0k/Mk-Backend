import { NotificationChannelType } from '../enums/notification-channel-type.enum';
import { NotificationSeverity } from '../enums/notification-severity.enum';
import { OperationState } from '../enums/operation-state.enum';
import { WinnerType } from '../enums/winner-type.enum';
import type { DistributionMetricValue } from '../metrics/types/distribution-metric-value.type';
import { OperationSnapshot } from '../operation/types/operation-snapshot.type';
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
});
