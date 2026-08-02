import { OperationSnapshot } from '../../operation/types/operation-snapshot.type';
import { AbstractDomainEvent } from '../base/domain-event';

export class OperationTieOccurredEvent extends AbstractDomainEvent<OperationSnapshot> {
  static readonly eventName = 'OperationTieOccurredEvent';

  constructor(snapshot: OperationSnapshot) {
    super(OperationTieOccurredEvent.eventName, 1, snapshot);
  }
}
