import { randomUUID } from 'node:crypto';

import { OperationState } from '../enums/operation-state.enum';
import { WinnerType } from '../enums/winner-type.enum';
import { Game } from '../history/game.type';
import { StrategySignal } from '../strategy/types/strategy-signal.type';
import { OperationSnapshot } from './types/operation-snapshot.type';
import { OperationTransition } from './types/operation-transition.type';
import { OperationUpdateResult } from './types/operation-update-result.type';

const FINAL_STATES: ReadonlySet<OperationState> = new Set([
  OperationState.WON,
  OperationState.LOST,
  OperationState.CANCELLED,
]);

/**
 * A qué OperationState se pasa tras perder la N-ésima martingala. Streak3Strategy
 * usa como máximo 2, por lo que hoy solo existen MG1 y MG2; si en el futuro una
 * estrategia define más, hay que sumar el estado correspondiente aquí y en
 * OperationState (ver el error explícito en `handleLoss`).
 */
const MARTINGALE_STATE_BY_COUNT: Readonly<Record<number, OperationState>> = {
  1: OperationState.MARTINGALE_ONE,
  2: OperationState.MARTINGALE_TWO,
};

/**
 * Aggregate root del dominio: representa una apuesta viva generada por una
 * Strategy. Encapsula toda su máquina de estados (martingalas, empates,
 * victoria/derrota) y su propio historial de transiciones.
 *
 * Nunca conoce DomainEventBus ni ningún DomainEvent concreto: `update()`
 * únicamente describe qué ocurrió (OperationUpdateResult). Publicar los
 * eventos correspondientes es responsabilidad exclusiva de
 * OperationCoordinator.
 */
export class Operation {
  readonly operationId: string;
  readonly strategyId: string;
  readonly recommendedWinner: WinnerType;
  readonly streakWinner: WinnerType;
  readonly reason: string;
  readonly openedAt: Date;

  private readonly maxMartingales: number;
  /**
   * uuid de la partida que disparó la señal que originó esta Operation.
   * Se ignora si llega como actualización (ver `update`): así el
   * comportamiento no depende del orden en que los subscribers del
   * DomainEventBus procesen un mismo GameReceivedEvent.
   */
  private readonly triggerGameId: string;
  private readonly transitions: OperationTransition[] = [];
  private state: OperationState = OperationState.OPEN;
  private martingaleCount = 0;
  private finishedAt: Date | undefined;

  private constructor(
    operationId: string,
    strategyId: string,
    recommendedWinner: WinnerType,
    streakWinner: WinnerType,
    maxMartingales: number,
    triggerGameId: string,
    reason: string,
    openedAt: Date,
  ) {
    this.operationId = operationId;
    this.strategyId = strategyId;
    this.recommendedWinner = recommendedWinner;
    this.streakWinner = streakWinner;
    this.maxMartingales = maxMartingales;
    this.triggerGameId = triggerGameId;
    this.reason = reason;
    this.openedAt = openedAt;
  }

  /**
   * Único punto de creación: una Operation nace siempre a partir de la
   * señal de una estrategia, con su propia identidad generada aquí mismo.
   */
  static open(signal: StrategySignal): Operation {
    return new Operation(
      randomUUID(),
      signal.strategyId,
      signal.recommendedWinner,
      signal.streakWinner,
      signal.maxMartingales,
      signal.triggerGameUuid,
      signal.reason,
      new Date(),
    );
  }

  get currentState(): OperationState {
    return this.state;
  }

  get currentMartingale(): number {
    return this.martingaleCount;
  }

  get closedAt(): Date | undefined {
    return this.finishedAt;
  }

  get history(): ReadonlyArray<OperationTransition> {
    return Object.freeze([...this.transitions]);
  }

  isFinished(): boolean {
    return FINAL_STATES.has(this.state);
  }

