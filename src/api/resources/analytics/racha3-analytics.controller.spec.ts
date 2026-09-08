import { BadRequestException } from '@nestjs/common';

import type { Racha3AnalyticsReadModel } from '../../../application/analytics/racha3-analytics.read-model';
import { Racha3AnalyticsController } from './racha3-analytics.controller';
import { COTAS_POR_DEFECTO, DIAS_POR_DEFECTO } from './racha3-query';

const resumen = {
  total: 4062,
  resueltas: 4062,
  pendientes: 0,
  player: 2010,
  banker: 2052,
  frecuencia_historica_player: 0.4948,
  frecuencia_historica_banker: 0.5052,
  directa: 2037,
  mg1: 1009,
  mg2: 521,
  perdidas: 495,
  tasa_directa: 0.5015,
  tasa_mg1: 0.2484,
  tasa_mg2: 0.1283,
  tasa_perdida: 0.1219,
  tasa_acierto_total: 0.8781,
  muestra_n: 4062,
  muestra_bloqueadas_excluidas: 50,
  muestra_integridad_dudosa: 10,
  ventana_desde: '2026-08-21T18:23:15.000Z',
  ventana_hasta: '2026-09-08T01:00:00.000Z',
  zona_horaria: 'America/Bogota',
  advertencia_muestra: null,
};

const bucket = (orden: number, etiqueta: string) => ({
  bucket: etiqueta,
  orden,
  casos_observados: 1000 - orden * 100,
  eventos: 100,
  tasa_empirica_condicionada: 0.12,
  intervalos_en_bucket: 100,
  frecuencia_historica: 0.1,
  muestra_n: 4061,
  advertencia_muestra: null,
});

