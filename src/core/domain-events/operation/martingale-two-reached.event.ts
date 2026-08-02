import { OperationSnapshot } from '../../operation/types/operation-snapshot.type';
import { AbstractDomainEvent } from '../base/domain-event';

/**
 * Se publica cuando una Operation activa pierde su segunda ronda y avanza
 * a la martingala 2.
 */
export class MartingaleTwoReachedEvent extends AbstractDomainEvent<OperationSnapshot> {
  static readonly eventName = 'MartingaleTwoReachedEvent';

  constructor(snapshot: OperationSnapshot) {
    super(MartingaleTwoReachedEvent.eventName, 1, snapshot);
  }
}
