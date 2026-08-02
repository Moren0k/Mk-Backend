import { NotificationChannelType } from '../enums/notification-channel-type.enum';
import { NotificationSeverity } from '../enums/notification-severity.enum';
import { OperationState } from '../enums/operation-state.enum';
import { WinnerType } from '../enums/winner-type.enum';
import type { DistributionMetricValue } from '../metrics/types/distribution-metric-value.type';
import { Game } from '../history/game.type';
import { OperationSnapshot } from '../operation/types/operation-snapshot.type';
import { OperationTransition } from '../operation/types/operation-transition.type';
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

      expect(notification.message).toContain(
        '🔵 48.50%  🟡 12.00%  🔴 39.50%',
      );
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
});