describe('Racha3AnalyticsController', () => {
  let readModel: jest.Mocked<Racha3AnalyticsReadModel>;
  let controller: Racha3AnalyticsController;

  beforeEach(() => {
    readModel = {
      resumen: jest.fn().mockResolvedValue(resumen),
      porHora: jest.fn().mockResolvedValue([]),
      porDia: jest.fn().mockResolvedValue([]),
      intervalos: jest.fn().mockResolvedValue([]),
      distribucion: jest.fn().mockResolvedValue([]),
      columnasDistribucion: jest.fn().mockResolvedValue([]),
      estado: jest.fn(),
      distanciaActual: jest.fn(),
      reprocesar: jest.fn(),
    } as unknown as jest.Mocked<Racha3AnalyticsReadModel>;

    controller = new Racha3AnalyticsController(readModel);
  });

  describe('contrato de la respuesta', () => {
    it('declara la unidad de las tasas y la zona horaria', async () => {
      const vm = await controller.resumen({});
      // Sin `unidad_tasas`, un cliente no puede saber si 0.5 es 50% o 0.5%.
      expect(vm.unidad_tasas).toBe('fraccion_0_1');
      expect(vm.zona_horaria).toBe('America/Bogota');
    });

    it('devuelve las tasas como fracción, sin convertir a porcentaje', async () => {
      const vm = await controller.resumen({});
      expect(vm.resultados.tasa_directa).toBe(0.5015);
      expect(vm.resultados.tasa_acierto_total).toBeLessThanOrEqual(1);
    });

    it('expone la ventana y las muestras excluidas', async () => {
      const vm = await controller.resumen({});
      expect(vm.ventana).toEqual({
        desde: resumen.ventana_desde,
        hasta: resumen.ventana_hasta,
      });
      expect(vm.muestra_bloqueadas_excluidas).toBe(50);
      expect(vm.muestra_integridad_dudosa).toBe(10);
      expect(vm.muestra_n).toBe(4062);
    });

    it('no expone ninguna clave llamada probabilidad/prediccion/confianza', async () => {
      const vm = await controller.resumen({});
      const claves = JSON.stringify(vm).toLowerCase();
      expect(claves).not.toContain('probabilidad');
      expect(claves).not.toContain('prediccion');
      expect(claves).not.toContain('confianza');
    });
  });

  describe('filtros por defecto', () => {
    it('excluye las bloqueadas cuando el cliente no dice nada', async () => {
      await controller.resumen({});
      expect(readModel.resumen).toHaveBeenCalledWith(
        expect.objectContaining({
          incluirBloqueadas: false,
          incluirIntegridadDudosa: true,
        }),
      );
    });

    it('las incluye solo con la petición explícita', async () => {
      await controller.resumen({ incluir_bloqueadas: 'true' });
      expect(readModel.resumen).toHaveBeenCalledWith(
        expect.objectContaining({ incluirBloqueadas: true }),
      );
    });

    it('propaga el 400 de un parámetro inválido', async () => {
      await expect(controller.resumen({ tipo: 'X' })).rejects.toThrow(
        BadRequestException,
      );
      expect(readModel.resumen).not.toHaveBeenCalled();
    });
  });

  describe('intervalos y perdidas', () => {
    it('usa las cotas por defecto y la serie RACHA3', async () => {
      const vm = await controller.intervalos({});
      expect(vm.entre).toBe('RACHA3');
      expect(vm.metrica).toBe('jugadas');
      expect(vm.cotas).toEqual(COTAS_POR_DEFECTO);
      expect(readModel.intervalos).toHaveBeenCalledWith(
        'RACHA3',
        expect.anything(),
      );
    });

    it('/perdidas fuerza la serie PERDIDAS sin depender del cliente', async () => {
      await controller.perdidas({ metrica: 'segundos' });
      expect(readModel.intervalos).toHaveBeenCalledWith(
        'PERDIDAS',
        expect.anything(),
      );
      expect(readModel.distribucion).toHaveBeenCalledWith(
        'segundos',
        COTAS_POR_DEFECTO,
        'PERDIDAS',
        expect.anything(),
      );
    });

    it('pide estadísticos y distribución en paralelo, no en cascada', async () => {
      // Dos consultas independientes: encadenarlas duplicaría la latencia
      // sin ninguna razón, y sería el germen de un N+1.
      await controller.intervalos({});
      expect(readModel.intervalos).toHaveBeenCalledTimes(1);
      expect(readModel.distribucion).toHaveBeenCalledTimes(1);
    });
  });

  describe('por-dia', () => {
    it('acota a los últimos N días cuando el cliente no da ventana', async () => {
      await controller.porDia({});
      const filtros = readModel.porDia.mock.calls[0][0];
      expect(filtros.desde).toBeInstanceOf(Date);
      const dias =
        (Date.now() - (filtros.desde as Date).getTime()) /
        (24 * 60 * 60 * 1000);
      expect(Math.round(dias)).toBe(DIAS_POR_DEFECTO);
    });

    it('respeta la ventana explícita del cliente', async () => {
      await controller.porDia({
        desde: '2026-09-01T00:00:00Z',
        hasta: '2026-09-03T00:00:00Z',
      });
      const filtros = readModel.porDia.mock.calls[0][0];
      expect(filtros.desde?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    });
  });

  describe('distancia-actual', () => {
    it('devuelve la distancia con TODA la tabla de buckets, no solo el vigente', async () => {
      // Un número aislado invita justamente a la lectura que el dominio
      // prohíbe; con los siete buckets a la vista se ve que la tasa es
      // casi plana y que la distancia distingue poco.
      readModel.distanciaActual.mockResolvedValue({
        distancia: {
          jugadas_desde_ultima: 12,
          jugadas_sin_procesar: 0,
          distancia_exacta: true,
          ultima_jugada_confirmacion_id: 43036,
          ultima_confirmacion_en: '2026-09-08T00:47:47.859Z',
          ultima_hora_col: 19,
          ultima_tipo_racha: 'BANKER',
          ultima_estado: 'RESUELTA',
          ultima_resultado_final: 'MG2',
          jugada_mas_reciente_id: 43083,
          jugada_mas_reciente_en: '2026-09-08T01:13:38.612Z',
          zona_horaria: 'America/Bogota',
        },
        bucket_actual: bucket(3, '11-15'),
        buckets: [bucket(1, '0-5'), bucket(2, '6-10'), bucket(3, '11-15')],
      });

      const vm = await controller.distanciaActual({});
      expect(vm.bucket_actual?.bucket).toBe('11-15');
      expect(vm.buckets).toHaveLength(3);
      expect(vm.nota).toContain('no comparables');
      expect(vm.nota).toContain('probabilidad predictiva');
    });

    it('propaga el mismo criterio de bloqueadas a distancia y buckets', async () => {
      readModel.distanciaActual.mockResolvedValue({
        distancia: {} as never,
        bucket_actual: null,
        buckets: [],
      });
      await controller.distanciaActual({ incluir_bloqueadas: 'true' });
      expect(readModel.distanciaActual).toHaveBeenCalledWith(
        COTAS_POR_DEFECTO,
        expect.objectContaining({ incluirBloqueadas: true }),
      );
    });
  });

  describe('estado', () => {
    it('deriva `al_dia` para que no lo invente cada cliente', async () => {
      readModel.estado.mockResolvedValue({
        checkpoint_existe: true,
        jugadas_sin_procesar: 0,
      } as never);
      expect((await controller.estado()).al_dia).toBe(true);

      readModel.estado.mockResolvedValue({
        checkpoint_existe: true,
        jugadas_sin_procesar: 40,
      } as never);
      expect((await controller.estado()).al_dia).toBe(false);

      readModel.estado.mockResolvedValue({
        checkpoint_existe: false,
        jugadas_sin_procesar: 0,
      } as never);
      expect((await controller.estado()).al_dia).toBe(false);
    });
  });

  describe('reprocesar', () => {
    it('traduce una corrida productiva', async () => {
      readModel.reprocesar.mockResolvedValue({
        tipo: 'OK',
        ejecucionId: 42n,
        desdeJugadaId: 100n,
        hastaJugadaId: 110n,
        jugadasLeidas: 11,
        columnasAfectadas: 6,
        operacionesAfectadas: 1,
        duracionMs: 87,
        huboCambios: true,
      });

      const vm = await controller.reprocesar();
      expect(vm).toMatchObject({
        tipo: 'INCREMENTAL',
        estado: 'OK',
        hubo_cambios: true,
        ejecucion_id: 42,
        desde_jugada_id: 100,
        error: null,
      });
      // Ningún BigInt debe sobrevivir al mapper: JSON.stringify lo rechaza.
      expect(() => JSON.stringify(vm)).not.toThrow();
    });

    it('traduce un no-op sin inventar cambios', async () => {
      readModel.reprocesar.mockResolvedValue({
        tipo: 'OK',
        ejecucionId: 43n,
        desdeJugadaId: null,
        hastaJugadaId: 110n,
        jugadasLeidas: 0,
        columnasAfectadas: 0,
        operacionesAfectadas: 0,
        duracionMs: 0,
        huboCambios: false,
      });
      expect((await controller.reprocesar()).hubo_cambios).toBe(false);
    });

    it('traduce un fallo de dominio sin lanzar', async () => {
      readModel.reprocesar.mockResolvedValue({
        tipo: 'ERROR_PROCESO',
        ejecucionId: 44n,
        error: 'Inserción retroactiva detectada',
        duracionMs: 12,
      });
      const vm = await controller.reprocesar();
      expect(vm.estado).toBe('ERROR_PROCESO');
      expect(vm.error).toContain('retroactiva');
    });

    it('traduce la persistencia deshabilitada', async () => {
      readModel.reprocesar.mockResolvedValue({
        tipo: 'NO_DISPONIBLE',
        motivo: 'DATABASE_URL ausente.',
      });
      expect((await controller.reprocesar()).estado).toBe('NO_DISPONIBLE');
    });
  });

  describe('columnas/distribucion', () => {
    it('valida el máximo y lo devuelve en el contrato', async () => {
      const vm = await controller.columnas({ maximo: '8' });
      expect(vm.maximo).toBe(8);
      expect(readModel.columnasDistribucion).toHaveBeenCalledWith(undefined, 8);
      await expect(controller.columnas({ maximo: '1' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.columnas({ maximo: '999' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
