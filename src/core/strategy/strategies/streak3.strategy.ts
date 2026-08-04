import { StreakStrategyBase } from './streak.strategy.base';

const STREAK_LENGTH = 3;
const MAX_MARTINGALES = 2;

/**
 * Racha de 3: ver StreakStrategyBase para la lógica de detección, guard y
 * anti-duplicación compartida con el resto de variantes (Streak4Strategy...).
 */
export class Streak3Strategy extends StreakStrategyBase {
  readonly id = 'streak-3';
  readonly name = 'Streak3Strategy';
  readonly description =
    'Recomienda el ganador opuesto tras 3 resultados consecutivos iguales.';

  constructor() {
    super(STREAK_LENGTH, MAX_MARTINGALES);
  }
}
