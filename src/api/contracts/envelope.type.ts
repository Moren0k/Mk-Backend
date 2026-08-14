import { ApiErrorCode } from './errors/api-error-code.enum';

/**
 * Forma única de toda respuesta exitosa de la API (Mk-Api.md §8.3).
 * `meta` solo aparece cuando hay paginación/metadata útil; `data` siempre
 * es el view model (nunca una entidad interna).
 */
export type SuccessEnvelope<T> = {
  readonly data: T;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly requestId: string;
};

export type ApiErrorDetail = Readonly<Record<string, unknown>>;

/**
 * Forma única de toda respuesta de error (Mk-Api.md §8.3/§8.5). Nunca
 * incluye stack traces; `details` es opcional y solo para errores de
 * validación.
 */
export type ErrorEnvelope = {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details?: ReadonlyArray<ApiErrorDetail>;
    readonly requestId: string;
    readonly timestamp: string;
  };
};
