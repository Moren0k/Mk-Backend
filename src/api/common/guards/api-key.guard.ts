import { createHash, timingSafeEqual } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const API_KEY_HEADER = 'x-api-key';

type RequestWithHeaders = {
  headers: Record<string, string | string[] | undefined>;
};

/**
 * Hashea el valor recibido (SHA-256) para comparar siempre como hashes con
 * `timingSafeEqual`, nunca en texto plano. Mismo patrón que
 * `application/admin/admin-password.ts::hashPassword`, duplicado aquí a
 * propósito: `api/` no debe depender de `application/admin/` solo por una
 * función de 3 líneas (decisión explícita, ver Mk-Api.md F1).
 */
function hashSecret(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Guard global de la capa API (Anexo D §5): exige el header `X-Api-Key`
 * igual al secreto compartido configurado. Sin JWT, sin roles, un único
 * cliente de confianza (el frontend propio). Las rutas marcadas con
 * `@Public()` (p. ej. health) lo saltan por completo.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expectedKeyHash: Buffer | undefined;

  constructor(
    private readonly reflector: Reflector,
    configService: ConfigService,
  ) {
    const key = configService.get<string>('api.key');
    this.expectedKeyHash = key ? hashSecret(key) : undefined;
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    const header = request.headers[API_KEY_HEADER];
    const candidate = typeof header === 'string' ? header : undefined;

    if (!this.isValidKey(candidate)) {
      throw new UnauthorizedException();
    }

    return true;
  }

  /**
   * Falla cerrado si `API_KEY` no está configurada (mismo criterio que
   * `AdminController`: sin secreto configurado, nunca se acepta nada).
   */
  private isValidKey(candidate: string | undefined): boolean {
    if (!this.expectedKeyHash || !candidate) {
      return false;
    }

    const candidateHash = hashSecret(candidate);
    return (
      candidateHash.length === this.expectedKeyHash.length &&
      timingSafeEqual(candidateHash, this.expectedKeyHash)
    );
  }
}
