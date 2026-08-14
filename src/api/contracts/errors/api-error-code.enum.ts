/**
 * Códigos de error máquina estables de la API (Mk-Api.md §8.5). Un único
 * catálogo cerrado: agregar un código nuevo es una decisión de contrato,
 * no un detalle de cada controller.
 */
export enum ApiErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL = 'INTERNAL',
  UNAVAILABLE = 'UNAVAILABLE',
  DEPENDENCY_DOWN = 'DEPENDENCY_DOWN',
}
