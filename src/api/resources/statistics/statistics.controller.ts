import { Get } from '@nestjs/common';

import { StatisticsService } from '../../../application/statistics/statistics.service';
import { ApiResource } from '../../common/decorators/api-resource.decorator';
import { toStatisticsVm } from '../../contracts/mappers/statistics.mapper';
import type { StatisticsVm } from '../../contracts/view-models/statistics.vm';

/**
 * GET /api/v1/statistics — proyecta `StatisticsService.getSnapshot()`
 * (acumulado histórico total, ver Mk-Api.md §2.1b). Nunca recalcula nada:
 * el contador ya es O(1) en `core/statistics`.
 */
@ApiResource('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get()
  getStatistics(): StatisticsVm {
    return toStatisticsVm(this.statisticsService.getSnapshot());
  }
}
