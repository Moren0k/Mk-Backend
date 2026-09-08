import { Get, Post, Query } from '@nestjs/common';

import { Racha3AnalyticsReadModel } from '../../../application/analytics/racha3-analytics.read-model';
import { ApiResource } from '../../common/decorators/api-resource.decorator';
import {
  DIAS_POR_DEFECTO,
  MAX_LONGITUD_COLUMNA,
  parseCotas,
  parseEntero,
  parseEntre,
  parseFiltros,
  parseMetrica,
  parseTipo,
  type FiltrosCrudos,
} from './racha3-query';
import {
  toColumnasVm,
  toDistanciaVm,
  toEstadoVm,
  toIntervalosVm,
  toPorDiaVm,
  toPorHoraVm,
  toReprocesarVm,
  toResumenVm,
} from '../../contracts/mappers/racha3-analytics.mapper';
import type {
  Racha3ColumnasVm,
  Racha3DistanciaVm,
  Racha3EstadoVm,
  Racha3IntervalosVm,
  Racha3PorDiaVm,
  Racha3PorHoraVm,
  Racha3ReprocesarVm,
  Racha3ResumenVm,
} from '../../contracts/view-models/racha3-analytics.vm';

/**
 * GET /api/v1/analytics/racha3/* — capa de lectura de Analytics histórico.
 *
 * Todo endpoint delega en una función SQL de F6/F7 a través del read-model:
 * acá no se calcula ni una tasa. Esa frontera es lo que mantiene toda la
 * estadística del dominio dentro del alcance de `pnpm analytics:verify`.
 *
 * Autenticación: `X-Api-Key` vía `@ApiResource`, igual que el resto de la
 * capa (Anexo D §5). No hay un nivel de autorización distinto para el
 * endpoint de escritura, y no se inventa uno: `POST /api/v1/admin/reports`
 * ya sienta el precedente de que una acción disparable con la misma clave
 * es aceptable en este proyecto.
 *
 * Unidad de las tasas: FRACCIÓN en [0,1], igual que en SQL, nunca
 * porcentaje. Cada respuesta que lleva tasas lo declara en
 * `unidad_tasas`, para que un cliente no pueda multiplicar por 100 dos
 * veces ni ninguna.
 */
@ApiResource('analytics/racha3')
export class Racha3AnalyticsController {
  constructor(private readonly readModel: Racha3AnalyticsReadModel) {}

  /** Frecuencia y resultado de operaciones sobre la ventana pedida. */
  @Get('resumen')
  async resumen(@Query() query: FiltrosCrudos): Promise<Racha3ResumenVm> {
    return toResumenVm(await this.readModel.resumen(parseFiltros(query)));
  }

  /**
   * Estadísticos de los intervalos, en las tres unidades a la vez, más su
   * distribución por buckets. Van juntos a propósito: una mediana sin la
   * distribución que la rodea se lee como si el valor típico fuera
   * representativo, y en una distribución con cola larga no lo es.
   */
  @Get('intervalos')
  async intervalos(
    @Query()
    query: FiltrosCrudos & { entre?: string; metrica?: string; cotas?: string },
  ): Promise<Racha3IntervalosVm> {
    const filtros = parseFiltros(query);
    const entre = parseEntre(query.entre);
    const metrica = parseMetrica(query.metrica);
    const cotas = parseCotas(query.cotas);

    const [intervalos, distribucion] = await Promise.all([
      this.readModel.intervalos(entre, filtros),
      this.readModel.distribucion(metrica, cotas, entre, filtros),
    ]);

    return toIntervalosVm(entre, metrica, cotas, intervalos, distribucion);
  }

  /** Análisis temporal por hora de Colombia. Siempre las 24 horas. */
  @Get('por-hora')
  async porHora(@Query() query: FiltrosCrudos): Promise<Racha3PorHoraVm> {
    return toPorHoraVm(await this.readModel.porHora(parseFiltros(query)));
  }

  /**
   * Frecuencia por día calendario de Colombia. Si el cliente no acota la
   * ventana se usan los últimos `DIAS_POR_DEFECTO` días: sin ese default,
   * la respuesta crecería una fila por día para siempre.
   */
  @Get('por-dia')
  async porDia(@Query() query: FiltrosCrudos): Promise<Racha3PorDiaVm> {
    const filtros = parseFiltros(query);
    const acotado =
      filtros.desde === undefined && filtros.hasta === undefined
        ? {
            ...filtros,
            desde: new Date(
              Date.now() - DIAS_POR_DEFECTO * 24 * 60 * 60 * 1000,
            ),
          }
        : filtros;

    return toPorDiaVm(await this.readModel.porDia(acotado), DIAS_POR_DEFECTO);
  }

  /**
   * Cuántas jugadas van desde la última Racha 3, con el contexto histórico
   * completo para poder interpretarlo.
   */
  @Get('distancia-actual')
  async distanciaActual(
    @Query() query: FiltrosCrudos & { cotas?: string },
  ): Promise<Racha3DistanciaVm> {
    const filtros = parseFiltros(query);
    const cotas = parseCotas(query.cotas);
    return toDistanciaVm(
      await this.readModel.distanciaActual(cotas, filtros),
      cotas,
    );
  }

  /** Distancia entre pérdidas: estadísticos y distribución. */
  @Get('perdidas')
  async perdidas(
    @Query() query: FiltrosCrudos & { metrica?: string; cotas?: string },
  ): Promise<Racha3IntervalosVm> {
    const filtros = parseFiltros(query);
    const metrica = parseMetrica(query.metrica);
    const cotas = parseCotas(query.cotas);

    const [intervalos, distribucion] = await Promise.all([
      this.readModel.intervalos('PERDIDAS', filtros),
      this.readModel.distribucion(metrica, cotas, 'PERDIDAS', filtros),
    ]);

    return toIntervalosVm('PERDIDAS', metrica, cotas, intervalos, distribucion);
  }

  /** Longitudes de columna por tipo. Base del futuro concepto "L". */
  @Get('columnas/distribucion')
  async columnas(
    @Query() query: { tipo?: string; maximo?: string },
  ): Promise<Racha3ColumnasVm> {
    const tipo = parseTipo(query.tipo);
    const maximo = parseEntero(
      query.maximo,
      'maximo',
      2,
      MAX_LONGITUD_COLUMNA,
      10,
    );
    return toColumnasVm(
      await this.readModel.columnasDistribucion(tipo, maximo),
      maximo,
    );
  }

  /**
   * Salud del pipeline derivado. Es lo que permite distinguir "no hay Racha
   * 3 nuevas" de "el procesamiento está caído": sin esto, desde afuera se
   * ven igual.
   */
  @Get('estado')
  async estado(): Promise<Racha3EstadoVm> {
    return toEstadoVm(await this.readModel.estado());
  }

  /**
   * Dispara una corrida incremental a pedido. Único endpoint que escribe.
   *
   * No expone el rebuild: es destructivo y dura segundos, así que queda
   * como operación de línea de comandos.
   */
  @Post('reprocesar')
  async reprocesar(): Promise<Racha3ReprocesarVm> {
    return toReprocesarVm(await this.readModel.reprocesar());
  }
}
