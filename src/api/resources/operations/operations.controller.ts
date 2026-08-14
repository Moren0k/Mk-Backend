import {
  BadRequestException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { OperationsReadModel } from '../../../application/read-models/operations.read-model';
import type { StrategyGroup } from '../../../core/strategy/strategy-group';
import { ApiResource } from '../../common/decorators/api-resource.decorator';
import { toOperationVm } from '../../contracts/mappers/operation.mapper';
import type { OperationVm } from '../../contracts/view-models/operation.vm';

const VALID_CHANNELS: ReadonlySet<string> = new Set(['oficial', 'pruebas']);
const CANCEL_REASON = 'Cancelada manualmente desde la API.';

/**
 * `GET /api/v1/operations?channel=oficial|pruebas` (Mk-Api.md Anexo D
 * §2: dos páginas separadas en el frontend, nunca una vista combinada;
 * `channel` es obligatorio) y `POST /api/v1/operations/:id/cancel`
 * (Anexo D §4).
 */
@ApiResource('operations')
export class OperationsController {
  constructor(private readonly operationsReadModel: OperationsReadModel) {}

  @Get()
  getOperations(@Query('channel') channel?: string): OperationVm[] {
    const validatedChannel = this.validateChannel(channel);

    return this.operationsReadModel
      .getActiveByChannel(validatedChannel)
      .map(toOperationVm);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancelOperation(@Param('id') operationId: string): OperationVm {
    const snapshot = this.operationsReadModel.cancel(
      operationId,
      CANCEL_REASON,
    );

    if (!snapshot) {
      throw new NotFoundException(
        `No hay una operación activa con id "${operationId}".`,
      );
    }

    return toOperationVm(snapshot);
  }

  private validateChannel(candidate: string | undefined): StrategyGroup {
    if (!candidate || !VALID_CHANNELS.has(candidate)) {
      throw new BadRequestException(
        'El parámetro "channel" es obligatorio y debe ser "oficial" o "pruebas".',
      );
    }

    return candidate as StrategyGroup;
  }
}
