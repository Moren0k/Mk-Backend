import { WinnerType } from '../../enums/winner-type.enum';
import { Game } from '../../history/game.type';
import { InMemoryHistorySnapshot } from '../../history/in-memory-history-snapshot';
import { StrategyExecutionGuard } from '../interfaces/strategy-execution-guard.interface';
import { StrategyRuntimeState } from '../interfaces/strategy-runtime-state.interface';
import { createStrategyContext } from '../types/strategy-context.type';
import { Alternancia34Strategy } from './alternancia34.strategy';

function buildGame(uuid: string, winner: WinnerType): Game {
  return {
    uuid,
    winner,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function buildRuntimeState(): StrategyRuntimeState {
  const state = new Map<string, unknown>();
  return {
    get: <T>(strategyId: string) => state.get(strategyId) as T | undefined,
    set: <T>(strategyId: string, value: T) => {
      state.set(strategyId, value);
    },
  };
}

function buildExecutionGuard(): jest.Mocked<StrategyExecutionGuard> {
  return { canExecute: jest.fn().mockReturnValue(true) };
}

/**
 * Este spec solo verifica el cableado de la plantilla (id, grupo por
 * defecto, estado deshabilitado). No cubre lógica de negocio: eso le
 * corresponde a quien implemente `evaluate()` (ver TODOs en
 * alternancia34.strategy.ts).
 */
describe('Alternancia34Strategy (plantilla)', () => {
  let strategy: Alternancia34Strategy;

  beforeEach(() => {
    strategy = new Alternancia34Strategy();
  });

  it('is disabled by default until its logic is implemented', () => {
    expect(strategy.enabled()).toBe(false);
  });

  it('has a unique id classified as "pruebas" (see strategy-group.ts)', () => {
    expect(strategy.id).toBe('alternancia-34');
  });

  it('never triggers with the stub implementation', () => {
    const games = [buildGame('1', WinnerType.PLAYER)];
    const context = createStrategyContext(
      games[games.length - 1],
      new InMemoryHistorySnapshot(Object.freeze(games)),
      buildExecutionGuard(),
      buildRuntimeState(),
      new Date('2026-08-01T00:05:00.000Z'),
    );

    expect(strategy.evaluate(context)).toEqual({ triggered: false });
  });
});
