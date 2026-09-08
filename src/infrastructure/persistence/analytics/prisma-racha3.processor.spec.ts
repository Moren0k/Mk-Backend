import { PrismaService } from '../prisma.service';
import { PrismaRacha3Processor } from './prisma-racha3.processor';

/** Fila de `analytics_ejecuciones` con los defaults de una corrida exitosa. */
const fila = (extra: Record<string, unknown> = {}) => ({
  id: 42n,
  estado: 'OK',
  desde_jugada_id: 100n,
  hasta_jugada_id: 110n,
  jugadas_leidas: 11,
  columnas_afectadas: 6,
  operaciones_afectadas: 1,
  duracion_ms: 87,
  error: null,
  ...extra,
});

describe('PrismaRacha3Processor', () => {
  let queryRaw: jest.Mock;
  let prisma: PrismaService;
  let processor: PrismaRacha3Processor;

  const conCliente = () => {
    queryRaw = jest.fn();
    prisma = {
      getClient: () => ({ $queryRawUnsafe: queryRaw }),
    } as unknown as PrismaService;
    return new PrismaRacha3Processor(prisma);
  };

  beforeEach(() => {
    processor = conCliente();
  });

  describe('procesarIncremental', () => {
    it('invoca la función SQL y nada más: no hay lógica analítica del lado de TypeScript', async () => {
      queryRaw.mockResolvedValue([fila()]);

      await processor.procesarIncremental();

      expect(queryRaw).toHaveBeenCalledTimes(1);
      expect(queryRaw).toHaveBeenCalledWith(
        'SELECT * FROM analytics_racha3_incremental()',
      );
    });

    it('mapea una corrida productiva conservando el rango y los contadores', async () => {
      queryRaw.mockResolvedValue([fila()]);

      const r = await processor.procesarIncremental();

      expect(r).toEqual({
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
    });

    it('reconoce el no-op por `desde_jugada_id` nulo, no por los contadores', async () => {
      // Es la distinción correcta: la función solo deja `desde_jugada_id` en
      // NULL cuando corta antes de tocar nada. Una corrida que sí reprocesó
      // un tramo y dio 0 columnas afectadas sería otra cosa distinta.
      queryRaw.mockResolvedValue([
        fila({
          desde_jugada_id: null,
          jugadas_leidas: 0,
          columnas_afectadas: 0,
          operaciones_afectadas: 0,
          duracion_ms: 0,
        }),
      ]);

      const r = await processor.procesarIncremental();

      expect(r.tipo).toBe('OK');
      expect(r).toMatchObject({ huboCambios: false, jugadasLeidas: 0 });
    });

    it('traduce un fallo de dominio a ERROR_PROCESO, sin lanzar', async () => {
      queryRaw.mockResolvedValue([
        fila({
          estado: 'ERROR',
          error: 'Inserción retroactiva detectada después de la jugada 42719',
          columnas_afectadas: null,
          operaciones_afectadas: null,
        }),
      ]);

      const r = await processor.procesarIncremental();

      expect(r).toEqual({
        tipo: 'ERROR_PROCESO',
        ejecucionId: 42n,
        error: 'Inserción retroactiva detectada después de la jugada 42719',
        duracionMs: 87,
      });
    });

    it('devuelve NO_DISPONIBLE si la persistencia está deshabilitada, sin lanzar', async () => {
      prisma = {
        getClient: () => {
          throw new Error('PrismaClient no está disponible');
        },
      } as unknown as PrismaService;

      const r = await new PrismaRacha3Processor(prisma).procesarIncremental();

      expect(r.tipo).toBe('NO_DISPONIBLE');
    });

    it('propaga un fallo de transporte para que el scheduler pueda clasificarlo', async () => {
      // Un corte del pooler NO puede confundirse con un fallo de dominio:
      // el primero se tolera unos minutos, el segundo se grita enseguida.
      queryRaw.mockRejectedValue(new Error("Can't reach database server"));

      await expect(processor.procesarIncremental()).rejects.toThrow(
        "Can't reach database server",
      );
    });
  });

  describe('leerCheckpoint', () => {
    it('devuelve el checkpoint del proceso racha3', async () => {
      const actualizadoEn = new Date('2026-09-08T01:00:00Z');
      queryRaw.mockResolvedValue([
        {
          ultima_jugada_id: 43015n,
          reproceso_desde_jugada_id: 43006n,
          actualizado_en: actualizadoEn,
        },
      ]);

      await expect(processor.leerCheckpoint()).resolves.toEqual({
        ultimaJugadaId: 43015n,
        reprocesoDesdeJugadaId: 43006n,
        actualizadoEn,
      });
    });

    it('devuelve undefined si todavía no hubo ningún rebuild', async () => {
      queryRaw.mockResolvedValue([]);
      await expect(processor.leerCheckpoint()).resolves.toBeUndefined();
    });

    it('nunca lanza: es solo observabilidad', async () => {
      queryRaw.mockRejectedValue(new Error("Can't reach database server"));
      await expect(processor.leerCheckpoint()).resolves.toBeUndefined();
    });
  });
});
