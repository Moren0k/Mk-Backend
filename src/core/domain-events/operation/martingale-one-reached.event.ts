import { OperationSnapshot } from '../../operation/types/operation-snapshot.type';
import { AbstractDomainEvent } from '../base/domain-event';

/**
 * Se publica cuando una Operation activa pierde su primera ronda y avanza
 * a la martingala 1.
 */
export class MartingaleOneReachedEvent extends AbstractDomainEvent<OperationSnapshot> {
  static readonly eventName = 'MartingaleOneReachedEvent';

  constructor(snapshot: OperationSnapshot) {
    super(MartingaleOneReachedEvent.eventName, 1, snapshot);
  }
}
