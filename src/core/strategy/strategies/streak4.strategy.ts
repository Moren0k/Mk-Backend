import { StreakStrategyBase } from './streak.strategy.base';

const STREAK_LENGTH = 4;
const MAX_MARTINGALES = 2;

/**
 * Racha de 4: misma lógica que Streak3Strategy (ver StreakStrategyBase),
 * solo cambia la longitud de racha exigida. Es la estrategia activa del
 * canal oficial (ver strategy-group.ts: cualquier strategyId que no esté
 * marcado explícitamente como "solo pruebas" cae en "oficial" por
 * default).
 */
export class Streak4Strategy extends StreakStrategyBase {
  readonly id = 'streak-4';
  readonly name = 'Streak4Strategy';
  readonly description =
    'Recomienda el ganador opuesto tras 4 resultados consecutivos iguales.';

  constructor() {
    super(STREAK_LENGTH, MAX_MARTINGALES);
  }
}
