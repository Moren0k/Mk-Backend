import { OperationSnapshot } from '../../operation/types/operation-snapshot.type';
import { AbstractDomainEvent } from '../base/domain-event';

/**
 * Se publica cuando una Operation activa se cancela por comando explícito
 * (Mk-Api.md Anexo D §4) — nunca como resultado de una jugada.
 */
export class OperationCancelledEvent extends AbstractDomainEvent<OperationSnapshot> {
  static readonly eventName = 'OperationCancelledEvent';

  constructor(snapshot: OperationSnapshot) {
    super(OperationCancelledEvent.eventName, 1, snapshot);
  }
}
