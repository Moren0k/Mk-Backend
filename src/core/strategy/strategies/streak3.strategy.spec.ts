import { WinnerType } from '../../enums/winner-type.enum';
import { Game } from '../../history/game.type';
import { InMemoryHistorySnapshot } from '../../history/in-memory-history-snapshot';
import { StrategyExecutionGuard } from '../interfaces/strategy-execution-guard.interface';
import { StrategyRuntimeState } from '../interfaces/strategy-runtime-state.interface';
import { createStrategyContext } from '../types/strategy-context.type';
import { Streak3Strategy } from './streak3.strategy';

function buildGame(uuid: string, winner: WinnerType): Game {
  return {
    uuid,
    winner,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function buildExecutionGuard(
  canExecute = true,
): jest.Mocked<StrategyExecutionGuard> {
  return { canExecute: jest.fn().mockReturnValue(canExecute) };
}

/** Doble en memoria de StrategyRuntimeState, para no depender de NestJS. */
function buildRuntimeState(): StrategyRuntimeState {
  const state = new Map<string, unknown>();
  return {
    get: <T>(strategyId: string) => state.get(strategyId) as T | undefined,
    set: <T>(strategyId: string, value: T) => {
      state.set(strategyId, value);
    },
  };
}

function buildContext(
  games: ReadonlyArray<Game>,
  overrides: {
    execution?: StrategyExecutionGuard;
    runtimeState?: StrategyRuntimeState;
  } = {},
) {
  const currentGame = games[games.length - 1];
  const snapshot = new InMemoryHistorySnapshot(Object.freeze([...games]));
  return createStrategyContext(
    currentGame,
    snapshot,
    overrides.execution ?? buildExecutionGuard(),
    overrides.runtimeState ?? buildRuntimeState(),
    new Date('2026-08-01T00:05:00.000Z'),
  );
}

describe('Streak3Strategy', () => {
  let strategy: Streak3Strategy;

  beforeEach(() => {
    strategy = new Streak3Strategy();
  });

  it('is disabled (replaced by Streak4Strategy on the official channel)', () => {
    expect(strategy.enabled()).toBe(false);
  });

  it('recommends BANKER after three consecutive PLAYER wins', () => {
    const games = [
      buildGame('1', WinnerType.PLAYER),
      buildGame('2', WinnerType.PLAYER),
      buildGame('3', WinnerType.PLAYER),
    ];

    const result = strategy.evaluate(buildContext(games));

    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.recommendedWinner).toBe(WinnerType.BANKER);
      expect(result.streakWinner).toBe(WinnerType.PLAYER);
      expect(result.strategyId).toBe(strategy.id);
      expect(result.strategyName).toBe(strategy.name);
      expect(result.triggeredAt).toEqual(new Date('2026-08-01T00:05:00.000Z'));
      expect(result.metadata.streakGameUuids).toEqual(['1', '2', '3']);
      expect(result.triggerGameUuid).toBe('3');
    }
  });

  it('recommends PLAYER after three consecutive BANKER wins', () => {
    const games = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];

    const result = strategy.evaluate(buildContext(games));

    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.recommendedWinner).toBe(WinnerType.PLAYER);
      expect(result.streakWinner).toBe(WinnerType.BANKER);
    }
  });

  it('does not trigger when the last three winners are not all equal', () => {
    const games = [
      buildGame('1', WinnerType.PLAYER),
      buildGame('2', WinnerType.PLAYER),
      buildGame('3', WinnerType.BANKER),
    ];

    const result = strategy.evaluate(buildContext(games));

    expect(result).toEqual({ triggered: false });
  });

  it('does not trigger on three consecutive TIE results', () => {
    const games = [
      buildGame('1', WinnerType.TIE),
      buildGame('2', WinnerType.TIE),
      buildGame('3', WinnerType.TIE),
    ];

    const result = strategy.evaluate(buildContext(games));

    expect(result).toEqual({ triggered: false });
  });

  it('does not trigger nor throw when a TIE breaks an otherwise matching streak', () => {
    const games = [
      buildGame('1', WinnerType.PLAYER),
      buildGame('2', WinnerType.TIE),
      buildGame('3', WinnerType.PLAYER),
    ];

    expect(() => strategy.evaluate(buildContext(games))).not.toThrow();
    expect(strategy.evaluate(buildContext(games))).toEqual({
      triggered: false,
    });
  });

  it('does not trigger with fewer than three games in history', () => {
    const games = [
      buildGame('1', WinnerType.PLAYER),
      buildGame('2', WinnerType.PLAYER),
    ];

    const result = strategy.evaluate(buildContext(games));

    expect(result).toEqual({ triggered: false });
  });

  it('only evaluates the current streak, ignoring older unrelated history', () => {
    const games = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.PLAYER),
      buildGame('4', WinnerType.PLAYER),
      buildGame('5', WinnerType.PLAYER),
    ];

    const result = strategy.evaluate(buildContext(games));

    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.recommendedWinner).toBe(WinnerType.BANKER);
      expect(result.streakWinner).toBe(WinnerType.PLAYER);
      expect(result.metadata.streakGameUuids).toEqual(['3', '4', '5']);
    }
  });

  it('does not trigger when the execution guard denies canExecute, even with a matching streak', () => {
    const games = [
      buildGame('1', WinnerType.PLAYER),
      buildGame('2', WinnerType.PLAYER),
      buildGame('3', WinnerType.PLAYER),
    ];

    const result = strategy.evaluate(
      buildContext(games, { execution: buildExecutionGuard(false) }),
    );

    expect(result).toEqual({ triggered: false });
  });

  it('asks the execution guard with its own strategy id before evaluating the streak', () => {
    const games = [
      buildGame('1', WinnerType.PLAYER),
      buildGame('2', WinnerType.PLAYER),
      buildGame('3', WinnerType.PLAYER),
    ];
    const execution = buildExecutionGuard(true);

    strategy.evaluate(buildContext(games, { execution }));

    expect(execution.canExecute).toHaveBeenCalledWith(strategy.id);
  });

  describe('one signal per streak (not a sliding window)', () => {
    it('does not trigger again while the same streak keeps extending, even once execution is allowed again', () => {
      const runtimeState = buildRuntimeState();
      const games = [
        buildGame('1', WinnerType.PLAYER),
        buildGame('2', WinnerType.PLAYER),
        buildGame('3', WinnerType.PLAYER),
      ];

      const first = strategy.evaluate(buildContext(games, { runtimeState }));
      expect(first.triggered).toBe(true);

      // La racha sigue extendiéndose (4, 5, 6...) con el mismo winner: nunca
      // vuelve a disparar, sin importar que canExecute ya vuelva a permitir
      // (p. ej. porque la Operation anterior ya se resolvió).
      for (const uuid of ['4', '5', '6']) {
        games.push(buildGame(uuid, WinnerType.PLAYER));
        const result = strategy.evaluate(buildContext(games, { runtimeState }));
        expect(result).toEqual({ triggered: false });
      }
    });

    it('triggers again once a TIE ends the streak and a new one of length 3 forms', () => {
      const runtimeState = buildRuntimeState();
      const games = [
        buildGame('1', WinnerType.PLAYER),
        buildGame('2', WinnerType.PLAYER),
        buildGame('3', WinnerType.PLAYER),
      ];
      expect(
        strategy.evaluate(buildContext(games, { runtimeState })).triggered,
      ).toBe(true);

      games.push(buildGame('4', WinnerType.PLAYER));
      expect(
        strategy.evaluate(buildContext(games, { runtimeState })).triggered,
      ).toBe(false);

      games.push(buildGame('5', WinnerType.TIE));
      expect(
        strategy.evaluate(buildContext(games, { runtimeState })).triggered,
      ).toBe(false);

      games.push(buildGame('6', WinnerType.BANKER));
      games.push(buildGame('7', WinnerType.BANKER));
      expect(
        strategy.evaluate(buildContext(games, { runtimeState })).triggered,
      ).toBe(false);

      games.push(buildGame('8', WinnerType.BANKER));
      const result = strategy.evaluate(buildContext(games, { runtimeState }));
      expect(result.triggered).toBe(true);
      if (result.triggered) {
        expect(result.recommendedWinner).toBe(WinnerType.PLAYER);
        expect(result.streakWinner).toBe(WinnerType.BANKER);
        expect(result.metadata.streakGameUuids).toEqual(['6', '7', '8']);
      }
    });

    it('triggers again once a change of winner (without a TIE) ends the streak', () => {
      const runtimeState = buildRuntimeState();
      const games = [
        buildGame('1', WinnerType.PLAYER),
        buildGame('2', WinnerType.PLAYER),
        buildGame('3', WinnerType.PLAYER),
      ];
      expect(
        strategy.evaluate(buildContext(games, { runtimeState })).triggered,
      ).toBe(true);

      games.push(buildGame('4', WinnerType.BANKER));
      games.push(buildGame('5', WinnerType.BANKER));
      expect(
        strategy.evaluate(buildContext(games, { runtimeState })).triggered,
      ).toBe(false);

      games.push(buildGame('6', WinnerType.BANKER));
      const result = strategy.evaluate(buildContext(games, { runtimeState }));
      expect(result.triggered).toBe(true);
      if (result.triggered) {
        expect(result.recommendedWinner).toBe(WinnerType.PLAYER);
        expect(result.streakWinner).toBe(WinnerType.BANKER);
      }
    });

    it('keeps each strategyId isolated in runtimeState', () => {
      const runtimeState = buildRuntimeState();
      runtimeState.set('some-other-strategy', 'unrelated-value');

      const games = [
        buildGame('1', WinnerType.PLAYER),
        buildGame('2', WinnerType.PLAYER),
        buildGame('3', WinnerType.PLAYER),
      ];

      const result = strategy.evaluate(buildContext(games, { runtimeState }));

      expect(result.triggered).toBe(true);
      expect(runtimeState.get('some-other-strategy')).toBe('unrelated-value');
    });
  });
});
