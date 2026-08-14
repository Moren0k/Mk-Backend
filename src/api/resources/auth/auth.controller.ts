import { createHash, timingSafeEqual } from 'node:crypto';

import {
  Body,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';

import { ApiResource } from '../../common/decorators/api-resource.decorator';
import { Public } from '../../common/decorators/public.decorator';

type LoginBody = {
  readonly password?: unknown;
};

type LoginResponse = {
  readonly apiKey: string;
};

/**
 * Hashea el valor recibido (SHA-256) para comparar siempre como hashes con
 * `timingSafeEqual`, nunca en texto plano. Mismo patrón que `ApiKeyGuard`
 * (`api-key.guard.ts`), duplicado a propósito: son 3 líneas, no vale la
 * pena una dependencia cruzada por tan poco.
 */
function hashSecret(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * POST /api/v1/auth/login — Login Gateway del panel frontend (AccessGate):
 * compara `password` contra `ACCESS_PASSWORD` (env, nunca en el frontend)
 * y, si acierta, devuelve la `X-Api-Key` real. Con esto, ni la contraseña
 * ni la API key quedan jamás incrustadas en el JS compilado del frontend
 * — solo viajan una vez, por HTTPS, al momento de loguearse.
 *
 * `@Public()` salta `ApiKeyGuard` (el cliente aún no tiene la key en este
 * punto). `@Throttle()` reemplaza el límite global (300/min, ver
 * `AppModule`) por uno mucho más estricto: este es ahora el único punto de
 * la API donde tiene sentido un ataque de fuerza bruta.
 */
@ApiResource('auth')
export class AuthController {
  private readonly expectedPasswordHash: Buffer | undefined;
  private readonly apiKey: string | undefined;

  constructor(configService: ConfigService) {
    const password = configService.get<string>('auth.accessPassword');
    this.expectedPasswordHash = password ? hashSecret(password) : undefined;
    this.apiKey = configService.get<string>('api.key');
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() body: LoginBody): LoginResponse {
    const candidate = typeof body?.password === 'string' ? body.password : '';

    if (!this.isValidPassword(candidate) || !this.apiKey) {
      throw new UnauthorizedException('Contraseña incorrecta.');
    }

    return { apiKey: this.apiKey };
  }

  /**
   * Falla cerrado si `ACCESS_PASSWORD` no está configurada (mismo criterio
   * que `ApiKeyGuard`): sin secreto configurado, nunca se acepta nada.
   */
  private isValidPassword(candidate: string): boolean {
    if (!this.expectedPasswordHash || candidate.length === 0) {
      return false;
    }

    const candidateHash = hashSecret(candidate);
    return (
      candidateHash.length === this.expectedPasswordHash.length &&
      timingSafeEqual(candidateHash, this.expectedPasswordHash)
    );
  }
}
