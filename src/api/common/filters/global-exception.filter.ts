import { randomUUID } from 'node:crypto';

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import type { ErrorEnvelope } from '../../contracts/envelope.type';
import { ApiErrorCode } from '../../contracts/errors/api-error-code.enum';

type ReplyLike = {
  status: (code: number) => { send: (body: unknown) => void };
};

type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

type DescribedError = {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly details?: ReadonlyArray<Record<string, unknown>>;
};

const INTERNAL_SERVER_ERROR_STATUS: number = HttpStatus.INTERNAL_SERVER_ERROR;

const ERROR_CODE_BY_STATUS: Readonly<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ApiErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ApiErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ApiErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ApiErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ApiErrorCode.CONFLICT,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ApiErrorCode.VALIDATION_ERROR,
  [HttpStatus.TOO_MANY_REQUESTS]: ApiErrorCode.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ApiErrorCode.UNAVAILABLE,
};

/**
 * Único punto de conversión excepción → envelope de error (Mk-Api.md
 * §8.3/§8.5). Nunca deja pasar un stack trace ni un mensaje interno hacia
 * el cliente en un 500: eso solo se loguea.
 *
 * El request-id se lee de `X-Request-Id` si el cliente lo mandó, o se
 * genera aquí mismo. Propagarlo desde una fase temprana del pipeline (para
 * que coincida con logs de guards/interceptors anteriores al fallo) es
 * trabajo de F2 (ver Mk-Api.md, tabla de fases) — este filtro ya expone la
 * forma final del contrato sin esperar a esa mejora.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<ReplyLike>();
    const request = ctx.getRequest<RequestLike>();
    const requestId = this.resolveRequestId(request);
    const described = this.describe(exception);

    if (described.status >= INTERNAL_SERVER_ERROR_STATUS) {
      this.logger.error(
        `[${requestId}] ${described.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ErrorEnvelope = {
      error: {
        code: described.code,
        message: described.message,
        ...(described.details ? { details: described.details } : {}),
        requestId,
        timestamp: new Date().toISOString(),
      },
    };

    reply.status(described.status).send(body);
  }

  private resolveRequestId(request: RequestLike): string {
    const header = request.headers['x-request-id'];
    return typeof header === 'string' ? header : randomUUID();
  }

  private describe(exception: unknown): DescribedError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const { message, details } = this.describeResponse(
        exception.getResponse(),
        exception.message,
      );

      return {
        status,
        code: ERROR_CODE_BY_STATUS[status] ?? ApiErrorCode.INTERNAL,
        message,
        details,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ApiErrorCode.INTERNAL,
      message: 'Error interno inesperado.',
    };
  }

  /**
   * `ValidationPipe` (F2+) reporta arreglos de mensajes de
   * `class-validator` bajo `.message`; ese caso se aplana a `details` para
   * que el cliente pueda mapearlos campo a campo en vez de parsear texto.
   */
  private describeResponse(
    response: string | object,
    fallbackMessage: string,
  ): { message: string; details?: ReadonlyArray<Record<string, unknown>> } {
    if (typeof response === 'string') {
      return { message: response };
    }

    const body = response as { message?: unknown };

    if (Array.isArray(body.message)) {
      return {
        message: 'Reglas de validación violadas.',
        details: body.message.map((reason) => ({ reason: String(reason) })),
      };
    }

    if (typeof body.message === 'string') {
      return { message: body.message };
    }

    return { message: fallbackMessage };
  }
}
