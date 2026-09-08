/**
 * Tipos de la capa de consulta de Analytics "Racha 3".
 *
 * Espejo de lo que devuelven las funciones SQL de F6/F7, pero en tipos
 * PLANOS de TypeScript: `number`, `string`, `boolean`, `null`. Nunca
 * `BigInt` ni `Decimal`.
 *
 * Esa restricción no es estética. Prisma devuelve las columnas `bigint`
 * como `BigInt` y las `numeric` como `Decimal`, y ninguno de los dos
 * sobrevive a `JSON.stringify`: un `BigInt` lanza "Do not know how to
 * serialize a BigInt" y un `Decimal` se serializa como un objeto interno.
 * Convertirlos es responsabilidad del reader de `infrastructure/`, de modo
 * que ni `core/` ni `api/` puedan recibir un tipo del ORM por accidente.
 *
 * Los identificadores de jugada viajan como `number`: `jugadas.id` es
 * bigint en la base, pero al ritmo real de la mesa (~2.600 jugadas/día)
 * tardaría más que la edad del universo en acercarse a `2^53`.
 *
 * TODAS las proporciones son fracciones en [0,1], igual que en SQL. La
 * conversión a porcentaje, si hace falta, es decisión de quien presenta.
 */

/** Filtros comunes a toda consulta de agregación. */
export type Racha3Filtros = {
  /** Inicio de la ventana sobre `confirmacion_en`, inclusive. */
  readonly desde?: Date;
  /** Fin de la ventana, EXCLUSIVE. */
  readonly hasta?: Date;
  readonly tipo?: 'PLAYER' | 'BANKER';
  /**
   * Oportunidades que el motor real no habría podido operar. `false` por
   * defecto: el consumidor natural de estas métricas es el Core.
   */
  readonly incluirBloqueadas: boolean;
  /**
   * Oportunidades con un hueco del historial en su ventana. `true` por
   * defecto — son observaciones reales de lo que quedó registrado — pero
   * su cantidad viaja siempre en `muestra_integridad_dudosa`.
   */
  readonly incluirIntegridadDudosa: boolean;
  /** Bajo este `muestra_n` se emite `advertencia_muestra`. */
  readonly umbralMuestra: number;
};

export type Racha3Resumen = {
  readonly total: number;
  readonly resueltas: number;
  readonly pendientes: number;
  readonly player: number;
  readonly banker: number;
  readonly frecuencia_historica_player: number | null;
  readonly frecuencia_historica_banker: number | null;
  readonly directa: number;
  readonly mg1: number;
  readonly mg2: number;
  readonly perdidas: number;
  readonly tasa_directa: number | null;
  readonly tasa_mg1: number | null;
  readonly tasa_mg2: number | null;
  readonly tasa_perdida: number | null;
  readonly tasa_acierto_total: number | null;
  readonly muestra_n: number;
  readonly muestra_bloqueadas_excluidas: number;
  readonly muestra_integridad_dudosa: number;
  readonly ventana_desde: string | null;
  readonly ventana_hasta: string | null;
  readonly zona_horaria: string;
  readonly advertencia_muestra: string | null;
};

export type Racha3PorHora = {
  readonly hora_col: number;
  readonly total: number;
  readonly frecuencia_historica: number | null;
  readonly resueltas: number;
  readonly directa: number;
  readonly mg1: number;
  readonly mg2: number;
  readonly perdidas: number;
  readonly tasa_directa: number | null;
  readonly tasa_mg1: number | null;
  readonly tasa_mg2: number | null;
  readonly tasa_perdida: number | null;
  readonly tasa_acierto_total: number | null;
  readonly muestra_n: number;
  readonly muestra_integridad_dudosa: number;
  readonly ventana_desde: string | null;
  readonly ventana_hasta: string | null;
  readonly zona_horaria: string;
  readonly advertencia_muestra: string | null;
};

