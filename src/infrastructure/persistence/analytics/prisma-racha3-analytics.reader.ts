import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import type { Racha3AnalyticsReader } from '../../../core/analytics/interfaces/racha3-analytics-reader.interface';
import type {
  Racha3BucketDistribucion,
  Racha3BucketHazard,
  Racha3ColumnaDistribucion,
  Racha3DistanciaActual,
  Racha3Entre,
  Racha3Estado,
  Racha3Filtros,
  Racha3Intervalo,
  Racha3IntervaloMetrica,
  Racha3LadosJugadas,
  Racha3PorDia,
  Racha3PorHora,
  Racha3Resumen,
  Racha3TiesNivel,
} from '../../../core/analytics/types/racha3-analytics.type';
import { PrismaService } from '../prisma.service';

/**
 * Convierte lo que devuelve Prisma en tipos planos de JavaScript.
 *
 * Es la razón de existir de esta clase tanto como las consultas. Prisma
 * entrega las columnas `bigint` como `BigInt` y las `numeric` como
 * `Decimal`, y ninguno de los dos sobrevive a `JSON.stringify`: devolver
 * una fila cruda desde un controller produciría un 500 con "Do not know
 * how to serialize a BigInt". La frontera de conversión está acá para que
 * ni `core/` ni `api/` puedan recibir un tipo del ORM.
 */
function aNumero(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return Number(v);
}

function aNumeroONulo(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return aNumero(v);
}

/**
 * Texto plano desde un valor desconocido.
 *
 * Nunca `String(v)` a secas sobre `unknown`: si llegara un objeto (un
 * `Decimal` donde se esperaba texto, por ejemplo) produciría el literal
 * "[object Object]" y el contrato quedaría con un dato inservible que
 * ningún tipo detectaría. Se serializa en su lugar.
 */
function aTexto(v: unknown): string {
  if (typeof v === 'string') return v;
  if (
    typeof v === 'number' ||
    typeof v === 'bigint' ||
    typeof v === 'boolean'
  ) {
    return v.toString();
  }
  return JSON.stringify(v) ?? '';
}

function aIsoONulo(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : aTexto(v);
}

function aTextoONulo(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return aTexto(v);
}

/** `date` de PostgreSQL: sólo el día, sin arrastrar hora ni zona. */
function aFechaONulo(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v === null || v === undefined ? '' : aTexto(v);
}

type Fila = Record<string, unknown>;

/**
 * Lista de parámetros de los filtros comunes, con CAST EXPLÍCITO.
 *
 * Los casts no son decorativos: Prisma infiere el tipo de cada parámetro
 * desde el valor de JavaScript, y para un entero envía `bigint`. Como las
 * funciones declaran `integer`, PostgreSQL no encuentra ninguna firma que
 * coincida y falla en tiempo de ejecución con
 * `function racha3_resumen(...) does not exist`. Un `null` sin cast llega
 * como `unknown` y agrava el problema. Depender de la inferencia para
 * resolver una sobrecarga es frágil incluso cuando funciona.
 */
const FILTROS_SQL =
  '$1::timestamptz,$2::timestamptz,$3::text,$4::boolean,$5::boolean,$6::integer';

/**
 * Implementación real de `Racha3AnalyticsReader`: una llamada por método a
 * la función SQL correspondiente de F6/F7, con parámetros posicionales.
 *
 * Cero estadística del lado de TypeScript: ni un promedio, ni un
 * porcentaje, ni un filtro adicional. Las funciones SQL ya devuelven la
 * forma final; acá sólo se traducen tipos.
 *
 * Si la persistencia no está disponible lanza `ServiceUnavailableException`,
 * que el filtro global de la API traduce a `503 UNAVAILABLE` (Mk-Api.md
 * §8.5) — a diferencia del scheduler, que en ese caso simplemente no
 * procesa: un cliente que pregunta merece una respuesta explícita.
 */
@Injectable()
export class PrismaRacha3AnalyticsReader implements Racha3AnalyticsReader {
  constructor(private readonly prisma: PrismaService) {}

  async resumen(f: Racha3Filtros): Promise<Racha3Resumen> {
    const [fila] = await this.consultar(
      `SELECT * FROM racha3_resumen(${FILTROS_SQL})`,
      ...this.filtrosComunes(f),
    );
    return this.mapResumen(fila);
  }

