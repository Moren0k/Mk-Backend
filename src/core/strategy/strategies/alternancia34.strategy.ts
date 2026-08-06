import { WinnerType } from '../../enums/winner-type.enum';
import { Game } from '../../history/game.type';
import { HistorySnapshot } from '../../interfaces/history-snapshot.interface';
import { Strategy } from '../interfaces/strategy.interface';
import { StrategyContext } from '../types/strategy-context.type';
import { StrategyResult } from '../types/strategy-result.type';

const NO_SIGNAL: StrategyResult = Object.freeze({ triggered: false });

const OPPOSITE_WINNER: Readonly<Record<WinnerType, WinnerType | undefined>> = {
  [WinnerType.PLAYER]: WinnerType.BANKER,
  [WinnerType.BANKER]: WinnerType.PLAYER,
  [WinnerType.TIE]: undefined,
};

type ConfianzaZone = 'AGRESIVA' | 'CONSERVADORA' | 'STOP';

type StreakInfo = {
  readonly winner: WinnerType;
  readonly length: number;
  readonly startGameUuid: string;
};

type RealOp = {
  readonly recommended: WinnerType;
};

type VirtualOp = {
  readonly recommended: WinnerType;
  readonly triggerGameUuid: string;
  readonly martingaleUsed: number;
};

type ConfianzaState = {
  score: number;
  streakType: 'W' | 'L';
  streakCount: number;
  lastSignaledStreakStart: string | null;
  lastVirtualSignaledStart: string | null;
  realOp: RealOp | null;
  virtualOp: VirtualOp | null;
};

const WIN_BONUS: ReadonlyArray<number> = [5, 10, 15, 20];
const LOSS_PENALTY: ReadonlyArray<number> = [20, 25, 30, 30];
const INITIAL_SCORE = 85;
const MAX_SCORE = 100;
const MIN_SCORE = 0;
const ZONE_AGRESIVA_MIN = 85;
const ZONE_CONSERVADORA_MIN = 55;
const MAX_MARTINGALES = 2;

function clampScore(score: number): number {
  if (score > MAX_SCORE) return MAX_SCORE;
  if (score < MIN_SCORE) return MIN_SCORE;
  return score;
}

function applyWin(state: ConfianzaState, virtual: boolean): void {
  const prevScore = state.score;
  const prevZone = getZone(prevScore);

  if (state.streakType === 'W') {
    state.streakCount++;
  } else {
    state.streakType = 'W';
    state.streakCount = 1;
  }
  const index = Math.min(state.streakCount, WIN_BONUS.length) - 1;
  const delta = WIN_BONUS[index];
  state.score = clampScore(state.score + delta);

  const newZone = getZone(state.score);
  logScoreUpdate(
    prevScore,
    state.score,
    delta,
    'GANÓ',
    virtual,
    prevZone,
    newZone,
  );
}

function applyLoss(state: ConfianzaState, virtual: boolean): void {
  const prevScore = state.score;
  const prevZone = getZone(prevScore);

  if (state.streakType === 'L') {
    state.streakCount++;
  } else {
    state.streakType = 'L';
    state.streakCount = 1;
  }
  const index = Math.min(state.streakCount, LOSS_PENALTY.length) - 1;
  const delta = -LOSS_PENALTY[index];
  state.score = clampScore(state.score + delta);

  const newZone = getZone(state.score);
  logScoreUpdate(
    prevScore,
    state.score,
    delta,
    'PERDIÓ',
    virtual,
    prevZone,
    newZone,
  );
}

function logScoreUpdate(
  prevScore: number,
  newScore: number,
  delta: number,
  outcome: string,
  virtual: boolean,
  prevZone: ConfianzaZone,
  newZone: ConfianzaZone,
): void {
  const tag = virtual ? '[Confianza34 VIRTUAL]' : '[Confianza34]';
  const sign = delta >= 0 ? '+' : '';
  const zoneTransition = prevZone !== newZone ? ` → ${newZone}` : '';

  console.log(
    `${tag} ${outcome} | ${sign}${delta} pts | ` +
      `score: ${prevScore} → ${newScore} (${newZone}${zoneTransition})`,
  );
}

function getZone(score: number): ConfianzaZone {
  if (score >= ZONE_AGRESIVA_MIN) return 'AGRESIVA';
  if (score >= ZONE_CONSERVADORA_MIN) return 'CONSERVADORA';
  return 'STOP';
}

function buildInitialState(): ConfianzaState {
  return {
    score: INITIAL_SCORE,
    streakType: 'W',
    streakCount: 0,
    lastSignaledStreakStart: null,
    lastVirtualSignaledStart: null,
    realOp: null,
    virtualOp: null,
  };
}

function computeCurrentStreak(
  snapshot: HistorySnapshot,
): StreakInfo | undefined {
  const games = snapshot.getAll();
  if (games.length === 0) {
    return undefined;
  }

  const latest = games[games.length - 1];
  if (latest.winner === WinnerType.TIE) {
    return undefined;
  }

  let length = 1;
  let index = games.length - 2;
  while (index >= 0 && games[index].winner === latest.winner) {
    length += 1;
    index -= 1;
  }

  return {
    winner: latest.winner,
    length,
    startGameUuid: games[index + 1].uuid,
  };
}

