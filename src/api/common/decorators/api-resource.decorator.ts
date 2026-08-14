import {
  applyDecorators,
  Controller,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { ResponseEnvelopeInterceptor } from '../interceptors/response-envelope.interceptor';

/**
 * Reemplaza a `@Controller()` para todo controller de `src/api/resources/`:
 * aplica el envelope de éxito/error (Mk-Api.md §8.3) y `ApiKeyGuard`
 * (Anexo D §5) a esa capa — y solo a esa capa.
 *
 * A propósito NO se registran vía `APP_FILTER`/`APP_INTERCEPTOR`/
 * `APP_GUARD` (esos tokens son globales a toda la aplicación Nest, sin
 * importar en qué módulo se declaren): `EventsController` (SSE) necesita
 * el filtro y el guard, pero nunca el interceptor de envelope — envolver
 * cada emisión SSE en `{data, requestId}` rompería el contrato
 * `{type, data}` que espera el mecanismo de SSE de Nest (ver
 * `events.controller.ts`). Aplicarlo por controller, no globalmente,
 * mantiene esa excepción explícita en un solo lugar.
 *
 * `@Public()` (en el método, no en la clase) sigue siendo la forma de
 * saltar `ApiKeyGuard` para un endpoint puntual (hoy solo `health`).
 */
export function ApiResource(path?: string | string[]) {
  return applyDecorators(
    Controller(path ?? ''),
    UseFilters(GlobalExceptionFilter),
    UseInterceptors(ResponseEnvelopeInterceptor),
    UseGuards(ApiKeyGuard),
  );
}
