import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca una ruta como exenta de `ApiKeyGuard` (Anexo D §5: el único
 * endpoint público planeado es `GET /api/v1/health`). Nunca se usa para
 * saltar validación ni para lógica de negocio, solo autenticación.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
