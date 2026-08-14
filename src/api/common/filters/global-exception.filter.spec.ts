import {
  BadRequestException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';

import { ApiErrorCode } from '../../contracts/errors/api-error-code.enum';
import type { ErrorEnvelope } from '../../contracts/envelope.type';
import { GlobalExceptionFilter } from './global-exception.filter';

function buildHost(headerValue?: string) {
  const send = jest.fn();
  const status = jest.fn().mockReturnValue({ send });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ headers: { 'x-request-id': headerValue } }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, send };
}

function sentBody(send: jest.Mock): ErrorEnvelope {
  const [body] = send.mock.calls[0] as unknown[];
  return body as ErrorEnvelope;
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  it('maps NotFoundException to a 404 NOT_FOUND envelope, reusing X-Request-Id', () => {
    const { host, status, send } = buildHost('req-1');

    filter.catch(new NotFoundException('No existe'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    const body = sentBody(send);
    expect(body.error.code).toBe(ApiErrorCode.NOT_FOUND);
    expect(body.error.message).toBe('No existe');
    expect(body.error.requestId).toBe('req-1');
  });

  it('maps UnauthorizedException to a 401 UNAUTHORIZED envelope', () => {
    const { host, status, send } = buildHost();

    filter.catch(new UnauthorizedException(), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(sentBody(send).error.code).toBe(ApiErrorCode.UNAUTHORIZED);
  });

  it('flattens class-validator style array messages into details', () => {
    const { host, send } = buildHost();

    filter.catch(
      new BadRequestException({
        message: [
          'channel debe ser oficial o pruebas',
          'limit debe ser numérico',
        ],
      }),
      host,
    );

    const body = sentBody(send);
    expect(body.error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
    expect(body.error.details).toEqual([
      { reason: 'channel debe ser oficial o pruebas' },
      { reason: 'limit debe ser numérico' },
    ]);
  });

  it('never leaks internal error details for unexpected exceptions', () => {
    const { host, status, send } = buildHost();

    filter.catch(new Error('detalle interno sensible'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = sentBody(send);
    expect(body.error.code).toBe(ApiErrorCode.INTERNAL);
    expect(body.error.message).toBe('Error interno inesperado.');
  });

  it('generates a requestId when the client does not send X-Request-Id', () => {
    const { host, send } = buildHost();

    filter.catch(new NotFoundException(), host);

    const body = sentBody(send);
    expect(typeof body.error.requestId).toBe('string');
    expect(body.error.requestId.length).toBeGreaterThan(0);
  });
});