function buildSignal(
  strategyId: string,
  strategyName: string,
  streak: StreakInfo,
  recommendedWinner: WinnerType,
  maxMartingales: number,
  streakGameUuids: ReadonlyArray<string>,
  currentGame: Game,
  timestamp: Date,
  score: number,
  zone: ConfianzaZone,
): StrategyResult {
  return {
    triggered: true,
    strategyId,
    strategyName,
    triggeredAt: timestamp,
    recommendedWinner,
    streakWinner: streak.winner,
    maxMartingales,
    triggerGameUuid: currentGame.uuid,
    reason: `Racha de ${streak.length} resultados consecutivos de ${streak.winner}. [Confianza34 ${zone} score=${score}]`,
    metadata: {
      streakGameUuids,
      score,
      zone,
      streakLength: streak.length,
      streakWinner: streak.winner,
    },
  };
}

/**
 * Estrategia adaptativa basada en un score de confianza (0-100) que
 * determina automáticamente el nivel de exposición del sistema.
 *
 * Zonas operativas:
 * - AGRESIVA (85-100): racha de 3, señales frecuentes.
 * - CONSERVADORA (55-84): racha de 4, señales menos frecuentes.
 * - STOP (0-54): sin señales reales; opera en modo virtual para
 *   recuperar el score cuando el mercado lo permita.
 *
 * El score sube con victorias (+5/+10/+15/+20 por racha consecutiva)
 * y baja con derrotas (-20/-25/-30/-30 por racha consecutiva). La
 * asimetría deliberada prioriza la protección del bankroll: una
 * derrota castiga más que lo que premia una victoria.
 *
 * Durante las martingalas de una operación activa, el score y la zona
 * no cambian: solo se actualizan cuando la operación se resuelve
 * (WON o LOST).
 *
 * Diseño completo en: [`Confianza34.md`](../../../Confianza34.md)
 */
export class Alternancia34Strategy implements Strategy {
  readonly id = 'alternancia-34';
  readonly name = 'Alternancia34Strategy';
  readonly description =
    'Estrategia adaptativa con score de confianza. ' +
    'AGRESIVA (85-100): racha-3. CONSERVADORA (55-84): racha-4. ' +
    'STOP (0-54): sin señales, recuperación virtual.';

  enabled(): boolean {
    return true;
  }

  evaluate(context: StrategyContext): StrategyResult {
    const canExec = context.execution.canExecute(this.id);

    if (!canExec) {
      return NO_SIGNAL;
    }

    const state = this.loadState(context);

    this.resolveRealOutcome(state, context);

    let zone = getZone(state.score);

    if (zone === 'STOP') {
      this.processVirtualStop(state, context);
      zone = getZone(state.score);
    }

    if (zone === 'STOP') {
      context.runtimeState.set(this.id, state);
      return NO_SIGNAL;
    }

    const minLength = zone === 'AGRESIVA' ? 3 : 4;
    const streak = computeCurrentStreak(context.historySnapshot);

    if (!streak || streak.length < minLength) {
      context.runtimeState.set(this.id, state);
      return NO_SIGNAL;
    }

    if (streak.startGameUuid === state.lastSignaledStreakStart) {
      context.runtimeState.set(this.id, state);
      return NO_SIGNAL;
    }

    const recommendedWinner = OPPOSITE_WINNER[streak.winner];
    if (!recommendedWinner) {
      context.runtimeState.set(this.id, state);
      return NO_SIGNAL;
    }

    const streakGameUuids = context.historySnapshot
      .getLast(minLength)
      .map((game) => game.uuid);

    state.lastSignaledStreakStart = streak.startGameUuid;
    state.realOp = { recommended: recommendedWinner };
    context.runtimeState.set(this.id, state);

    return buildSignal(
      this.id,
      this.name,
      streak,
      recommendedWinner,
      MAX_MARTINGALES,
      streakGameUuids,
      context.currentGame,
      context.timestamp,
      state.score,
      zone,
    );
  }

  private loadState(context: StrategyContext): ConfianzaState {
    const saved = context.runtimeState.get<ConfianzaState>(this.id);
    return saved ?? buildInitialState();
  }

  private resolveRealOutcome(
    state: ConfianzaState,
    context: StrategyContext,
  ): void {
    if (!state.realOp) return;
    if (context.currentGame.winner === WinnerType.TIE) return;

    const won = context.currentGame.winner === state.realOp.recommended;

    if (won) {
      applyWin(state, false);
    } else {
      applyLoss(state, false);
    }

    state.realOp = null;
  }

  private processVirtualStop(
    state: ConfianzaState,
    context: StrategyContext,
  ): void {
    const vOp = state.virtualOp;

    if (vOp) {
      if (context.currentGame.uuid === vOp.triggerGameUuid) return;
      if (context.currentGame.winner === WinnerType.TIE) return;

      const won = context.currentGame.winner === vOp.recommended;

      if (won) {
        applyWin(state, true);
        state.virtualOp = null;
        return;
      }

      const nextMG = vOp.martingaleUsed + 1;
      if (nextMG > 2) {
        applyLoss(state, true);
        state.virtualOp = null;
        return;
      }

      state.virtualOp = {
        recommended: vOp.recommended,
        triggerGameUuid: vOp.triggerGameUuid,
        martingaleUsed: nextMG,
      };
      return;
    }

    const streak = computeCurrentStreak(context.historySnapshot);
    if (!streak || streak.length < 3) return;
    if (streak.startGameUuid === state.lastVirtualSignaledStart) return;

    const recommendedWinner = OPPOSITE_WINNER[streak.winner];
    if (!recommendedWinner) return;

    state.lastVirtualSignaledStart = streak.startGameUuid;
    state.virtualOp = {
      recommended: recommendedWinner,
      triggerGameUuid: context.currentGame.uuid,
      martingaleUsed: 0,
    };
  }
}
