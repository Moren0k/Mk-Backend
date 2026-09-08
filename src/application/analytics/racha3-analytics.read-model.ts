import { Inject, Injectable } from '@nestjs/common';

import {
  RACHA3_ANALYTICS_READER,
  RACHA3_PROCESSOR,
} from '../../core/constants/injection-tokens.constants';
import type { Racha3AnalyticsReader } from '../../core/analytics/interfaces/racha3-analytics-reader.interface';
import type { Racha3Processor } from '../../core/analytics/interfaces/racha3-processor.interface';
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
} from '../../core/analytics/types/racha3-analytics.type';
import type { Racha3RunResult } from '../../core/analytics/types/racha3-run.type';

/**
 * Respuesta de `distancia-actual`: la distancia vigente junto al contexto
 * histórico que la hace interpretable.
 *
 * El bucket que corresponde a la distancia actual viaja SIEMPRE acompañado
 * de la tabla completa. Devolver sólo el bucket vigente invitaría
 * exactamente a la lectura que el dominio prohíbe: tomar un número aislado
 * ("13%") como si fuera la probabilidad de que aparezca una Racha 3 ahora.
 * Con los siete buckets a la vista se ve que la tasa es prácticamente plana
 * a partir de la sexta jugada, y que por lo tanto la distancia acumulada no
 * distingue gran cosa en este histórico.
 */
export type Racha3DistanciaConContexto = {
  readonly distancia: Racha3DistanciaActual;
  /** Bucket en el que cae la distancia actual. `null` si no hay historial. */
  readonly bucket_actual: Racha3BucketHazard | null;
  readonly buckets: readonly Racha3BucketHazard[];
};

/**
 * Único punto por el que la capa `api/` accede a Analytics.
 *
 * Es deliberadamente delgado: cada método delega en la función SQL
 * correspondiente sin recalcular, promediar ni reinterpretar nada. La única
 * lógica propia es la de `distanciaActual`, y es composición (elegir qué
 * bucket corresponde a un número ya calculado), no estadística.
 *
 * Existe, en vez de que el controller inyecte el reader directamente, por
 * la convención del proyecto (Mk-Api.md §5.3): un controller nunca habla
 * con una capa de datos sin pasar por `application/`.
 */
@Injectable()
export class Racha3AnalyticsReadModel {
  constructor(
    @Inject(RACHA3_ANALYTICS_READER)
    private readonly reader: Racha3AnalyticsReader,
    @Inject(RACHA3_PROCESSOR)
    private readonly processor: Racha3Processor,
  ) {}

  resumen(filtros: Racha3Filtros): Promise<Racha3Resumen> {
    return this.reader.resumen(filtros);
  }

  porHora(filtros: Racha3Filtros): Promise<readonly Racha3PorHora[]> {
    return this.reader.porHora(filtros);
  }

  porDia(filtros: Racha3Filtros): Promise<readonly Racha3PorDia[]> {
    return this.reader.porDia(filtros);
  }

  intervalos(
    entre: Racha3Entre,
    filtros: Racha3Filtros,
  ): Promise<readonly Racha3Intervalo[]> {
    return this.reader.intervalos(entre, filtros);
  }

  distribucion(
    metrica: Racha3IntervaloMetrica,
    cotas: readonly number[],
    entre: Racha3Entre,
    filtros: Racha3Filtros,
  ): Promise<readonly Racha3BucketDistribucion[]> {
    return this.reader.distribucion(metrica, cotas, entre, filtros);
  }

  columnasDistribucion(
    tipo: 'PLAYER' | 'BANKER' | undefined,
    maximo: number,
  ): Promise<readonly Racha3ColumnaDistribucion[]> {
    return this.reader.columnasDistribucion(tipo, maximo);
  }

  estado(): Promise<Racha3Estado> {
    return this.reader.estado();
  }

  /**
   * Distribución de ganadores sobre `jugadas` hasta el checkpoint.
   *
   * Es la segunda fuente de evidencia de Racha 3 Test: con ~39.000 rondas
   * no-empate estima la ventaja del lado apostado nueve veces mejor que
   * contando victorias de operaciones completas (~4.200).
   */
  ladosJugadas(filtros: Racha3Filtros): Promise<Racha3LadosJugadas> {
    return this.reader.ladosJugadas(filtros);
  }

  /**
   * Empates dentro de operaciones, por nivel de la escalera.
   *
   * Un empate devuelve el 90 %, así que cuesta el 10 % de lo apostado en el
   * nivel donde cae — y la apuesta se duplica en cada nivel. Sin este dato
   * el punto de equilibrio se subestima en medio punto (87,500 % contra
   * 87,983 %), que es justo el margen donde vive esta estrategia.
   */
  tiesPorNivel(
    apuesta: 'PLAYER' | 'BANKER' | undefined,
    filtros: Racha3Filtros,
  ): Promise<readonly Racha3TiesNivel[]> {
    return this.reader.tiesPorNivel(apuesta, filtros);
  }

  /**
   * Distancia vigente + su bucket + la tabla completa.
   *
   * `incluirBloqueadas` se propaga a AMBAS consultas con el mismo valor, y
   * no es un detalle: la distancia sólo es comparable contra los buckets si
   * se mide sobre la misma serie con la que se construyeron. Medir la
   * distancia incluyendo bloqueadas y contrastarla contra buckets que las
   * excluyen daría un número y un contexto que describen series distintas.
   */
  async distanciaActual(
    cotas: readonly number[],
    filtros: Racha3Filtros,
  ): Promise<Racha3DistanciaConContexto> {
    const [distancia, buckets] = await Promise.all([
      this.reader.distanciaActual(filtros.incluirBloqueadas),
      this.reader.hazardDistancia(cotas, filtros),
    ]);

    return {
      distancia,
      bucket_actual: this.ubicarBucket(
        distancia.jugadas_desde_ultima,
        cotas,
        buckets,
      ),
      buckets,
    };
  }

  /**
   * Dispara una corrida incremental a pedido.
   *
   * Es el único método que escribe, y llega hasta acá por el mismo token
   * que usa el scheduler. La exclusión mutua no depende de coordinarlos:
   * `analytics_racha3_incremental()` toma `pg_advisory_xact_lock(42, 3)`,
   * así que un disparo manual y un tick simultáneos se serializan solos y
   * el segundo encuentra el trabajo ya hecho.
   *
   * Deliberadamente NO se expone el rebuild: es destructivo (TRUNCATE) y
   * dura segundos, así que queda como operación de línea de comandos
   * (`pnpm analytics:rebuild`), donde quien la ejecuta ve lo que hace.
   */
  reprocesar(): Promise<Racha3RunResult> {
    return this.processor.procesarIncremental();
  }

  private ubicarBucket(
    distancia: number | null,
    cotas: readonly number[],
    buckets: readonly Racha3BucketHazard[],
  ): Racha3BucketHazard | null {
    if (distancia === null || buckets.length === 0) {
      return null;
    }

    // Mismo criterio que `racha3_bucket_indice` en SQL: el primer corte que
    // el valor no supera; si los supera todos, el bucket abierto final.
    const indice = cotas.findIndex((cota) => distancia <= cota);
    const orden = indice === -1 ? cotas.length + 1 : indice + 1;

    return buckets.find((b) => b.orden === orden) ?? null;
  }
}
