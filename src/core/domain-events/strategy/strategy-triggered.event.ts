import { StrategySignal } from '../../strategy/types/strategy-signal.type';
import { AbstractDomainEvent } from '../base/domain-event';

/**
 * Se publica cuando StrategyCoordinator detecta que alguna Strategy
 * registrada devolvió una señal válida. Todavía no crea ninguna Operation:
 * eso ocurrirá al transformar esta señal en una etapa posterior.
 */
export class StrategyTriggeredEvent extends AbstractDomainEvent<StrategySignal> {
  static readonly eventName = 'StrategyTriggeredEvent';

  constructor(signal: StrategySignal) {
    super(StrategyTriggeredEvent.eventName, 1, signal);
  }
}