  async porHora(f: Racha3Filtros): Promise<readonly Racha3PorHora[]> {
    const filas = await this.consultar(
      `SELECT * FROM racha3_por_hora(${FILTROS_SQL})`,
      ...this.filtrosComunes(f),
    );
    return filas.map((r) => ({
      hora_col: aNumero(r.hora_col),
      total: aNumero(r.total),
      frecuencia_historica: aNumeroONulo(r.frecuencia_historica),
      resueltas: aNumero(r.resueltas),
      directa: aNumero(r.directa),
      mg1: aNumero(r.mg1),
      mg2: aNumero(r.mg2),
      perdidas: aNumero(r.perdidas),
      tasa_directa: aNumeroONulo(r.tasa_directa),
      tasa_mg1: aNumeroONulo(r.tasa_mg1),
      tasa_mg2: aNumeroONulo(r.tasa_mg2),
      tasa_perdida: aNumeroONulo(r.tasa_perdida),
      tasa_acierto_total: aNumeroONulo(r.tasa_acierto_total),
      muestra_n: aNumero(r.muestra_n),
      muestra_integridad_dudosa: aNumero(r.muestra_integridad_dudosa),
      ventana_desde: aIsoONulo(r.ventana_desde),
      ventana_hasta: aIsoONulo(r.ventana_hasta),
      zona_horaria: aTexto(r.zona_horaria),
      advertencia_muestra: aTextoONulo(r.advertencia_muestra),
    }));
  }

  async porDia(f: Racha3Filtros): Promise<readonly Racha3PorDia[]> {
    const filas = await this.consultar(
      `SELECT * FROM racha3_por_dia(${FILTROS_SQL})`,
      ...this.filtrosComunes(f),
    );
    return filas.map((r) => ({
      dia_col: aFechaONulo(r.dia_col),
      total: aNumero(r.total),
      resueltas: aNumero(r.resueltas),
      directa: aNumero(r.directa),
      mg1: aNumero(r.mg1),
      mg2: aNumero(r.mg2),
      perdidas: aNumero(r.perdidas),
      tasa_acierto_total: aNumeroONulo(r.tasa_acierto_total),
      tasa_perdida: aNumeroONulo(r.tasa_perdida),
      muestra_n: aNumero(r.muestra_n),
      muestra_integridad_dudosa: aNumero(r.muestra_integridad_dudosa),
      zona_horaria: aTexto(r.zona_horaria),
      advertencia_muestra: aTextoONulo(r.advertencia_muestra),
    }));
  }

  async intervalos(
    entre: Racha3Entre,
    f: Racha3Filtros,
  ): Promise<readonly Racha3Intervalo[]> {
    const filas = await this.consultar(
      `SELECT * FROM racha3_intervalos($1::text,$2::timestamptz,$3::timestamptz,$4::text,$5::boolean,$6::boolean,$7::integer)`,
      entre,
      ...this.filtrosComunes(f),
    );
    return filas.map((r) => ({
      metrica: aTexto(r.metrica),
      muestra_n: aNumero(r.muestra_n),
      minimo: aNumeroONulo(r.minimo),
      p25: aNumeroONulo(r.p25),
      mediana: aNumeroONulo(r.mediana),
      p75: aNumeroONulo(r.p75),
      p90: aNumeroONulo(r.p90),
      p99: aNumeroONulo(r.p99),
      maximo: aNumeroONulo(r.maximo),
      promedio: aNumeroONulo(r.promedio),
      desviacion: aNumeroONulo(r.desviacion),
      advertencia_muestra: aTextoONulo(r.advertencia_muestra),
    }));
  }

  async distribucion(
    metrica: Racha3IntervaloMetrica,
    cotas: readonly number[],
    entre: Racha3Entre,
    f: Racha3Filtros,
  ): Promise<readonly Racha3BucketDistribucion[]> {
    const [desde, hasta, tipo, bloq, integ] = this.filtrosComunes(f);
    const filas = await this.consultar(
      `SELECT * FROM racha3_distribucion($1::text,$2::integer[],$3::text,$4::timestamptz,$5::timestamptz,$6::text,$7::boolean,$8::boolean)`,
      metrica,
      [...cotas],
      entre,
      desde,
      hasta,
      tipo,
      bloq,
      integ,
    );
    return filas.map((r) => ({
      bucket: aTexto(r.bucket),
      orden: aNumero(r.orden),
      n: aNumero(r.n),
      frecuencia_historica: aNumeroONulo(r.frecuencia_historica),
      muestra_n: aNumero(r.muestra_n),
      metrica: aTexto(r.metrica),
    }));
  }

