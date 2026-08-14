import { StreakStrategyBase } from './streak.strategy.base';

const STREAK_LENGTH = 3;
const MAX_MARTINGALES = 2;

/**
 * Racha de 3: ver StreakStrategyBase para la lógica de detección, guard y
 * anti-duplicación compartida con el resto de variantes (Streak4Strategy...).
 *
 * Sigue registrada en StrategyModule igual que las demás. Si corre o no
 * ya no se decide en código (`enabled()` es un booleano fijo heredado,
 * sin efecto real de negocio): la única fuente de verdad es si está
 * asignada a un canal activo en `StrategyChannelRegistry`, configurado vía
 * `PATCH /api/v1/channels/:channel` (Mk-Api.md, 2026-08-11). Por default
 * ninguna estrategia está asignada a ningún canal.
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
