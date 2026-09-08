import type {
  Racha3BucketDistribucion,
  Racha3BucketHazard,
  Racha3ColumnaDistribucion,
  Racha3DistanciaActual,
  Racha3Estado,
  Racha3Intervalo,
  Racha3PorDia,
  Racha3PorHora,
} from '../../../core/analytics/types/racha3-analytics.type';

/**
 * Contrato JSON de `GET /api/v1/analytics/racha3/*`.
 *
 * NOMBRES EN ESPAÑOL, snake_case. Diverge a propósito del resto de la API
 * (`totalGames`, `playerWinRate`), y la razón es que la terminología de
 * este dominio está fijada como parte del contrato, no como estilo:
 * `frecuencia_historica`, `tasa_empirica_condicionada`, `muestra_n`,
 * `advertencia_muestra`. Traducirlas a inglés camelCase (`muestraN`,
 * `empiricalRate`) borraría justamente la distinción que esos nombres
 * existen para sostener. Se mantiene el mismo vocabulario desde la columna
 * de PostgreSQL hasta el JSON, sin ninguna traducción intermedia donde
 * pueda perderse el significado.
 *
 * UNIDAD DE LAS TASAS: fracción en [0,1], nunca porcentaje. Cada respuesta
 * que lleva tasas lo declara en `unidad_tasas`, para que un cliente no
 * pueda multiplicar por 100 dos veces ni ninguna.
 *
 * Ninguna métrica se llama `probabilidad`, `prediccion` ni `confianza`:
 * todo lo que hay acá es descripción de lo que ya ocurrió.
 */

/** Valor único de `unidad_tasas`. Existe para que el contrato sea autodescriptivo. */
export const UNIDAD_TASAS = 'fraccion_0_1';

/** Filtros efectivamente aplicados. Se devuelven siempre: una respuesta que no
 *  dice qué filtró obliga al cliente a recordar qué pidió. */
export type Racha3FiltrosVm = {
  readonly desde: string | null;
  readonly hasta: string | null;
  readonly tipo: string | null;
  readonly incluir_bloqueadas: boolean;
  readonly incluir_integridad_dudosa: boolean;
  readonly umbral_muestra: number;
};

export type Racha3ResumenVm = {
  readonly unidad_tasas: typeof UNIDAD_TASAS;
  readonly zona_horaria: string;
  readonly ventana: {
    readonly desde: string | null;
    readonly hasta: string | null;
  };
  readonly frecuencia: {
    readonly total: number;
    readonly resueltas: number;
    readonly pendientes: number;
    readonly player: number;
    readonly banker: number;
    readonly frecuencia_historica_player: number | null;
    readonly frecuencia_historica_banker: number | null;
  };
  readonly resultados: {
    readonly directa: number;
    readonly mg1: number;
    readonly mg2: number;
    readonly perdidas: number;
    readonly tasa_directa: number | null;
    readonly tasa_mg1: number | null;
    readonly tasa_mg2: number | null;
    readonly tasa_perdida: number | null;
    readonly tasa_acierto_total: number | null;
  };
  readonly muestra_n: number;
  readonly muestra_bloqueadas_excluidas: number;
  readonly muestra_integridad_dudosa: number;
  readonly advertencia_muestra: string | null;
};

export type Racha3PorHoraVm = {
  readonly unidad_tasas: typeof UNIDAD_TASAS;
  readonly zona_horaria: string;
  readonly ventana: {
    readonly desde: string | null;
    readonly hasta: string | null;
  };
  readonly horas: readonly Racha3PorHora[];
  /** Recordatorio de contrato, no un adorno: ver el mapper. */
  readonly nota: string;
};

export type Racha3PorDiaVm = {
  readonly unidad_tasas: typeof UNIDAD_TASAS;
  readonly zona_horaria: string;
  readonly dias_por_defecto: number;
  readonly dias: readonly Racha3PorDia[];
};

export type Racha3IntervalosVm = {
  readonly entre: string;
  readonly metrica: string;
  readonly cotas: readonly number[];
  readonly intervalos: readonly Racha3Intervalo[];
  readonly distribucion: readonly Racha3BucketDistribucion[];
};

export type Racha3DistanciaVm = {
  readonly zona_horaria: string;
  readonly cotas: readonly number[];
  readonly distancia: Racha3DistanciaActual;
  readonly bucket_actual: Racha3BucketHazard | null;
  readonly buckets: readonly Racha3BucketHazard[];
  /** Advertencia de interpretación. Ver el mapper para por qué es obligatoria. */
  readonly nota: string;
};

export type Racha3ColumnasVm = {
  readonly maximo: number;
  readonly columnas: readonly Racha3ColumnaDistribucion[];
};

export type Racha3EstadoVm = Racha3Estado & {
  /** `true` si el procesamiento está al día con la ingesta. */
  readonly al_dia: boolean;
};

export type Racha3ReprocesarVm = {
  readonly tipo: 'INCREMENTAL';
  readonly estado: 'OK' | 'ERROR_PROCESO' | 'NO_DISPONIBLE';
  readonly hubo_cambios: boolean;
  readonly ejecucion_id: number | null;
  readonly desde_jugada_id: number | null;
  readonly hasta_jugada_id: number | null;
  readonly jugadas_leidas: number;
  readonly columnas_afectadas: number;
  readonly operaciones_afectadas: number;
  readonly duracion_ms: number;
  readonly error: string | null;
};
