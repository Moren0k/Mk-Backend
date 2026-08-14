import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { PaginatedResult } from '../../contracts/paginated-result';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

function buildContext(headerValue?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-request-id': headerValue } }),
    }),
  } as unknown as ExecutionContext;
}

function buildCallHandler(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('ResponseEnvelopeInterceptor', () => {
  it('wraps the handler result in { data, requestId }', async () => {
    const interceptor = new ResponseEnvelopeInterceptor();

    const result = await firstValueFrom(
      interceptor.intercept(buildContext(), buildCallHandler({ foo: 'bar' })),
    );

    expect(result.data).toEqual({ foo: 'bar' });
    expect(typeof result.requestId).toBe('string');
    expect(result.requestId.length).toBeGreaterThan(0);
  });

  it('reuses X-Request-Id from the incoming request when present', async () => {
    const interceptor = new ResponseEnvelopeInterceptor();

    const result = await firstValueFrom(
      interceptor.intercept(
        buildContext('req-123'),
        buildCallHandler([1, 2, 3]),
      ),
    );

    expect(result.requestId).toBe('req-123');
    expect(result.data).toEqual([1, 2, 3]);
  });

  it('unwraps a PaginatedResult into { data, meta, requestId }', async () => {
    const interceptor = new ResponseEnvelopeInterceptor();
    const paginated = new PaginatedResult([1, 2, 3], { limit: 50, count: 3 });

    const result = await firstValueFrom(
      interceptor.intercept(buildContext(), buildCallHandler(paginated)),
    );

    expect(result.data).toEqual([1, 2, 3]);
    expect(result.meta).toEqual({ limit: 50, count: 3 });
    expect(typeof result.requestId).toBe('string');
  });
});
