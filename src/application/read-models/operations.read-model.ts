import { Injectable } from '@nestjs/common';

import { OperationSnapshot } from '../../core/operation/types/operation-snapshot.type';
import { StrategyGroup } from '../../core/strategy/strategy-group';
import { OperationCoordinator } from '../operation/operation.coordinator';
import { StrategyChannelRegistry } from '../strategy/strategy-channel-registry';

/**
 * Proyecta las operaciones activas por canal (Mk-Api.md Anexo D §2): cada
 * página del frontend (`/panel/oficial`, `/panel/pruebas`) solo debe ver
 * las operaciones de su propio canal, nunca las de la otra estrategia.
 * Consulta `StrategyChannelRegistry` (mismo criterio en vivo que usa el
 * enrutamiento de Telegram, Anexo D §3) en vez de `resolveStrategyGroup`:
 * una reasignación de canal debe reflejarse de inmediato también aquí,
 * sobre operaciones activas (no históricas — ver el propio registro).
 *
 * También expone `cancel()` (Mk-Api.md Anexo D §4): a pesar del nombre de
 * la clase, es el único punto de mutación de este recurso — así el
 * controller de `operations` nunca inyecta `OperationCoordinator` directo
 * (§5.3), y no vale la pena una clase aparte para un solo método delegado.
 */
@Injectable()
export class OperationsReadModel {
  constructor(
    private readonly operationCoordinator: OperationCoordinator,
    private readonly strategyChannelRegistry: StrategyChannelRegistry,
  ) {}

  getActiveByChannel(channel: StrategyGroup): ReadonlyArray<OperationSnapshot> {
    return this.operationCoordinator
      .getActiveSnapshots()
      .filter((snapshot) =>
        this.strategyChannelRegistry.isAssignedTo(snapshot.strategyId, channel),
      );
  }

  cancel(operationId: string, reason: string): OperationSnapshot | undefined {
    return this.operationCoordinator.cancel(operationId, reason);
  }
}
