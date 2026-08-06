import { WinnerType } from '../../enums/winner-type.enum';
import { Game } from '../../history/game.type';
import { InMemoryHistorySnapshot } from '../../history/in-memory-history-snapshot';
import { StrategyExecutionGuard } from '../interfaces/strategy-execution-guard.interface';
import { StrategyRuntimeState } from '../interfaces/strategy-runtime-state.interface';
import {
  createStrategyContext,
  StrategyContext,
} from '../types/strategy-context.type';
import { Alternancia34Strategy } from './alternancia34.strategy';
import { StrategyResult } from '../types/strategy-result.type';

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

function buildRuntimeState(): StrategyRuntimeState {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string) => store.get(key) as T | undefined,
    set: <T>(key: string, value: T) => {
      store.set(key, value);
    },
  };
}

function buildContext(
  games: ReadonlyArray<Game>,
  overrides: {
    execution?: jest.Mocked<StrategyExecutionGuard>;
    runtimeState?: StrategyRuntimeState;
  } = {},
): StrategyContext {
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

function getResultSignal(result: StrategyResult) {
  if (!result.triggered) throw new Error('Expected signal, got NO_SIGNAL');
  return result;
}

function getScoreFromMetadata(result: StrategyResult): number {
  return getResultSignal(result).metadata.score as number;
}

function getZoneFromMetadata(result: StrategyResult): string {
  return getResultSignal(result).metadata.zone as string;
}

describe('Alternancia34Strategy', () => {
  let strategy: Alternancia34Strategy;

  beforeEach(() => {
    strategy = new Alternancia34Strategy();
  });

  // ── Identidad y estado inicial ──

  it('is enabled after implementation', () => {
    expect(strategy.enabled()).toBe(true);
  });

  it('has the correct strategy id and name', () => {
    expect(strategy.id).toBe('alternancia-34');
    expect(strategy.name).toBe('Alternancia34Strategy');
  });

  it('starts with score 85 and zone AGRESIVA', () => {
    const games = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const result = strategy.evaluate(buildContext(games));

    expect(result.triggered).toBe(true);
    expect(getZoneFromMetadata(result)).toBe('AGRESIVA');
    expect(getScoreFromMetadata(result)).toBe(85);
  });

  // ── Bloqueo por operación activa ──

  it('returns NO_SIGNAL when canExecute is false (operation in flight)', () => {
    const guard = buildExecutionGuard(false);
    const games = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const ctx = buildContext(games, { execution: guard });
    const result = strategy.evaluate(ctx);

    expect(result.triggered).toBe(false);
  });

  // ── Scoring: victorias ──

  it('scores +5 after a single win resolves', () => {
    const runtimeState = buildRuntimeState();
    const guard = buildExecutionGuard(true);

    const games123 = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const ctx123 = buildContext(games123, { runtimeState, execution: guard });
    const signal123 = strategy.evaluate(ctx123);
    expect(signal123.triggered).toBe(true);
    const recommended = getResultSignal(signal123).recommendedWinner;

    const game4 = buildGame('4', recommended);
    const games1234 = [...games123, game4];
    const ctx1234 = buildContext(games1234, { runtimeState, execution: guard });
    const result1234 = strategy.evaluate(ctx1234);

    expect(result1234.triggered).toBe(false);
    const state4 = runtimeState.get<Record<string, unknown>>('alternancia-34');
    expect(state4).toBeDefined();
    expect((state4 as Record<string, number>).score).toBe(90);
  });

  it('scores +10 after two consecutive wins resolve', () => {
    const runtimeState = buildRuntimeState();
    const guard = buildExecutionGuard(true);

    // First signal
    const g1 = [
      buildGame('1', WinnerType.PLAYER),
      buildGame('2', WinnerType.PLAYER),
      buildGame('3', WinnerType.PLAYER),
    ];
    const ctx1 = buildContext(g1, { runtimeState, execution: guard });
    const sig1 = strategy.evaluate(ctx1);
    expect(sig1.triggered).toBe(true);
    const rec1 = getResultSignal(sig1).recommendedWinner;

    // Win operation 1
    const g2 = [...g1, buildGame('4', rec1)];
    const ctx2 = buildContext(g2, { runtimeState, execution: guard });
    strategy.evaluate(ctx2);

    // Second signal (streak already broken, new streak forms)
    const g3 = [
      ...g2,
      buildGame('5', rec1),
      buildGame('6', rec1),
      buildGame('7', rec1),
    ];
    const ctx3 = buildContext(g3, { runtimeState, execution: guard });
    const sig3 = strategy.evaluate(ctx3);
    expect(sig3.triggered).toBe(true);
    const rec3 = getResultSignal(sig3).recommendedWinner;
    const opp3 =
      rec3 === WinnerType.BANKER ? WinnerType.PLAYER : WinnerType.BANKER;
    expect(opp3).toBe(rec1);

    // Win operation 2 (second consecutive)
    const g4 = [...g3, buildGame('8', rec3)];
    const ctx4 = buildContext(g4, { runtimeState, execution: guard });
    strategy.evaluate(ctx4);

    const state = runtimeState.get<Record<string, unknown>>('alternancia-34');
    expect((state as Record<string, number>).score).toBe(100);
  });

  // ── Scoring: derrotas ──

  it('scores -20 after a single loss resolves', () => {
    const runtimeState = buildRuntimeState();
    const guard = buildExecutionGuard(true);

    const games123 = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const ctx123 = buildContext(games123, { runtimeState, execution: guard });
    const sig = strategy.evaluate(ctx123);
    expect(sig.triggered).toBe(true);
    const rec = getResultSignal(sig).recommendedWinner;
    const opp =
      rec === WinnerType.BANKER ? WinnerType.PLAYER : WinnerType.BANKER;

    const game4 = buildGame('4', opp);
    const games1234 = [...games123, game4];
    const ctx1234 = buildContext(games1234, { runtimeState, execution: guard });
    strategy.evaluate(ctx1234);

    const state = runtimeState.get<Record<string, unknown>>('alternancia-34');
    expect((state as Record<string, number>).score).toBe(65);
  });

  it('scores -25 after two consecutive losses resolve', () => {
    const runtimeState = buildRuntimeState();
    const guard = buildExecutionGuard(true);

    // First signal → loss
    const g1 = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const ctx1 = buildContext(g1, { runtimeState, execution: guard });
    const sig1 = strategy.evaluate(ctx1);
    expect(sig1.triggered).toBe(true);
    const rec1 = getResultSignal(sig1).recommendedWinner;
    const opp1 =
      rec1 === WinnerType.BANKER ? WinnerType.PLAYER : WinnerType.BANKER;

    // Loss (BANKER continues)
    const g2 = [...g1, buildGame('4', opp1)];
    const ctx2 = buildContext(g2, { runtimeState, execution: guard });
    strategy.evaluate(ctx2);

    // Break streak, then form new PLAYER streak (4 games for CONSERVADORA)
    const breakGame = buildGame('5', rec1);
    const g3 = [
      ...g2,
      breakGame,
      buildGame('6', breakGame.winner),
      buildGame('7', breakGame.winner),
      buildGame('8', breakGame.winner),
    ];
    const ctx3 = buildContext(g3, { runtimeState, execution: guard });
    const sig3 = strategy.evaluate(ctx3);
    expect(sig3.triggered).toBe(true);
    const rec3 = getResultSignal(sig3).recommendedWinner;
    const opp3 =
      rec3 === WinnerType.BANKER ? WinnerType.PLAYER : WinnerType.BANKER;

    // Loss (second consecutive)
    const g4 = [...g3, buildGame('9', opp3)];
    const ctx4 = buildContext(g4, { runtimeState, execution: guard });
    strategy.evaluate(ctx4);

    const state = runtimeState.get<Record<string, unknown>>('alternancia-34');
    expect((state as Record<string, number>).score).toBe(40);
  });

  // ── Reset de racha ──

  it('resets streak counter when W→L', () => {
    const runtimeState = buildRuntimeState();
    const guard = buildExecutionGuard(true);

    // Win (streakType = W, streakCount = 1)
    const g1 = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const ctx1 = buildContext(g1, { runtimeState, execution: guard });
    const sig1 = strategy.evaluate(ctx1);
    const rec1 = getResultSignal(sig1).recommendedWinner;
    const g2 = [...g1, buildGame('4', rec1)];
    const ctx2 = buildContext(g2, { runtimeState, execution: guard });
    strategy.evaluate(ctx2);

    // Loss (streakType becomes L, streakCount becomes 1)
    const g3 = [
      ...g2,
      buildGame('5', rec1),
      buildGame('6', rec1),
      buildGame('7', rec1),
    ];
    const ctx3 = buildContext(g3, { runtimeState, execution: guard });
    const sig3 = strategy.evaluate(ctx3);
    const rec3 = getResultSignal(sig3).recommendedWinner;
    const opp3 =
      rec3 === WinnerType.BANKER ? WinnerType.PLAYER : WinnerType.BANKER;
    const g4 = [...g3, buildGame('8', opp3)];
    const ctx4 = buildContext(g4, { runtimeState, execution: guard });
    strategy.evaluate(ctx4);

    const state = runtimeState.get<Record<string, unknown>>('alternancia-34');
    expect((state as Record<string, number>).score).toBe(70);
  });

  // ── Score clamping ──

  it('clamps score at 100', () => {
    const runtimeState = buildRuntimeState();
    const guard = buildExecutionGuard(true);

    // Set score to 100 manually
    runtimeState.set('alternancia-34', {
      score: 100,
      streakType: 'W',
      streakCount: 4,
      lastSignaledStreakStart: null,
      lastVirtualSignaledStart: null,
      realOp: null,
      virtualOp: null,
    });

    // Generate signal and win (should stay at 100)
    const g = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const ctx = buildContext(g, { runtimeState, execution: guard });
    const sig = strategy.evaluate(ctx);
    expect(sig.triggered).toBe(true);
    const rec = getResultSignal(sig).recommendedWinner;
    const g2 = [...g, buildGame('4', rec)];
    const ctx2 = buildContext(g2, { runtimeState, execution: guard });
    strategy.evaluate(ctx2);

    const state = runtimeState.get<Record<string, unknown>>('alternancia-34');
    expect((state as Record<string, number>).score).toBe(100);
  });

  it('clamps score at 0', () => {
    const runtimeState = buildRuntimeState();
    const guard = buildExecutionGuard(true);

    // Set up state: low score, L streak, with a pending operation to resolve
    runtimeState.set('alternancia-34', {
      score: 5,
      streakType: 'L',
      streakCount: 1,
      lastSignaledStreakStart: null,
      lastVirtualSignaledStart: null,
      realOp: { recommended: WinnerType.PLAYER },
      virtualOp: null,
    });

    // Resolve a loss → 5 - 25 = -20 → clamped to 0
    const games = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
      buildGame('4', WinnerType.BANKER),
    ];
    const ctx = buildContext(games, { runtimeState, execution: guard });
    strategy.evaluate(ctx);

    const state = runtimeState.get<Record<string, unknown>>('alternancia-34');
    expect((state as Record<string, number>).score).toBe(0);
  });

  // ── Zonas ──

  it('uses AGRESIVA zone (rach-3) when score >= 85', () => {
    const runtimeState = buildRuntimeState();
    runtimeState.set('alternancia-34', {
      score: 85,
      streakType: 'W',
      streakCount: 0,
      lastSignaledStreakStart: null,
      lastVirtualSignaledStart: null,
      realOp: null,
      virtualOp: null,
    });

    const games = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const result = strategy.evaluate(buildContext(games, { runtimeState }));
    expect(result.triggered).toBe(true);
    expect(getZoneFromMetadata(result)).toBe('AGRESIVA');
  });

  it('uses CONSERVADORA zone (rach-4) when score between 55 and 84', () => {
    const runtimeState = buildRuntimeState();
    runtimeState.set('alternancia-34', {
      score: 70,
      streakType: 'W',
      streakCount: 0,
      lastSignaledStreakStart: null,
      lastVirtualSignaledStart: null,
      realOp: null,
      virtualOp: null,
    });

    // racha-3 should NOT trigger in CONSERVADORA
    const games3 = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const result3 = strategy.evaluate(buildContext(games3, { runtimeState }));
    expect(result3.triggered).toBe(false);

    // racha-4 SHOULD trigger
    const games4 = [...games3, buildGame('4', WinnerType.BANKER)];
    const result4 = strategy.evaluate(buildContext(games4, { runtimeState }));
    expect(result4.triggered).toBe(true);
    expect(getZoneFromMetadata(result4)).toBe('CONSERVADORA');
  });

  it('enters STOP when score <= 54, no real signals', () => {
    const runtimeState = buildRuntimeState();
    runtimeState.set('alternancia-34', {
      score: 50,
      streakType: 'L',
      streakCount: 1,
      lastSignaledStreakStart: null,
      lastVirtualSignaledStart: null,
      realOp: null,
      virtualOp: null,
    });

    const games = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const result = strategy.evaluate(buildContext(games, { runtimeState }));
    expect(result.triggered).toBe(false);
  });

  // ── STOP: operaciones virtuales ──

  it('updates score via virtual operations in STOP mode', () => {
    const runtimeState = buildRuntimeState();
    runtimeState.set('alternancia-34', {
      score: 50,
      streakType: 'W',
      streakCount: 0,
      lastSignaledStreakStart: null,
      lastVirtualSignaledStart: null,
      realOp: null,
      virtualOp: null,
    });

    // Virtual racha-3 detected → virtualOp opens
    const g_signal = [
      buildGame('v1', WinnerType.BANKER),
      buildGame('v2', WinnerType.BANKER),
      buildGame('v3', WinnerType.BANKER),
    ];
    const ctx_signal = buildContext(g_signal, { runtimeState });
    const r1 = strategy.evaluate(ctx_signal);
    expect(r1.triggered).toBe(false);

    // VirtualOp resolves win → score +5
    const g_win = [...g_signal, buildGame('v4', WinnerType.PLAYER)];
    const ctx_win = buildContext(g_win, { runtimeState });
    const r2 = strategy.evaluate(ctx_win);
    expect(r2.triggered).toBe(false);

    const state = runtimeState.get<Record<string, unknown>>('alternancia-34');
    expect((state as Record<string, number>).score).toBe(55);
  });

  it('exits STOP when virtual wins push score to 55+', () => {
    const runtimeState = buildRuntimeState();
    runtimeState.set('alternancia-34', {
      score: 50,
      streakType: 'W',
      streakCount: 0,
      lastSignaledStreakStart: null,
      lastVirtualSignaledStart: null,
      realOp: null,
      virtualOp: null,
    });

    // Step 1: racha-3 BANKER → virtualOp opens
    const g1 = [
      buildGame('a1', WinnerType.BANKER),
      buildGame('a2', WinnerType.BANKER),
      buildGame('a3', WinnerType.BANKER),
    ];
    const ctx1 = buildContext(g1, { runtimeState });
    strategy.evaluate(ctx1);

    // Step 2: PLAYER arrives → virtualOp resolves WIN → score 50+5=55
    const g2 = [...g1, buildGame('a4', WinnerType.PLAYER)];
    const ctx2 = buildContext(g2, { runtimeState });
    strategy.evaluate(ctx2);

    const state = runtimeState.get<Record<string, unknown>>('alternancia-34');
    expect((state as Record<string, number>).score).toBe(55);

    // Now in CONSERVADORA → needs racha-4 to trigger
    const g3 = [
      buildGame('b1', WinnerType.PLAYER),
      buildGame('b2', WinnerType.PLAYER),
      buildGame('b3', WinnerType.PLAYER),
      buildGame('b4', WinnerType.PLAYER),
    ];
    const ctx3 = buildContext(g3, { runtimeState });
    const r3 = strategy.evaluate(ctx3);
    expect(r3.triggered).toBe(true);
    expect(getZoneFromMetadata(r3)).toBe('CONSERVADORA');
  });

  it('does not fire real signals in STOP even if streak exists', () => {
    const runtimeState = buildRuntimeState();
    runtimeState.set('alternancia-34', {
      score: 30,
      streakType: 'L',
      streakCount: 2,
      lastSignaledStreakStart: null,
      lastVirtualSignaledStart: null,
      realOp: null,
      virtualOp: null,
    });

    const games = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
      buildGame('4', WinnerType.BANKER),
    ];
    const result = strategy.evaluate(buildContext(games, { runtimeState }));
    expect(result.triggered).toBe(false);
  });

  // ── Anti-duplicación ──

  it('does not re-signal the same streak', () => {
    const runtimeState = buildRuntimeState();
    const guard = buildExecutionGuard(true);

    const g1 = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const ctx1 = buildContext(g1, { runtimeState, execution: guard });
    const r1 = strategy.evaluate(ctx1);
    expect(r1.triggered).toBe(true);

    // Same streak extends (len=4), should NOT re-signal
    const g2 = [...g1, buildGame('4', WinnerType.BANKER)];
    const ctx2 = buildContext(g2, { runtimeState, execution: guard });
    const r2 = strategy.evaluate(ctx2);
    expect(r2.triggered).toBe(false);
  });

  it('signals again after streak breaks and new streak forms', () => {
    const runtimeState = buildRuntimeState();
    const guard = buildExecutionGuard(true);

    // First signal
    const g1 = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const ctx1 = buildContext(g1, { runtimeState, execution: guard });
    const r1 = strategy.evaluate(ctx1);
    expect(r1.triggered).toBe(true);

    // Streak breaks, then new streak forms
    const g2 = [
      ...g1,
      buildGame('4', WinnerType.PLAYER),
      buildGame('5', WinnerType.PLAYER),
      buildGame('6', WinnerType.PLAYER),
    ];
    const ctx2 = buildContext(g2, { runtimeState, execution: guard });
    const r2 = strategy.evaluate(ctx2);
    expect(r2.triggered).toBe(true);
  });

  it('shared anti-duplication: streak signaled in Agresiva is not re-signaled in Conservadora', () => {
    const runtimeState = buildRuntimeState();
    const guard = buildExecutionGuard(true);

    // Signal in AGRESIVA (score 85)
    const g1 = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const ctx1 = buildContext(g1, { runtimeState, execution: guard });
    const r1 = strategy.evaluate(ctx1);
    expect(r1.triggered).toBe(true);

    // Manually downgrade score to CONSERVADORA
    const currentState =
      runtimeState.get<Record<string, unknown>>('alternancia-34');
    runtimeState.set('alternancia-34', {
      ...currentState,
      score: 70,
    });

    // Same streak extended to len=4, should NOT re-signal in CONSERVADORA
    const g2 = [...g1, buildGame('4', WinnerType.BANKER)];
    const ctx2 = buildContext(g2, { runtimeState, execution: guard });
    const r2 = strategy.evaluate(ctx2);
    expect(r2.triggered).toBe(false);
  });

  // ── TIE handling ──

  it('TIE does not resolve a real operation', () => {
    const runtimeState = buildRuntimeState();
    const guard = buildExecutionGuard(true);

    const g1 = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const ctx1 = buildContext(g1, { runtimeState, execution: guard });
    const sig = strategy.evaluate(ctx1);
    expect(sig.triggered).toBe(true);

    // TIE game: realOp should remain, score unchanged
    const g2 = [...g1, buildGame('4', WinnerType.TIE)];
    const ctx2 = buildContext(g2, { runtimeState, execution: guard });
    strategy.evaluate(ctx2);

    const state = runtimeState.get<Record<string, unknown>>('alternancia-34');
    expect((state as Record<string, number>).score).toBe(85);
  });

  it('TIE does not resolve a virtual operation', () => {
    const runtimeState = buildRuntimeState();
    runtimeState.set('alternancia-34', {
      score: 30,
      streakType: 'W',
      streakCount: 0,
      lastSignaledStreakStart: null,
      lastVirtualSignaledStart: null,
      realOp: null,
      virtualOp: null,
    });

    const g1 = [
      buildGame('v1', WinnerType.BANKER),
      buildGame('v2', WinnerType.BANKER),
      buildGame('v3', WinnerType.BANKER),
    ];
    const ctx1 = buildContext(g1, { runtimeState });
    strategy.evaluate(ctx1);

    const g2 = [...g1, buildGame('v4', WinnerType.TIE)];
    const ctx2 = buildContext(g2, { runtimeState });
    strategy.evaluate(ctx2);

    const state = runtimeState.get<Record<string, unknown>>('alternancia-34');
    expect((state as Record<string, number>).score).toBe(30);
  });

  // ── Detección de rachas ──

  it('recommends BANKER after three consecutive PLAYER wins (AGRESIVA)', () => {
    const games = [
      buildGame('1', WinnerType.PLAYER),
      buildGame('2', WinnerType.PLAYER),
      buildGame('3', WinnerType.PLAYER),
    ];
    const result = strategy.evaluate(buildContext(games));

    expect(result.triggered).toBe(true);
    const signal = getResultSignal(result);
    expect(signal.recommendedWinner).toBe(WinnerType.BANKER);
    expect(signal.streakWinner).toBe(WinnerType.PLAYER);
    expect(signal.maxMartingales).toBe(2);
    expect(signal.triggerGameUuid).toBe('3');
  });

  it('recommends PLAYER after four consecutive BANKER wins (CONSERVADORA)', () => {
    const runtimeState = buildRuntimeState();
    runtimeState.set('alternancia-34', {
      score: 70,
      streakType: 'W',
      streakCount: 0,
      lastSignaledStreakStart: null,
      lastVirtualSignaledStart: null,
      realOp: null,
      virtualOp: null,
    });

    const games = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
      buildGame('4', WinnerType.BANKER),
    ];
    const result = strategy.evaluate(buildContext(games, { runtimeState }));

    expect(result.triggered).toBe(true);
    const signal = getResultSignal(result);
    expect(signal.recommendedWinner).toBe(WinnerType.PLAYER);
    expect(signal.streakWinner).toBe(WinnerType.BANKER);
    expect(getZoneFromMetadata(result)).toBe('CONSERVADORA');
  });

  it('does not trigger on racha of 2 (insufficient)', () => {
    const games = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
    ];
    const result = strategy.evaluate(buildContext(games));
    expect(result.triggered).toBe(false);
  });

  it('does not trigger when latest game is TIE', () => {
    const games = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
      buildGame('4', WinnerType.TIE),
    ];
    const result = strategy.evaluate(buildContext(games));
    expect(result.triggered).toBe(false);
  });

  // ── Signal structure ──

  it('emits a complete StrategySignal with metadata', () => {
    const games = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const result = strategy.evaluate(buildContext(games));

    expect(result.triggered).toBe(true);
    const signal = getResultSignal(result);
    expect(signal.strategyId).toBe('alternancia-34');
    expect(signal.strategyName).toBe('Alternancia34Strategy');
    expect(signal.triggeredAt).toEqual(new Date('2026-08-01T00:05:00.000Z'));
    expect(signal.maxMartingales).toBe(2);
    expect(signal.triggerGameUuid).toBe('3');
    expect(signal.metadata.score).toBe(85);
    expect(signal.metadata.zone).toBe('AGRESIVA');
    expect(signal.metadata.streakLength).toBe(3);
    expect(signal.metadata.streakWinner).toBe(WinnerType.BANKER);
    expect(signal.metadata.streakGameUuids).toEqual(['1', '2', '3']);
  });

  it('includes streakGameUuids in metadata for CONSERVADORA signal', () => {
    const runtimeState = buildRuntimeState();
    runtimeState.set('alternancia-34', {
      score: 70,
      streakType: 'W',
      streakCount: 0,
      lastSignaledStreakStart: null,
      lastVirtualSignaledStart: null,
      realOp: null,
      virtualOp: null,
    });

    const games = [
      buildGame('a', WinnerType.PLAYER),
      buildGame('b', WinnerType.PLAYER),
      buildGame('c', WinnerType.PLAYER),
      buildGame('d', WinnerType.PLAYER),
    ];
    const result = strategy.evaluate(buildContext(games, { runtimeState }));

    expect(result.triggered).toBe(true);
    const signal = getResultSignal(result);
    expect(signal.metadata.streakGameUuids).toEqual(['a', 'b', 'c', 'd']);
  });

  // ── Transición de zonas ──

  it('transitions from AGRESIVA to CONSERVADORA after a loss', () => {
    const runtimeState = buildRuntimeState();
    const guard = buildExecutionGuard(true);

    // Signal in AGRESIVA
    const g1 = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const ctx1 = buildContext(g1, { runtimeState, execution: guard });
    const sig = strategy.evaluate(ctx1);
    expect(sig.triggered).toBe(true);
    expect(getZoneFromMetadata(sig)).toBe('AGRESIVA');
    const rec = getResultSignal(sig).recommendedWinner;
    const opp =
      rec === WinnerType.BANKER ? WinnerType.PLAYER : WinnerType.BANKER;

    // Loss: score drops from 85 to 65 (CONSERVADORA)
    const g2 = [...g1, buildGame('4', opp)];
    const ctx2 = buildContext(g2, { runtimeState, execution: guard });
    strategy.evaluate(ctx2);

    const state = runtimeState.get<Record<string, unknown>>('alternancia-34');
    expect((state as Record<string, number>).score).toBe(65);
    expect((state as Record<string, string>).streakType).toBe('L');

    // Break the BANKER streak, then form a NEW streak for CONSERVADORA
    const g3 = [
      ...g2,
      buildGame('5', rec),
      buildGame('6', rec),
      buildGame('7', rec),
      buildGame('8', rec),
    ];
    const ctx3 = buildContext(g3, { runtimeState, execution: guard });
    const sig3 = strategy.evaluate(ctx3);
    expect(sig3.triggered).toBe(true);
    expect(getZoneFromMetadata(sig3)).toBe('CONSERVADORA');
  });

  // ── Score no cambia durante operación activa ──

  it('does not change score or zone during active operation (martingalas)', () => {
    const runtimeState = buildRuntimeState();
    const guardThatBlocks = buildExecutionGuard(true);

    // Signal
    const g1 = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const ctx1 = buildContext(g1, { runtimeState, execution: guardThatBlocks });
    const sig = strategy.evaluate(ctx1);
    expect(sig.triggered).toBe(true);
    expect(getZoneFromMetadata(sig)).toBe('AGRESIVA');

    // Now simulate MG1: canExecute=false
    const guardBlocked = buildExecutionGuard(false);
    const g2 = [...g1, buildGame('4', WinnerType.BANKER)];
    const ctx2 = buildContext(g2, { runtimeState, execution: guardBlocked });
    const r2 = strategy.evaluate(ctx2);
    expect(r2.triggered).toBe(false);

    const state = runtimeState.get<Record<string, unknown>>('alternancia-34');
    // Score should still be 85 (not changed during MG)
    expect((state as Record<string, number>).score).toBe(85);
  });

  // ── Reinicio del proceso ──

  it('recovers gracefully when runtimeState is empty (process restart)', () => {
    // Fresh runtimeState, no prior state
    const games = [
      buildGame('1', WinnerType.BANKER),
      buildGame('2', WinnerType.BANKER),
      buildGame('3', WinnerType.BANKER),
    ];
    const result = strategy.evaluate(buildContext(games));

    expect(result.triggered).toBe(true);
    expect(getScoreFromMetadata(result)).toBe(85);
    expect(getZoneFromMetadata(result)).toBe('AGRESIVA');
  });
});
