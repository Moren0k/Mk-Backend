import { Get, Query } from '@nestjs/common';

import { HistoryReadModel } from '../../../application/read-models/history.read-model';
import { ApiResource } from '../../common/decorators/api-resource.decorator';
import { toHistoryVm } from '../../contracts/mappers/history.mapper';
import { PaginatedResult } from '../../contracts/paginated-result';
import type { HistoryVm } from '../../contracts/view-models/history.vm';

const DEFAULT_LIMIT = 50;
/** Tope real: el ring buffer de HistoryStore nunca guarda más de 200. */
const MAX_LIMIT = 200;

/**
 * GET /api/v1/history — ventana en memoria (Mk-Api.md Anexo D §1, único
 * origen de historial por ahora). `limit` se recorta en silencio al
 * máximo del ring buffer, nunca con error (§8.4).
 */
@ApiResource('history')
export class HistoryController {
  constructor(private readonly historyReadModel: HistoryReadModel) {}

  @Get()
  getHistory(
    @Query('limit') limitParam?: string,
  ): PaginatedResult<HistoryVm[]> {
    const limit = this.resolveLimit(limitParam);
    const items = this.historyReadModel.getWindow(limit).map(toHistoryVm);

    return new PaginatedResult(items, { limit, count: items.length });
  }

  private resolveLimit(raw: string | undefined): number {
    const parsed = raw !== undefined ? Number(raw) : DEFAULT_LIMIT;

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_LIMIT;
    }

    return Math.min(parsed, MAX_LIMIT);
  }
}
