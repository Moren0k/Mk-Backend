import {
  Racha3BucketDistribucion,
  Racha3BucketHazard,
  Racha3ColumnaDistribucion,
  Racha3DistanciaActual,
  Racha3Entre,
  Racha3Estado,
  Racha3Filtros,
  Racha3Intervalo,
  Racha3IntervaloMetrica,
  Racha3PorDia,
  Racha3PorHora,
  Racha3Resumen,
} from '../types/racha3-analytics.type';

/**
 * Puerta de LECTURA hacia las agregaciones de Racha 3.
 *
 * Cada método corresponde exactamente a una función SQL de F6/F7 y no hace
 * nada más que invocarla con sus parámetros. No existe aquí —ni puede
 * existir— un método que combine, promedie, filtre o derive: toda la
 * estadística vive en SQL, se verifica en SQL contra la implementación de
 * referencia en TypeScript (`pnpm analytics:verify`), y duplicar aunque sea
 * un promedio del lado de la aplicación lo dejaría fuera del alcance de esa
 * verificación.
 *
 * Ninguna implementación escribe nada. El único punto del dominio que
 * escribe es `Racha3Processor`, y es una interfaz aparte a propósito: así el
 * tipo hace evidente qué puede y qué no puede hacer cada consumidor.
 */
export interface Racha3AnalyticsReader {
  resumen(filtros: Racha3Filtros): Promise<Racha3Resumen>;

  porHora(filtros: Racha3Filtros): Promise<readonly Racha3PorHora[]>;

  porDia(filtros: Racha3Filtros): Promise<readonly Racha3PorDia[]>;

  intervalos(
    entre: Racha3Entre,
    filtros: Racha3Filtros,
  ): Promise<readonly Racha3Intervalo[]>;

  distribucion(
    metrica: Racha3IntervaloMetrica,
    cotas: readonly number[],
    entre: Racha3Entre,
    filtros: Racha3Filtros,
  ): Promise<readonly Racha3BucketDistribucion[]>;

  hazardDistancia(
    cotas: readonly number[],
    filtros: Racha3Filtros,
  ): Promise<readonly Racha3BucketHazard[]>;

  /**
   * `incluirBloqueadas` debe coincidir con el usado en `hazardDistancia`:
   * la distancia sólo es comparable contra los buckets si se mide sobre la
   * misma serie con la que se construyeron.
   */
  distanciaActual(incluirBloqueadas: boolean): Promise<Racha3DistanciaActual>;

  columnasDistribucion(
    tipo: 'PLAYER' | 'BANKER' | undefined,
    maximo: number,
  ): Promise<readonly Racha3ColumnaDistribucion[]>;

  estado(): Promise<Racha3Estado>;
}
