import type { Racha3DistanciaConContexto } from '../../../application/analytics/racha3-analytics.read-model';
import type {
  Racha3BucketDistribucion,
  Racha3ColumnaDistribucion,
  Racha3Entre,
  Racha3Estado,
  Racha3Intervalo,
  Racha3IntervaloMetrica,
  Racha3PorDia,
  Racha3PorHora,
  Racha3Resumen,
} from '../../../core/analytics/types/racha3-analytics.type';
import type { Racha3RunResult } from '../../../core/analytics/types/racha3-run.type';
import {
  UNIDAD_TASAS,
  type Racha3ColumnasVm,
  type Racha3DistanciaVm,
  type Racha3EstadoVm,
  type Racha3IntervalosVm,
  type Racha3PorDiaVm,
  type Racha3PorHoraVm,
  type Racha3ReprocesarVm,
  type Racha3ResumenVm,
} from '../view-models/racha3-analytics.vm';

/**
 * Proyección a los view models de Analytics.
 *
 * Los mappers NO calculan: agrupan y renombran. El único valor derivado que
 * producen es `al_dia` en el estado, que es una comparación de dos números
 * ya presentes en la respuesta y existe para que el cliente no tenga que
 * inventar el criterio.
 *
 * Las tasas pasan tal cual, como fracciones: convertir a porcentaje acá
 * dejaría la unidad dependiendo del endpoint.
 */

const NOTA_HORARIA =
  'Las tasas por hora vienen con su muestra_n. Con la muestra actual, cada hora ronda ' +
  'las ~170 observaciones: diferencias de varios puntos entre horas son compatibles con ' +
  'el azar. Una hora no es mejor por tener mejor tasa.';

const NOTA_DISTANCIA =
  'frecuencia_historica y tasa_empirica_condicionada son magnitudes distintas y no ' +
  'comparables: la primera reparte los intervalos observados y suma 1, la segunda es la ' +
  'proporción de casos en riesgo en los que ocurrió el evento y no suma 1. Ninguna es una ' +
  'probabilidad predictiva; convertirlas en una exige supuestos que estos datos no contienen.';

export function toResumenVm(r: Racha3Resumen): Racha3ResumenVm {
  return {
    unidad_tasas: UNIDAD_TASAS,
    zona_horaria: r.zona_horaria,
    ventana: { desde: r.ventana_desde, hasta: r.ventana_hasta },
    frecuencia: {
      total: r.total,
      resueltas: r.resueltas,
      pendientes: r.pendientes,
      player: r.player,
      banker: r.banker,
      frecuencia_historica_player: r.frecuencia_historica_player,
      frecuencia_historica_banker: r.frecuencia_historica_banker,
    },
    resultados: {
      directa: r.directa,
      mg1: r.mg1,
      mg2: r.mg2,
      perdidas: r.perdidas,
      tasa_directa: r.tasa_directa,
      tasa_mg1: r.tasa_mg1,
      tasa_mg2: r.tasa_mg2,
      tasa_perdida: r.tasa_perdida,
      tasa_acierto_total: r.tasa_acierto_total,
    },
    muestra_n: r.muestra_n,
    muestra_bloqueadas_excluidas: r.muestra_bloqueadas_excluidas,
    muestra_integridad_dudosa: r.muestra_integridad_dudosa,
    advertencia_muestra: r.advertencia_muestra,
  };
}

export function toPorHoraVm(horas: readonly Racha3PorHora[]): Racha3PorHoraVm {
  const primera = horas[0];
  return {
    unidad_tasas: UNIDAD_TASAS,
    zona_horaria: primera?.zona_horaria ?? 'America/Bogota',
    ventana: {
      desde: primera?.ventana_desde ?? null,
      hasta: primera?.ventana_hasta ?? null,
    },
    horas,
    nota: NOTA_HORARIA,
  };
}

export function toPorDiaVm(
  dias: readonly Racha3PorDia[],
  diasPorDefecto: number,
): Racha3PorDiaVm {
  return {
    unidad_tasas: UNIDAD_TASAS,
    zona_horaria: dias[0]?.zona_horaria ?? 'America/Bogota',
    dias_por_defecto: diasPorDefecto,
    dias,
  };
}

export function toIntervalosVm(
  entre: Racha3Entre,
  metrica: Racha3IntervaloMetrica,
  cotas: readonly number[],
  intervalos: readonly Racha3Intervalo[],
  distribucion: readonly Racha3BucketDistribucion[],
): Racha3IntervalosVm {
  return { entre, metrica, cotas, intervalos, distribucion };
}

export function toDistanciaVm(
  contexto: Racha3DistanciaConContexto,
  cotas: readonly number[],
): Racha3DistanciaVm {
  return {
    zona_horaria: contexto.distancia.zona_horaria,
    cotas,
    distancia: contexto.distancia,
    bucket_actual: contexto.bucket_actual,
    buckets: contexto.buckets,
    nota: NOTA_DISTANCIA,
  };
}

export function toColumnasVm(
  columnas: readonly Racha3ColumnaDistribucion[],
  maximo: number,
): Racha3ColumnasVm {
  return { maximo, columnas };
}

export function toEstadoVm(e: Racha3Estado): Racha3EstadoVm {
  return {
    ...e,
    // Único derivado de los mappers: el criterio de "al día" vive acá para
    // que no lo reinvente cada cliente con un umbral distinto.
    al_dia: e.checkpoint_existe && e.jugadas_sin_procesar === 0,
  };
}

export function toReprocesarVm(r: Racha3RunResult): Racha3ReprocesarVm {
  if (r.tipo === 'NO_DISPONIBLE') {
    return {
      tipo: 'INCREMENTAL',
      estado: 'NO_DISPONIBLE',
      hubo_cambios: false,
      ejecucion_id: null,
      desde_jugada_id: null,
      hasta_jugada_id: null,
      jugadas_leidas: 0,
      columnas_afectadas: 0,
      operaciones_afectadas: 0,
      duracion_ms: 0,
      error: r.motivo,
    };
  }

  if (r.tipo === 'ERROR_PROCESO') {
    return {
      tipo: 'INCREMENTAL',
      estado: 'ERROR_PROCESO',
      hubo_cambios: false,
      ejecucion_id: Number(r.ejecucionId),
      desde_jugada_id: null,
      hasta_jugada_id: null,
      jugadas_leidas: 0,
      columnas_afectadas: 0,
      operaciones_afectadas: 0,
      duracion_ms: r.duracionMs,
      error: r.error,
    };
  }

  return {
    tipo: 'INCREMENTAL',
    estado: 'OK',
    hubo_cambios: r.huboCambios,
    ejecucion_id: Number(r.ejecucionId),
    desde_jugada_id: r.desdeJugadaId === null ? null : Number(r.desdeJugadaId),
    hasta_jugada_id: r.hastaJugadaId === null ? null : Number(r.hastaJugadaId),
    jugadas_leidas: r.jugadasLeidas,
    columnas_afectadas: r.columnasAfectadas,
    operaciones_afectadas: r.operacionesAfectadas,
    duracion_ms: r.duracionMs,
    error: null,
  };
}
