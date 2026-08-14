import { Get } from '@nestjs/common';

import { StrategyCatalogReadModel } from '../../../application/read-models/strategy-catalog.read-model';
import { ApiResource } from '../../common/decorators/api-resource.decorator';
import { toStrategyVm } from '../../contracts/mappers/strategy.mapper';
import type { StrategyVm } from '../../contracts/view-models/strategy.vm';

/**
 * GET /api/v1/strategies — catálogo de estrategias registradas en
 * `StrategyModule`, para el selector del frontend en `PATCH
 * /api/v1/channels/:channel`.
 */
@ApiResource('strategies')
export class StrategiesController {
  constructor(private readonly strategyCatalog: StrategyCatalogReadModel) {}

  @Get()
  getStrategies(): StrategyVm[] {
    return this.strategyCatalog.list().map(toStrategyVm);
  }
}
