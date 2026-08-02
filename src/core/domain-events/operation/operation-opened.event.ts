import { OperationSnapshot } from '../../operation/types/operation-snapshot.type';
import { AbstractDomainEvent } from '../base/domain-event';

/**
 * Se publica cuando OperationCoordinator crea una nueva Operation a partir
 * de un StrategyTriggeredEvent.
 */
export class OperationOpenedEvent extends AbstractDomainEvent<OperationSnapshot> {
  static readonly eventName = 'OperationOpenedEvent';

  constructor(snapshot: OperationSnapshot) {
    super(OperationOpenedEvent.eventName, 1, snapshot);
  }
}
