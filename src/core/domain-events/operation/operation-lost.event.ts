import { OperationSnapshot } from '../../operation/types/operation-snapshot.type';
import { AbstractDomainEvent } from '../base/domain-event';

/**
 * Se publica cuando una Operation activa llega al estado final LOST.
 */
export class OperationLostEvent extends AbstractDomainEvent<OperationSnapshot> {
  static readonly eventName = 'OperationLostEvent';

  constructor(snapshot: OperationSnapshot) {
    super(OperationLostEvent.eventName, 1, snapshot);
  }
}
