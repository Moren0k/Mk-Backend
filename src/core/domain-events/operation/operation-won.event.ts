import { OperationSnapshot } from '../../operation/types/operation-snapshot.type';
import { AbstractDomainEvent } from '../base/domain-event';

/**
 * Se publica cuando una Operation activa llega al estado final WON.
 */
export class OperationWonEvent extends AbstractDomainEvent<OperationSnapshot> {
  static readonly eventName = 'OperationWonEvent';

  constructor(snapshot: OperationSnapshot) {
    super(OperationWonEvent.eventName, 1, snapshot);
  }
}
