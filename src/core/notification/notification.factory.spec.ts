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

describe('NotificationFactory', () => {
  let factory: NotificationFactory;

  beforeEach(() => {
    factory = new NotificationFactory();
  });

  describe('createForOperationOpened', () => {
    it('builds an INFO notification with the new format', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.severity).toBe(NotificationSeverity.INFO);
      expect(notification.title).toBe('');
      expect(notification.message).toContain('🚨 NUEVA ENTRADA 🚨');
      expect(notification.message).toContain('🎯 JUEGO: Bac Bo - Evolution');
      expect(notification.message).toContain('📊 PATRON: streak-3');
      expect(notification.message).toContain('💣 INGRESAR DESPUES DE :BANKER');
      expect(notification.message).toContain('🔥APUESTA EN: BANKER');
      expect(notification.message).toContain('🔁 MARTINGALAS MAXIMO: 2');
      expect(notification.metadata).toEqual({ operationId: 'op-1' });
    });

    it('shows --% when distribution is undefined', () => {
      const snapshot = buildSnapshot();

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).toContain('INGRESAR DESPUES DE :BANKER --%');
      expect(notification.message).toContain('APUESTA EN: BANKER (--%)');
      expect(notification.message).not.toContain('🔵');
    });

    it('shows playerPct when recommendedWinner is PLAYER', () => {
      const dist = buildDistribution({ playerPct: 55.0, bankerPct: 40.0 });
      const snapshot = buildSnapshot({
        recommendedWinner: WinnerType.PLAYER,
      });

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.message).toContain(
        'INGRESAR DESPUES DE :PLAYER 55.00%',
      );
      expect(notification.message).toContain('APUESTA EN: PLAYER (55.00%)');
    });
  });

  describe('createForMartingaleOneReached', () => {
    it('builds a WARNING notification with martingale format', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForMartingaleOneReached(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.severity).toBe(NotificationSeverity.WARNING);
      expect(notification.title).toBe('');
      expect(notification.message).toContain('🔁 MARTINGALA 1');
      expect(notification.message).toContain('📊 PATRON: streak-3');
      expect(notification.message).toContain(
        '🔥 DOBLA TU APUESTA ANTERIOR AL: BANKER',
      );
      expect(notification.metadata).toEqual({
        operationId: 'op-1',
        martingaleNumber: 1,
      });
    });
  });

  describe('createForMartingaleTwoReached', () => {
    it('builds a WARNING notification with martingale 2 format', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForMartingaleTwoReached(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.severity).toBe(NotificationSeverity.WARNING);
      expect(notification.title).toBe('');
      expect(notification.message).toContain('🔁 MARTINGALA 2');
      expect(notification.metadata).toEqual({
        operationId: 'op-1',
        martingaleNumber: 2,
      });
    });
  });

  describe('createForOperationWon', () => {
    it('builds a SUCCESS notification with victory format', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot({
        currentState: OperationState.WON,
        currentMartingale: 1,
        closedAt: new Date('2026-08-01T21:20:00.000Z'),
      });

      const notification = factory.createForOperationWon(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.severity).toBe(NotificationSeverity.SUCCESS);
      expect(notification.title).toBe('');
      expect(notification.message).toContain('✅ OPERACION GANADA ✅');
      expect(notification.message).toContain('🏆 VICTORIA EN: BANKER');
      expect(notification.message).toContain('🔁 MARTINGALAS FINAL: 1');
      expect(notification.message).toContain('💸 VAMOS POR MAS 💸');
    });
  });

  describe('createForOperationLost', () => {
    it('builds an ERROR notification with defeat format', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot({
        currentState: OperationState.LOST,
        currentMartingale: 2,
        closedAt: new Date('2026-08-01T21:25:00.000Z'),
      });

      const notification = factory.createForOperationLost(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.severity).toBe(NotificationSeverity.ERROR);
      expect(notification.title).toBe('');
      expect(notification.message).toContain('❌ OPERACION PERDIDA ❌');
      expect(notification.message).toContain('☠️ DERROTA: BANKER');
      expect(notification.message).toContain('🔁 MARTINGALAS FINAL: 2');
      expect(notification.message).toContain(
        '🧊 MENTE FRIA, NOS RECUPERAMOS EN LA PROXIMA',
      );
    });
  });

  describe('createForTieOccurred', () => {
    it('builds a WARNING notification with tie format', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForTieOccurred(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.severity).toBe(NotificationSeverity.WARNING);
      expect(notification.title).toBe('');
      expect(notification.message).toContain('🟰 EMPATE 🟰');
      expect(notification.message).toContain(
        '🔥 APUESTA LO ANTERIOR AL: BANKER',
      );
      expect(notification.message).toContain('💸 ESTA GANAREMOS 💸');
    });
  });

  describe('distribution line', () => {
    it('appends the distribution line to notifications when provided', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      expect(notification.message).toContain('🔵 48.50%  🟡 12.00%  🔴 39.50%');
    });

    it('does not append the distribution line when undefined', () => {
      const snapshot = buildSnapshot();

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
      );

      expect(notification.message).not.toContain('🔵');
      expect(notification.message).not.toContain('🟡');
      expect(notification.message).not.toContain('🔴');
    });

    it('maintains mandatory emoji order: 🔵 → 🟡 → 🔴', () => {
      const dist = buildDistribution();
      const snapshot = buildSnapshot();

      const notification = factory.createForOperationOpened(
        snapshot,
        NotificationChannelType.TELEGRAM,
        dist,
      );

      const blueIndex = notification.message.indexOf('🔵');
      const yellowIndex = notification.message.indexOf('🟡');
      const redIndex = notification.message.indexOf('🔴');

      expect(blueIndex).toBeLessThan(yellowIndex);
      expect(yellowIndex).toBeLessThan(redIndex);
    });
  });
});
