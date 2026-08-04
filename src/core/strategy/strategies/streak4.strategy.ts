import { StreakStrategyBase } from './streak.strategy.base';

const STREAK_LENGTH = 4;
const MAX_MARTINGALES = 2;

/**
 * Racha de 4: misma lógica que Streak3Strategy (ver StreakStrategyBase),
 * solo cambia la longitud de racha exigida. Sus señales se enrutan
 * exclusivamente al canal de Telegram de pruebas (ver NotificationModule),
 * nunca al canal oficial.
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
