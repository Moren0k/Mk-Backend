import { Module } from '@nestjs/common';

import { HistoryModule } from '../history/history.module';
import { DistributionMetric } from './distribution.metric';

/**
 * Módulo mínimo para DistributionMetric. Importa HistoryModule porque
 * DistributionMetric depende de HISTORY_STORE para leer el historial.
 *
 * Solo exporta la clase concreta: una sola métrica no justifica interfaces
 * ni multi-providers. Cuando existan 2+ métricas con un consumidor
 * polimórfico, se podrá extraer la interfaz retroactivamente.
 */
@Module({
  imports: [HistoryModule],
  providers: [DistributionMetric],
  exports: [DistributionMetric],
})
export class DistributionMetricModule {}
