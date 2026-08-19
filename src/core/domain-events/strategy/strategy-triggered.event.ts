import { StrategyTrigger } from '../../strategy/types/strategy-signal.type';
import { AbstractDomainEvent } from '../base/domain-event';

/**
 * Se publica cuando StrategyCoordinator detecta que alguna Strategy
 * registrada devolvió una señal válida. Todavía no crea ninguna Operation:
 * eso ocurrirá al transformar esta señal en una etapa posterior.
 *
 * El payload ya incluye `context` (ver StrategyTrigger): StrategyCoordinator
 * lo estampa antes de publicar este evento, así que Operation.open() nunca
 * necesita derivarlo por su cuenta.
 */
export class StrategyTriggeredEvent extends AbstractDomainEvent<StrategyTrigger> {
  static readonly eventName = 'StrategyTriggeredEvent';

  constructor(trigger: StrategyTrigger) {
    super(StrategyTriggeredEvent.eventName, 1, trigger);
  }
}
