import { Injectable, Logger } from '@nestjs/common';

import type { Racha3Processor } from '../../../core/analytics/interfaces/racha3-processor.interface';
import type {
  Racha3CheckpointSnapshot,
  Racha3RunResult,
} from '../../../core/analytics/types/racha3-run.type';
import { PrismaService } from '../prisma.service';

/** Fila de `analytics_ejecuciones` tal como la devuelve la función SQL. */
type FilaEjecucion = {
  id: bigint;
  estado: string;
  desde_jugada_id: bigint | null;
  hasta_jugada_id: bigint | null;
  jugadas_leidas: number | null;
  columnas_afectadas: number | null;
  operaciones_afectadas: number | null;
  duracion_ms: number | null;
  error: string | null;
};

type FilaCheckpoint = {
  ultima_jugada_id: bigint;
  reproceso_desde_jugada_id: bigint;
  actualizado_en: Date;
};

/**
 * Implementación real de `Racha3Processor`: una llamada a
 * `analytics_racha3_incremental()` y una lectura del checkpoint. Nada más.
 *
 * No hay aquí ni una línea de lógica analítica, y es a propósito: la
 * reconstrucción de columnas, oportunidades y derivados vive ÍNTEGRAMENTE
 * en las funciones plpgsql (migración `20260908000500_analytics_racha3_motor`),
 * verificadas contra la implementación de referencia en TypeScript por
 * `pnpm analytics:verify`. Duplicar aunque sea un fragmento de esa lógica
 * acá reintroduciría la posibilidad de que Analytics y su verificación
 * diverjan.
 *
 * Reparto de fallos, deliberado:
 *
 *  - Un fallo de DOMINIO (la función abortó su trabajo) vuelve como
 *    `ERROR_PROCESO`, porque la propia función ya lo capturó y lo dejó
 *    registrado en `analytics_ejecuciones`.
 *  - La ausencia de persistencia vuelve como `NO_DISPONIBLE`: es el modo
 *    degradado normal del proyecto, no un error.
 *  - Un fallo de TRANSPORTE (pooler caído, timeout de red) se propaga como
 *    excepción, para que el scheduler pueda distinguirlo y no gritar por un
 *    hipo pasajero.
 */
@Injectable()
export class PrismaRacha3Processor implements Racha3Processor {
  private readonly logger = new Logger(PrismaRacha3Processor.name);

  constructor(private readonly prisma: PrismaService) {}

  async procesarIncremental(): Promise<Racha3RunResult> {
    const client = this.obtenerCliente();

    if (client === undefined) {
      return {
        tipo: 'NO_DISPONIBLE',
        motivo:
          'DATABASE_URL ausente o el cliente Prisma no llegó a conectar al arrancar.',
      };
    }

    // Cualquier error de transporte se propaga tal cual: es el scheduler
    // quien decide si es un hipo tolerable o algo que ya hay que gritar.
    const [fila] = await client.$queryRawUnsafe<FilaEjecucion[]>(
      'SELECT * FROM analytics_racha3_incremental()',
    );

    if (fila.estado === 'ERROR') {
      return {
        tipo: 'ERROR_PROCESO',
        ejecucionId: fila.id,
        error: fila.error ?? 'sin mensaje',
        duracionMs: fila.duracion_ms ?? 0,
      };
    }

    const columnas = fila.columnas_afectadas ?? 0;
    const operaciones = fila.operaciones_afectadas ?? 0;

    return {
      tipo: 'OK',
      ejecucionId: fila.id,
      desdeJugadaId: fila.desde_jugada_id,
      hastaJugadaId: fila.hasta_jugada_id,
      jugadasLeidas: fila.jugadas_leidas ?? 0,
      columnasAfectadas: columnas,
      operacionesAfectadas: operaciones,
      duracionMs: fila.duracion_ms ?? 0,
      // Sin jugadas nuevas la función corta antes de tocar nada y deja
      // `desde_jugada_id` en NULL. Ese es el no-op absoluto: no reescribe
      // filas ni reclama el checkpoint.
      huboCambios: fila.desde_jugada_id !== null,
    };
  }

  async leerCheckpoint(): Promise<Racha3CheckpointSnapshot | undefined> {
    const client = this.obtenerCliente();

    if (client === undefined) {
      return undefined;
    }

    try {
      const [fila] = await client.$queryRawUnsafe<FilaCheckpoint[]>(
        'SELECT ultima_jugada_id, reproceso_desde_jugada_id, actualizado_en ' +
          "FROM analytics_checkpoints WHERE proceso = 'racha3'",
      );

      if (fila === undefined) {
        return undefined;
      }

      return {
        ultimaJugadaId: fila.ultima_jugada_id,
        reprocesoDesdeJugadaId: fila.reproceso_desde_jugada_id,
        actualizadoEn: fila.actualizado_en,
      };
    } catch {
      // Solo observabilidad: que no se pueda leer el checkpoint nunca debe
      // convertir una corrida exitosa en un fallo.
      return undefined;
    }
  }

  /** `undefined` si la persistencia está deshabilitada, sin lanzar. */
  private obtenerCliente(): ReturnType<PrismaService['getClient']> | undefined {
    try {
      return this.prisma.getClient();
    } catch {
      return undefined;
    }
  }
}
