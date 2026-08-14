import { randomUUID } from 'node:crypto';

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

import type { SuccessEnvelope } from '../../contracts/envelope.type';
import { PaginatedResult } from '../../contracts/paginated-result';

type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

/**
 * Envuelve toda respuesta exitosa en `{ data, meta?, requestId }`
 * (Mk-Api.md §8.3). Un controller que devuelve un `PaginatedResult` suma
 * `meta`; cualquier otro valor se envuelve tal cual como `data` — nunca se
 * intenta adivinar la forma de una respuesta por duck-typing.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessEnvelope<T>> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const requestId = this.resolveRequestId(request);

    return next
      .handle()
      .pipe(map((result) => this.buildEnvelope(result, requestId)));
  }

  private buildEnvelope(
    result: T | PaginatedResult<T>,
    requestId: string,
  ): SuccessEnvelope<T> {
    if (result instanceof PaginatedResult) {
      return { data: result.data, meta: result.meta, requestId };
    }

    return { data: result, requestId };
  }

  private resolveRequestId(request: RequestLike): string {
    const header = request.headers['x-request-id'];
    return typeof header === 'string' ? header : randomUUID();
  }
}
