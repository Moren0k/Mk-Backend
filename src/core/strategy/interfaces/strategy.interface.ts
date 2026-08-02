import { StrategyContext } from '../types/strategy-context.type';
import { StrategyResult } from '../types/strategy-result.type';

/**
 * Contrato que debe cumplir toda estrategia de detección de oportunidades.
 *
 * Una Strategy únicamente responde "¿detecto una oportunidad aquí?". Nunca
 * administra operaciones, nunca envía notificaciones, nunca conoce otras
 * estrategias ni el HistoryStore: solo recibe un StrategyContext y devuelve
 * un resultado. Agregar una estrategia nueva es crear una clase que
 * implemente este contrato y registrarla vía DI (ver StrategyModule); nunca
 * requiere modificar StrategyCoordinator.
 */
export interface Strategy {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  enabled(): boolean;
  evaluate(context: StrategyContext): StrategyResult;
}
