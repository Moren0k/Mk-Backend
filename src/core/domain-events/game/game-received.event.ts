import { Game } from '../../history/game.type';
import { AbstractDomainEvent } from '../base/domain-event';

/**
 * `isHistorical` distingue una partida que llegó como parte de la carga
 * inicial (backfill de hasta MAX_HISTORY_SIZE partidas al arrancar) de una
 * partida realmente en vivo (SSE). Existe para que subscribers como
 * StrategyCoordinator puedan decidir no generar señales/operaciones para
 * patrones que ya ocurrieron y se resolvieron horas atrás, sin dejar de
 * alimentar analítica descriptiva (Statistics, EngineMetrics), que sí debe
 * contar el historial completo.
 */
export type GameReceivedPayload = {
  readonly game: Game;
  readonly isHistorical: boolean;
};

/**
 * Se publica cuando GameEventCollector logra insertar una jugada nueva y
 * válida en HistoryStore (nunca para duplicados).
 */
export class GameReceivedEvent extends AbstractDomainEvent<GameReceivedPayload> {
  static readonly eventName = 'GameReceivedEvent';

  constructor(payload: GameReceivedPayload) {
    super(GameReceivedEvent.eventName, 1, payload);
  }
}
