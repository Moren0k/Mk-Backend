import { Controller, Sse, UseFilters, UseGuards } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable, map } from 'rxjs';

import { EventsReadModel } from '../../../application/read-models/events.read-model';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';

/**
 * GET /api/v1/events/stream (SSE) — Mk-Api.md §13/F5, Anexo D §9/§10:
 * jugada en vivo + % rodante (200/50) + eventos de operación, todo por el
 * mismo canal.
 *
 * A propósito NO usa `@ApiResource()`: `ResponseEnvelopeInterceptor`
 * envolvería cada emisión en `{data, requestId}`, rompiendo el contrato
 * `{type, data}` que espera el mecanismo de SSE de Nest (ver
 * `sse-stream.js` en `@nestjs/core`). El filtro de errores y el guard de
 * autenticación sí aplican igual que en el resto de la API.
 */
@Controller('events')
@UseFilters(GlobalExceptionFilter)
@UseGuards(ApiKeyGuard)
export class EventsController {
  constructor(private readonly eventsReadModel: EventsReadModel) {}

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return this.eventsReadModel
      .stream()
      .pipe(map((event) => ({ type: event.type, data: event })));
  }
}