export type Racha3PorDia = {
  readonly dia_col: string;
  readonly total: number;
  readonly resueltas: number;
  readonly directa: number;
  readonly mg1: number;
  readonly mg2: number;
  readonly perdidas: number;
  readonly tasa_acierto_total: number | null;
  readonly tasa_perdida: number | null;
  readonly muestra_n: number;
  readonly muestra_integridad_dudosa: number;
  readonly zona_horaria: string;
  readonly advertencia_muestra: string | null;
};

export type Racha3IntervaloMetrica = 'jugadas' | 'columnas' | 'segundos';

/** Sobre qué serie se miden las distancias. */
export type Racha3Entre = 'RACHA3' | 'PERDIDAS';

export type Racha3Intervalo = {
  readonly metrica: string;
  readonly muestra_n: number;
  readonly minimo: number | null;
  readonly p25: number | null;
  readonly mediana: number | null;
  readonly p75: number | null;
  readonly p90: number | null;
  readonly p99: number | null;
  readonly maximo: number | null;
  readonly promedio: number | null;
  readonly desviacion: number | null;
  readonly advertencia_muestra: string | null;
};

export type Racha3BucketDistribucion = {
  readonly bucket: string;
  readonly orden: number;
  readonly n: number;
  readonly frecuencia_historica: number | null;
  readonly muestra_n: number;
  readonly metrica: string;
};

export type Racha3BucketHazard = {
  readonly bucket: string;
  readonly orden: number;
  readonly casos_observados: number;
  readonly eventos: number;
  /**
   * Hazard empírico: eventos / casos en riesgo. NO suma 1 entre buckets y
   * NO es comparable con `frecuencia_historica`. Tampoco es una
   * probabilidad predictiva — convertirla en una exige supuestos que estos
   * datos no contienen.
   */
  readonly tasa_empirica_condicionada: number | null;
  readonly intervalos_en_bucket: number;
  /** Proporción de intervalos cuyo largo cayó en el bucket. Suma 1. */
  readonly frecuencia_historica: number | null;
  readonly muestra_n: number;
  readonly advertencia_muestra: string | null;
};

export type Racha3DistanciaActual = {
  readonly jugadas_desde_ultima: number | null;
  readonly jugadas_sin_procesar: number;
  /** `false` si hay rezago: la distancia informada podría ser mayor que la real. */
  readonly distancia_exacta: boolean;
  readonly ultima_jugada_confirmacion_id: number | null;
  readonly ultima_confirmacion_en: string | null;
  readonly ultima_hora_col: number | null;
  readonly ultima_tipo_racha: string | null;
  readonly ultima_estado: string | null;
  readonly ultima_resultado_final: string | null;
  readonly jugada_mas_reciente_id: number | null;
  readonly jugada_mas_reciente_en: string | null;
  readonly zona_horaria: string;
};

export type Racha3ColumnaDistribucion = {
  readonly tipo: string;
  readonly longitud: string;
  readonly orden: number;
  readonly n: number;
  readonly frecuencia_historica: number | null;
  /** Columnas cuya longitud observada pudo quedar cortada por un hueco. */
  readonly truncadas: number;
  readonly muestra_n: number;
};

export type Racha3Estado = {
  readonly checkpoint_existe: boolean;
  readonly ultima_jugada_procesada: number | null;
  readonly ultima_jugada_procesada_en: string | null;
  readonly reproceso_desde_jugada_id: number | null;
  readonly checkpoint_actualizado_en: string | null;
  readonly jugadas_sin_procesar: number;
  readonly jugada_mas_reciente_id: number | null;
  readonly jugada_mas_reciente_en: string | null;
  readonly total_jugadas: number;
  readonly total_columnas: number;
  readonly total_oportunidades: number;
  readonly oportunidades_pendientes: number;
  readonly ejecucion_id: number | null;
  readonly ejecucion_tipo: string | null;
  readonly ejecucion_estado: string | null;
  readonly ejecucion_error: string | null;
  readonly ejecucion_duracion_ms: number | null;
  readonly ejecucion_en: string | null;
};
