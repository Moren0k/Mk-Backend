import { Module } from '@nestjs/common';

import { OperationModule } from '../operation/operation.module';
import { StrategyChannelRegistry } from './strategy-channel-registry';

/**
 * Módulo propio para `StrategyChannelRegistry` (Mk-Api.md Anexo D §3):
 * lo consumen `StrategyModule` (como `StrategyConfigProvider` de
 * `StrategyCoordinator`), `NotificationModule` (enrutamiento/alertas) y
 * `api/resources/channels`, sin que ninguno dependa de los otros dos solo
 * para llegar a esta clase. Importa `OperationModule` porque el registro
 * usa `STRATEGY_EXECUTION_GUARD` para bloquear una reasignación mientras
 * la estrategia tiene una operación activa.
 */
@Module({
  imports: [OperationModule],
  providers: [StrategyChannelRegistry],
  exports: [StrategyChannelRegistry],
})
export class StrategyChannelRegistryModule {}
