import { Injectable, Logger } from '@nestjs/common';

import { WinnerType } from '../../core/enums/winner-type.enum';
import {
  Racha3TestContexto,
  Racha3TestEstadoAnalytics,
  Racha3TestEvidencia,
} from '../../core/racha3-test/types/racha3-test.type';
import { Racha3AnalyticsReadModel } from '../analytics/racha3-analytics.read-model';

/** Cotas de bucket para el contexto de distancia. Las acordadas del dominio. */
const COTAS = [5, 10, 15, 20, 30, 50] as const;

/**
 * `umbral_muestra` con el que se consulta Analytics.
 *
 * Se deja el default del propio SQL (100) en vez de pasarle el mínimo de
 * Racha 3 Test: así `advertencia_muestra` sigue significando lo que
 * significa en Analytics y no se vuelve un espejo del gate propio. El gate
 * de muestra mínima es una decisión de esta estrategia, no de Analytics.
 */
const UMBRAL_MUESTRA_ANALYTICS = 100;

export type EvidenciaRecolectada = {
  readonly evidencia: Racha3TestEvidencia | null;
  readonly contexto: Racha3TestContexto;
  readonly estadoAnalytics: Racha3TestEstadoAnalytics;
};

/**
 * Recolecta de Analytics toda la evidencia y el contexto de una oportunidad.
 *
 * Consume el dominio de Analytics por su read-model interno
 * (`Racha3AnalyticsReadModel` → `RACHA3_ANALYTICS_READER` → PostgreSQL).
 * NUNCA por HTTP contra `/api/v1/analytics/racha3/*`: es el mismo proceso, y
 * salir por la red para volver a entrar sólo agregaría latencia y un punto
 * de fallo. Los endpoints siguen existiendo para consumo externo.
 *
 * Tampoco recalcula nada: la tasa, los conteos, el hazard y el estado del
 * pipeline salen todos de funciones SQL ya verificadas por
 * `pnpm analytics:verify`.
 *
 * Si algo falla, devuelve `evidencia: null` y el motivo en
 * `estadoAnalytics.error`. Nunca inventa un valor por defecto ni reutiliza
 * el de una evaluación anterior: la calculadora trata la ausencia de
 * evidencia como gate, no como score neutro.
 */
@Injectable()
export class Racha3TestEvidenceProvider {
  private readonly logger = new Logger(Racha3TestEvidenceProvider.name);

  constructor(private readonly analytics: Racha3AnalyticsReadModel) {}

  async recolectar(
    tipoRacha: WinnerType,
    confirmadaEn: Date,
    horaColombia: number,
    diaSemana: number,
  ): Promise<EvidenciaRecolectada> {
    const filtros = {
      tipo:
        tipoRacha === WinnerType.PLAYER
          ? ('PLAYER' as const)
          : ('BANKER' as const),
      // Mismos criterios con los que se aceptó el dominio: las bloqueadas
      // quedan fuera (el motor real no habría podido operarlas) y las de
      // integridad dudosa entran pero se cuentan.
      incluirBloqueadas: false,
      incluirIntegridadDudosa: true,
      umbralMuestra: UMBRAL_MUESTRA_ANALYTICS,
    };

    const contextoBase = {
      horaColombia,
      diaSemana,
      distanciaActual: null,
      distanciaExacta: false,
      bucketDistancia: null,
      hazardBucket: null,
      frecuenciaHistoricaBucket: null,
      columnaConCortePorGap: null,
    };

    try {
      const [resumen, estado, distancia] = await Promise.all([
        this.analytics.resumen(filtros),
        this.analytics.estado(),
        this.analytics.distanciaActual([...COTAS], filtros),
      ]);

      const aciertos = resumen.directa + resumen.mg1 + resumen.mg2;

      const evidencia: Racha3TestEvidencia = {
        condicion: `tipo_racha=${filtros.tipo}`,
        tipoRacha,
        aciertos,
        resueltas: resumen.resueltas,
        directa: resumen.directa,
        mg1: resumen.mg1,
        mg2: resumen.mg2,
        perdidas: resumen.perdidas,
        muestraN: resumen.muestra_n,
        advertenciaMuestra: resumen.advertencia_muestra,
        muestraBloqueadasExcluidas: resumen.muestra_bloqueadas_excluidas,
        muestraIntegridadDudosa: resumen.muestra_integridad_dudosa,
        ventanaDesde: resumen.ventana_desde,
        ventanaHasta: resumen.ventana_hasta,
      };

      const contexto: Racha3TestContexto = {
        ...contextoBase,
        distanciaActual: distancia.distancia.jugadas_desde_ultima,
        distanciaExacta: distancia.distancia.distancia_exacta,
        bucketDistancia: distancia.bucket_actual?.bucket ?? null,
        hazardBucket:
          distancia.bucket_actual?.tasa_empirica_condicionada ?? null,
        frecuenciaHistoricaBucket:
          distancia.bucket_actual?.frecuencia_historica ?? null,
        columnaConCortePorGap: null,
      };

      return {
        evidencia,
        contexto,
        estadoAnalytics: {
          disponible: true,
          checkpointExiste: estado.checkpoint_existe,
          jugadasSinProcesar: estado.jugadas_sin_procesar,
          totalOportunidades: estado.total_oportunidades,
          error: null,
        },
      };
    } catch (error) {
      const detalle = resumirError(error);
      this.logger.warn(
        `No se pudo recolectar evidencia de Analytics para una oportunidad ${tipoRacha} ` +
          `(${confirmadaEn.toISOString()}): ${detalle}`,
      );

      return {
        evidencia: null,
        contexto: contextoBase,
        estadoAnalytics: {
          disponible: false,
          checkpointExiste: false,
          jugadasSinProcesar: 0,
          totalOportunidades: 0,
          error: detalle,
        },
      };
    }
  }
}

/**
 * Mismo criterio que el scheduler de Analytics: Prisma antepone líneas en
 * blanco a sus mensajes, así que quedarse con la primera línea deja el log
 * sin detalle justo cuando el detalle es lo único que importa.
 */
function resumirError(error: unknown): string {
  const mensaje = error instanceof Error ? error.message : String(error);
  const lineas = mensaje
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lineas.length === 0
    ? 'sin detalle'
    : lineas.slice(0, 2).join(' ').slice(0, 200);
}