  async hazardDistancia(
    cotas: readonly number[],
    f: Racha3Filtros,
  ): Promise<readonly Racha3BucketHazard[]> {
    const filas = await this.consultar(
      `SELECT * FROM racha3_hazard_distancia($1::integer[],$2::timestamptz,$3::timestamptz,$4::text,$5::boolean,$6::boolean,$7::integer)`,
      [...cotas],
      ...this.filtrosComunes(f),
    );
    return filas.map((r) => ({
      bucket: aTexto(r.bucket),
      orden: aNumero(r.orden),
      casos_observados: aNumero(r.casos_observados),
      eventos: aNumero(r.eventos),
      tasa_empirica_condicionada: aNumeroONulo(r.tasa_empirica_condicionada),
      intervalos_en_bucket: aNumero(r.intervalos_en_bucket),
      frecuencia_historica: aNumeroONulo(r.frecuencia_historica),
      muestra_n: aNumero(r.muestra_n),
      advertencia_muestra: aTextoONulo(r.advertencia_muestra),
    }));
  }

  async distanciaActual(
    incluirBloqueadas: boolean,
  ): Promise<Racha3DistanciaActual> {
    const filas = await this.consultar(
      `SELECT * FROM racha3_distancia_actual($1::boolean)`,
      incluirBloqueadas,
    );
    // Sin ninguna oportunidad registrada la función no devuelve filas.
    const r: Fila = filas[0] ?? {};
    return {
      jugadas_desde_ultima: aNumeroONulo(r.jugadas_desde_ultima),
      jugadas_sin_procesar: aNumero(r.jugadas_sin_procesar),
      distancia_exacta: r.distancia_exacta === true,
      ultima_jugada_confirmacion_id: aNumeroONulo(
        r.ultima_jugada_confirmacion_id,
      ),
      ultima_confirmacion_en: aIsoONulo(r.ultima_confirmacion_en),
      ultima_hora_col: aNumeroONulo(r.ultima_hora_col),
      ultima_tipo_racha: aTextoONulo(r.ultima_tipo_racha),
      ultima_estado: aTextoONulo(r.ultima_estado),
      ultima_resultado_final: aTextoONulo(r.ultima_resultado_final),
      jugada_mas_reciente_id: aNumeroONulo(r.jugada_mas_reciente_id),
      jugada_mas_reciente_en: aIsoONulo(r.jugada_mas_reciente_en),
      zona_horaria: 'America/Bogota',
    };
  }

  async columnasDistribucion(
    tipo: 'PLAYER' | 'BANKER' | undefined,
    maximo: number,
  ): Promise<readonly Racha3ColumnaDistribucion[]> {
    const filas = await this.consultar(
      `SELECT * FROM racha3_columnas_distribucion($1::text,$2::integer)`,
      tipo ?? null,
      maximo,
    );
    return filas.map((r) => ({
      tipo: aTexto(r.tipo),
      longitud: aTexto(r.longitud),
      orden: aNumero(r.orden),
      n: aNumero(r.n),
      frecuencia_historica: aNumeroONulo(r.frecuencia_historica),
      truncadas: aNumero(r.truncadas),
      muestra_n: aNumero(r.muestra_n),
    }));
  }

  async estado(): Promise<Racha3Estado> {
    const [r] = await this.consultar('SELECT * FROM racha3_estado()');
    return {
      checkpoint_existe: r.checkpoint_existe === true,
      ultima_jugada_procesada: aNumeroONulo(r.ultima_jugada_procesada),
      ultima_jugada_procesada_en: aIsoONulo(r.ultima_jugada_procesada_en),
      reproceso_desde_jugada_id: aNumeroONulo(r.reproceso_desde_jugada_id),
      checkpoint_actualizado_en: aIsoONulo(r.checkpoint_actualizado_en),
      jugadas_sin_procesar: aNumero(r.jugadas_sin_procesar),
      jugada_mas_reciente_id: aNumeroONulo(r.jugada_mas_reciente_id),
      jugada_mas_reciente_en: aIsoONulo(r.jugada_mas_reciente_en),
      total_jugadas: aNumero(r.total_jugadas),
      total_columnas: aNumero(r.total_columnas),
      total_oportunidades: aNumero(r.total_oportunidades),
      oportunidades_pendientes: aNumero(r.oportunidades_pendientes),
      ejecucion_id: aNumeroONulo(r.ejecucion_id),
      ejecucion_tipo: aTextoONulo(r.ejecucion_tipo),
      ejecucion_estado: aTextoONulo(r.ejecucion_estado),
      ejecucion_error: aTextoONulo(r.ejecucion_error),
      ejecucion_duracion_ms: aNumeroONulo(r.ejecucion_duracion_ms),
      ejecucion_en: aIsoONulo(r.ejecucion_en),
    };
  }

