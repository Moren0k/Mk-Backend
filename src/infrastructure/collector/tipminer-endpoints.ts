export type TipminerConfig = {
  readonly baseUrl: string;
  readonly providerId: string;
  readonly timezone: string;
};

/**
 * Construye las URLs de la API pública de Tipminer (ver API.md) a partir de
 * la configuración leída de variables de entorno. Nunca hardcodear rutas
 * fuera de este archivo.
 */
export function buildTipminerHistoryUrl(
  config: TipminerConfig,
  limit: number,
): string {
  const query = new URLSearchParams({
    timezone: config.timezone,
    limit: String(limit),
  });

  return `${config.baseUrl}/v1/bac-bo/rounds/${config.providerId}/history?${query.toString()}`;
}

export function buildTipminerLiveUrl(config: TipminerConfig): string {
  return `${config.baseUrl}/v1/bac-bo/rounds/${config.providerId}/live`;
}
