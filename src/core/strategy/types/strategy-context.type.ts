import { Game } from '../../history/game.type';
import { HistorySnapshot } from '../../interfaces/history-snapshot.interface';
import { StrategyExecutionGuard } from '../interfaces/strategy-execution-guard.interface';
import { StrategyRuntimeState } from '../interfaces/strategy-runtime-state.interface';

/**
 * Todo lo que una Strategy puede leer para evaluar una oportunidad.
 *
 * Deliberadamente no incluye HistoryStore, DomainEventBus ni ningún
 * servicio: una estrategia nunca debe poder modificar estado global ni
 * publicar eventos por su cuenta. `execution` tampoco expone Operation ni
 * OperationCoordinator: solo responde si la estrategia puede emitir señal
 * ahora mismo (ver StrategyExecutionGuard). `runtimeState` es la única
 * puerta por la que una estrategia puede recordar algo entre evaluaciones,
 * aislado por su propio strategyId (ver StrategyRuntimeState).
 */
export type StrategyContext = {
  readonly currentGame: Game;
  readonly historySnapshot: HistorySnapshot;
  readonly execution: StrategyExecutionGuard;
  readonly runtimeState: StrategyRuntimeState;
  readonly timestamp: Date;
};

/**
 * Único punto que construye un StrategyContext, para que siempre quede
 * congelado (inmutable) sin duplicar `Object.freeze(...)` en cada lugar
 * que lo necesite.
 */
export function createStrategyContext(
  currentGame: Game,
  historySnapshot: HistorySnapshot,
  execution: StrategyExecutionGuard,
  runtimeState: StrategyRuntimeState,
  timestamp: Date,
): StrategyContext {
  return Object.freeze({
    currentGame,
    historySnapshot,
    execution,
    runtimeState,
    timestamp,
  });
}
