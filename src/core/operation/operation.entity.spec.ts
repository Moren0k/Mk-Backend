import { OperationState } from '../enums/operation-state.enum';
import { WinnerType } from '../enums/winner-type.enum';
import { Game } from '../history/game.type';
import { StrategySignal } from '../strategy/types/strategy-signal.type';
import { Operation } from './operation.entity';

function buildSignal(overrides: Partial<StrategySignal> = {}): StrategySignal {
  return {
    triggered: true,
    strategyId: 'streak-3',
    strategyName: 'Streak3Strategy',
    triggeredAt: new Date('2026-08-01T00:00:00.000Z'),
    recommendedWinner: WinnerType.BANKER,
    streakWinner: WinnerType.PLAYER,
    maxMartingales: 2,
    triggerGameUuid: 'trigger-game',
    reason: 'Racha de 3 PLAYER consecutivos.',
    metadata: {},
    ...overrides,
  };
}

function buildGame(uuid: string, winner: WinnerType): Game {
  return {
    uuid,
    winner,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('Operation', () => {
  it('opens in state OPEN, with martingale 0 and no closedAt', () => {
    const operation = Operation.open(buildSignal());

    expect(operation.currentState).toBe(OperationState.OPEN);
    expect(operation.currentMartingale).toBe(0);
    expect(operation.closedAt).toBeUndefined();
    expect(operation.history).toEqual([]);
    expect(operation.isFinished()).toBe(false);
  });

  it('copies identifying data from the StrategySignal', () => {
    const signal = buildSignal({ strategyId: 'abc', reason: 'porque sí' });
    const operation = Operation.open(signal);

    expect(operation.strategyId).toBe('abc');
    expect(operation.recommendedWinner).toBe(signal.recommendedWinner);
    expect(operation.reason).toBe('porque sí');
    expect(operation.operationId).toEqual(expect.any(String));
  });

  it('wins immediately when the first game matches the recommended winner', () => {
    const operation = Operation.open(
      buildSignal({ recommendedWinner: WinnerType.BANKER }),
    );

    const game = buildGame('1', WinnerType.BANKER);
    const result = operation.update(game);

    expect(result.stateChanged).toBe(true);
    expect(result.newState).toBe(OperationState.WON);
    expect(result.completed).toBe(true);
    expect(operation.currentState).toBe(OperationState.WON);
    expect(operation.currentMartingale).toBe(0);
    expect(operation.isFinished()).toBe(true);
    expect(operation.closedAt).toBeInstanceOf(Date);
  });

  it('advances to MG1 on the first loss, then wins on MG1', () => {
    const operation = Operation.open(
      buildSignal({ recommendedWinner: WinnerType.BANKER }),
    );

    const firstLoss = operation.update(buildGame('1', WinnerType.PLAYER));
    expect(firstLoss.stateChanged).toBe(true);
    expect(firstLoss.newState).toBe(OperationState.MARTINGALE_ONE);
    expect(firstLoss.completed).toBe(false);
    expect(operation.currentMartingale).toBe(1);

    const win = operation.update(buildGame('2', WinnerType.BANKER));
    expect(win.newState).toBe(OperationState.WON);
    expect(win.completed).toBe(true);
  });

  it('advances OPEN -> MG1 -> MG2 -> WON', () => {
    const operation = Operation.open(
      buildSignal({ recommendedWinner: WinnerType.BANKER }),
    );

    operation.update(buildGame('1', WinnerType.PLAYER));
    operation.update(buildGame('2', WinnerType.PLAYER));
    expect(operation.currentState).toBe(OperationState.MARTINGALE_TWO);
    expect(operation.currentMartingale).toBe(2);

    const result = operation.update(buildGame('3', WinnerType.BANKER));

    expect(result.newState).toBe(OperationState.WON);
    expect(result.completed).toBe(true);
  });

  it('loses after exhausting every martingale', () => {
    const operation = Operation.open(
      buildSignal({ recommendedWinner: WinnerType.BANKER, maxMartingales: 2 }),
    );

    operation.update(buildGame('1', WinnerType.PLAYER));
    operation.update(buildGame('2', WinnerType.PLAYER));
    const result = operation.update(buildGame('3', WinnerType.PLAYER));

    expect(result.stateChanged).toBe(true);
    expect(result.newState).toBe(OperationState.LOST);
    expect(result.completed).toBe(true);
    expect(operation.isFinished()).toBe(true);
    expect(operation.closedAt).toBeInstanceOf(Date);
  });

  it('respects a per-strategy maxMartingales of 0 (loses on the first miss)', () => {
    const operation = Operation.open(
      buildSignal({ recommendedWinner: WinnerType.BANKER, maxMartingales: 0 }),
    );

    const result = operation.update(buildGame('1', WinnerType.PLAYER));

    expect(result.newState).toBe(OperationState.LOST);
    expect(result.completed).toBe(true);
  });

  it('ignores a TIE: no state change, no martingale consumed, never finishes, but reports tieOccurred', () => {
    const operation = Operation.open(
      buildSignal({ recommendedWinner: WinnerType.BANKER }),
    );

    const result = operation.update(buildGame('1', WinnerType.TIE));

    expect(result.stateChanged).toBe(false);
    expect(result.tieOccurred).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.transition).toBeUndefined();
    expect(operation.currentState).toBe(OperationState.OPEN);
    expect(operation.currentMartingale).toBe(0);
    expect(operation.isFinished()).toBe(false);
    expect(operation.history).toEqual([]);
  });

  it('ignores multiple consecutive TIE results in a row', () => {
    const operation = Operation.open(
      buildSignal({ recommendedWinner: WinnerType.BANKER }),
    );

    operation.update(buildGame('1', WinnerType.TIE));
    operation.update(buildGame('2', WinnerType.TIE));
    operation.update(buildGame('3', WinnerType.TIE));

    expect(operation.currentState).toBe(OperationState.OPEN);
    expect(operation.history).toEqual([]);

    // A TIE mid-streak must not interfere with a later, real transition.
    const result = operation.update(buildGame('4', WinnerType.BANKER));
    expect(result.newState).toBe(OperationState.WON);
  });

  it('ignores the triggering game if it is ever replayed as an update, regardless of its winner', () => {
    const operation = Operation.open(
      buildSignal({
        recommendedWinner: WinnerType.BANKER,
        triggerGameUuid: 'the-trigger',
      }),
    );

    // Even though this game's winner would normally count as a loss
    // (PLAYER != BANKER) and advance the martingale, it must be ignored
    // because its uuid matches the game that opened this Operation. This
    // is what makes the engine correct regardless of subscriber order
    // (see app.module.ts and StrategySignal.triggerGameUuid).
    const result = operation.update(
      buildGame('the-trigger', WinnerType.PLAYER),
    );

    expect(result.stateChanged).toBe(false);
    expect(result.tieOccurred).toBe(false);
    expect(result.transition).toBeUndefined();
    expect(operation.currentState).toBe(OperationState.OPEN);
    expect(operation.currentMartingale).toBe(0);
    expect(operation.history).toEqual([]);

    // A later, genuinely different game is processed normally.
    const nextResult = operation.update(buildGame('other', WinnerType.PLAYER));
    expect(nextResult.stateChanged).toBe(true);
    expect(nextResult.newState).toBe(OperationState.MARTINGALE_ONE);
  });

  it('does not do anything once finished, even if update() is called again', () => {
    const operation = Operation.open(
      buildSignal({ recommendedWinner: WinnerType.BANKER }),
    );
    operation.update(buildGame('1', WinnerType.BANKER));

    const afterFinished = operation.update(buildGame('2', WinnerType.PLAYER));

    expect(afterFinished.stateChanged).toBe(false);
    expect(afterFinished.tieOccurred).toBe(false);
    expect(afterFinished.transition).toBeUndefined();
    expect(operation.currentState).toBe(OperationState.WON);
    expect(operation.history).toHaveLength(1);
  });

  describe('internal history', () => {
    it('only records games that actually changed the state, skipping ties in history', () => {
      const operation = Operation.open(
        buildSignal({ recommendedWinner: WinnerType.BANKER }),
      );

      operation.update(buildGame('1', WinnerType.PLAYER)); // -> MG1
      operation.update(buildGame('tie-1', WinnerType.TIE)); // ignored
      operation.update(buildGame('2', WinnerType.PLAYER)); // -> MG2
      operation.update(buildGame('tie-2', WinnerType.TIE)); // ignored
      operation.update(buildGame('3', WinnerType.BANKER)); // -> WON

      expect(operation.history).toHaveLength(3);
      expect(operation.history.map((t) => t.game.uuid)).toEqual([
        '1',
        '2',
        '3',
      ]);
    });

    it('records from/to/game/reason/timestamp for each transition', () => {
      const operation = Operation.open(
        buildSignal({ recommendedWinner: WinnerType.BANKER }),
      );
      const losingGame = buildGame('1', WinnerType.PLAYER);

      operation.update(losingGame);

      expect(operation.history).toEqual([
        {
          from: OperationState.OPEN,
          to: OperationState.MARTINGALE_ONE,
          game: losingGame,
          timestamp: expect.any(Date) as Date,
          reason: expect.any(String) as string,
        },
      ]);
    });

    it('exposes a frozen, defensive copy of the history', () => {
      const operation = Operation.open(
        buildSignal({ recommendedWinner: WinnerType.BANKER }),
      );
      operation.update(buildGame('1', WinnerType.BANKER));

      const history = operation.history as unknown as unknown[];

      expect(Object.isFrozen(history)).toBe(true);
      expect(() => history.push({})).toThrow(TypeError);
    });
  });

  describe('cancel()', () => {
    it('transitions an open operation to CANCELLED, with no triggering game', () => {
      const operation = Operation.open(
        buildSignal({ recommendedWinner: WinnerType.BANKER }),
      );

      const result = operation.cancel('cancelada manualmente desde la API');

      expect(result.stateChanged).toBe(true);
      expect(result.newState).toBe(OperationState.CANCELLED);
      expect(result.completed).toBe(true);
      expect(operation.currentState).toBe(OperationState.CANCELLED);
      expect(operation.isFinished()).toBe(true);
      expect(operation.closedAt).toBeInstanceOf(Date);
      expect(operation.history).toEqual([
        {
          from: OperationState.OPEN,
          to: OperationState.CANCELLED,
          game: undefined,
          timestamp: expect.any(Date) as Date,
          reason: 'cancelada manualmente desde la API',
        },
      ]);
    });

    it('cancels an operation mid-martingale, preserving its currentMartingale count', () => {
      const operation = Operation.open(
        buildSignal({ recommendedWinner: WinnerType.BANKER }),
      );
      operation.update(buildGame('1', WinnerType.PLAYER));

      operation.cancel('cancelada manualmente');

      expect(operation.currentState).toBe(OperationState.CANCELLED);
      expect(operation.currentMartingale).toBe(1);
    });

    it('does nothing once the operation already finished', () => {
      const operation = Operation.open(
        buildSignal({ recommendedWinner: WinnerType.BANKER }),
      );
      operation.update(buildGame('1', WinnerType.BANKER));

      const result = operation.cancel('demasiado tarde');

      expect(result.stateChanged).toBe(false);
      expect(operation.currentState).toBe(OperationState.WON);
      expect(operation.history).toHaveLength(1);
    });
  });

  describe('final states', () => {
    it('WON is a final state', () => {
      const operation = Operation.open(
        buildSignal({ recommendedWinner: WinnerType.BANKER }),
      );
      operation.update(buildGame('1', WinnerType.BANKER));

      expect(operation.isFinished()).toBe(true);
    });

    it('LOST is a final state', () => {
      const operation = Operation.open(
        buildSignal({
          recommendedWinner: WinnerType.BANKER,
          maxMartingales: 0,
        }),
      );
      operation.update(buildGame('1', WinnerType.PLAYER));

      expect(operation.isFinished()).toBe(true);
    });
  });

  it('toSnapshot() reflects the current, up-to-date state', () => {
    const operation = Operation.open(
      buildSignal({ recommendedWinner: WinnerType.BANKER }),
    );
    operation.update(buildGame('1', WinnerType.PLAYER));

    const snapshot = operation.toSnapshot();

    expect(snapshot).toEqual({
      operationId: operation.operationId,
      strategyId: operation.strategyId,
      recommendedWinner: operation.recommendedWinner,
      streakWinner: operation.streakWinner,
      currentState: OperationState.MARTINGALE_ONE,
      currentMartingale: 1,
      maxMartingales: 2,
      openedAt: operation.openedAt,
      closedAt: undefined,
      reason: operation.reason,
      history: operation.history,
    });
  });
});