  async ladosJugadas(filtros: Racha3Filtros): Promise<Racha3LadosJugadas> {
    // Solo la ventana temporal: la distribución de ganadores es una
    // propiedad de `jugadas`, no de las oportunidades, así que los filtros
    // de tipo/bloqueadas/integridad no aplican.
    const [r] = await this.consultar(
      'SELECT * FROM racha3_lados_jugadas($1::timestamptz,$2::timestamptz)',
      filtros.desde ?? null,
      filtros.hasta ?? null,
    );

    return {
      total: aNumero(r.total),
      banker: aNumero(r.banker),
      player: aNumero(r.player),
      tie: aNumero(r.tie),
      no_tie: aNumero(r.no_tie),
      corte_id: aNumeroONulo(r.corte_id),
    };
  }

  async tiesPorNivel(
    apuesta: 'PLAYER' | 'BANKER' | undefined,
    filtros: Racha3Filtros,
  ): Promise<readonly Racha3TiesNivel[]> {
    const filas = await this.consultar(
      'SELECT * FROM racha3_ties_por_nivel($1::text,$2::timestamptz,$3::timestamptz,$4::boolean,$5::boolean)',
      apuesta ?? null,
      filtros.desde ?? null,
      filtros.hasta ?? null,
      filtros.incluirBloqueadas,
      filtros.incluirIntegridadDudosa,
    );

    return filas.map((r) => ({
      nivel: aNumero(r.nivel),
      ties: aNumero(r.ties),
      operaciones: aNumero(r.operaciones),
      alcanzaron: aNumero(r.alcanzaron),
    }));
  }

  private mapResumen(r: Fila): Racha3Resumen {
    return {
      total: aNumero(r.total),
      resueltas: aNumero(r.resueltas),
      pendientes: aNumero(r.pendientes),
      player: aNumero(r.player),
      banker: aNumero(r.banker),
      frecuencia_historica_player: aNumeroONulo(r.frecuencia_historica_player),
      frecuencia_historica_banker: aNumeroONulo(r.frecuencia_historica_banker),
      directa: aNumero(r.directa),
      mg1: aNumero(r.mg1),
      mg2: aNumero(r.mg2),
      perdidas: aNumero(r.perdidas),
      tasa_directa: aNumeroONulo(r.tasa_directa),
      tasa_mg1: aNumeroONulo(r.tasa_mg1),
      tasa_mg2: aNumeroONulo(r.tasa_mg2),
      tasa_perdida: aNumeroONulo(r.tasa_perdida),
      tasa_acierto_total: aNumeroONulo(r.tasa_acierto_total),
      muestra_n: aNumero(r.muestra_n),
      muestra_bloqueadas_excluidas: aNumero(r.muestra_bloqueadas_excluidas),
      muestra_integridad_dudosa: aNumero(r.muestra_integridad_dudosa),
      ventana_desde: aIsoONulo(r.ventana_desde),
      ventana_hasta: aIsoONulo(r.ventana_hasta),
      zona_horaria: aTexto(r.zona_horaria),
      advertencia_muestra: aTextoONulo(r.advertencia_muestra),
    };
  }

  /** Orden posicional compartido por todas las funciones de F6. */
  private filtrosComunes(
    f: Racha3Filtros,
  ): [Date | null, Date | null, string | null, boolean, boolean, number] {
    return [
      f.desde ?? null,
      f.hasta ?? null,
      f.tipo ?? null,
      f.incluirBloqueadas,
      f.incluirIntegridadDudosa,
      f.umbralMuestra,
    ];
  }

  private async consultar(sql: string, ...params: unknown[]): Promise<Fila[]> {
    return this.cliente().$queryRawUnsafe<Fila[]>(sql, ...params);
  }

  private cliente(): PrismaClient {
    try {
      return this.prisma.getClient();
    } catch {
      throw new ServiceUnavailableException(
        'Analytics no disponible: la conexión con la base de datos no está configurada.',
      );
    }
  }
}