  /**
   * Procesa una nueva jugada.
   *
   * La comparación siempre es `recommendedWinner` vs `game.winner` (nunca
   * `score`). Un TIE nunca consume martingala, nunca cambia de estado y
   * nunca finaliza la operación, pero sí reporta `tieOccurred = true` para
   * que el coordinator decida notificarlo. Si la operación ya terminó, no
   * hace nada (defensivo: OperationCoordinator la elimina de las activas
   * apenas termina, por lo que en condiciones normales esto nunca debería
   * ocurrir). Tampoco hace nada si `game` es la misma partida que la
   * disparó: eso puede pasar si un subscriber alcanza a reenviar ese
   * GameReceivedEvent después de que la Operation ya se creó (ver
   * `triggerGameId`).
   */
  update(game: Game): OperationUpdateResult {
    if (this.isFinished()) {
      return this.buildResult(false, undefined, false);
    }

    if (game.uuid === this.triggerGameId) {
      return this.buildResult(false, undefined, false);
    }

    if (game.winner === WinnerType.TIE) {
      return this.buildResult(false, undefined, true);
    }

    if (game.winner === this.recommendedWinner) {
      return this.applyTransition(
        OperationState.WON,
        game,
        'La partida coincidió con el ganador recomendado.',
      );
    }

    return this.handleLoss(game);
  }

  /**
   * Cancela la operación por comando explícito (Mk-Api.md Anexo D §4),
   * nunca como resultado de una jugada — por eso no recibe un `Game`. No
   * hace nada si ya terminó (mismo criterio defensivo que `update()`):
   * quien dispara el comando decide qué hacer con un 409/404, esta clase
   * solo reporta que no hubo cambio (`stateChanged: false`).
   */
  cancel(reason: string): OperationUpdateResult {
    if (this.isFinished()) {
      return this.buildResult(false, undefined, false);
    }

    return this.applyTransition(OperationState.CANCELLED, undefined, reason);
  }

  toSnapshot(): OperationSnapshot {
    return Object.freeze({
      operationId: this.operationId,
      strategyId: this.strategyId,
      recommendedWinner: this.recommendedWinner,
      streakWinner: this.streakWinner,
      currentState: this.state,
      currentMartingale: this.martingaleCount,
      maxMartingales: this.maxMartingales,
      openedAt: this.openedAt,
      closedAt: this.finishedAt,
      reason: this.reason,
      history: this.history,
    });
  }

  private handleLoss(game: Game): OperationUpdateResult {
    const nextMartingaleCount = this.martingaleCount + 1;

    if (nextMartingaleCount > this.maxMartingales) {
      return this.applyTransition(
        OperationState.LOST,
        game,
        `Se agotaron las ${this.maxMartingales} martingala(s) disponibles.`,
      );
    }

    const nextState = MARTINGALE_STATE_BY_COUNT[nextMartingaleCount];
    if (!nextState) {
      throw new Error(
        `OperationState no define un estado para la martingala ${nextMartingaleCount}. ` +
          'Agrega el valor correspondiente a MARTINGALE_STATE_BY_COUNT y al enum OperationState.',
      );
    }

    this.martingaleCount = nextMartingaleCount;
    return this.applyTransition(
      nextState,
      game,
      `La partida no coincidió con el ganador recomendado (martingala ${nextMartingaleCount}).`,
    );
  }

  private applyTransition(
    newState: OperationState,
    game: Game | undefined,
    reason: string,
  ): OperationUpdateResult {
    const transition: OperationTransition = Object.freeze({
      from: this.state,
      to: newState,
      game,
      timestamp: new Date(),
      reason,
    });

    this.state = newState;
    this.transitions.push(transition);

    if (FINAL_STATES.has(newState)) {
      this.finishedAt = transition.timestamp;
    }

    return this.buildResult(true, transition, false);
  }

  private buildResult(
    stateChanged: boolean,
    transition: OperationTransition | undefined,
    tieOccurred: boolean,
  ): OperationUpdateResult {
    return Object.freeze({
      stateChanged,
      tieOccurred,
      newState: this.state,
      completed: this.isFinished(),
      transition,
      snapshot: this.toSnapshot(),
    });
  }
}
