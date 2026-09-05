import { Injectable, Logger } from '@nestjs/common';

import type {
  ReportCheckpointSnapshot,
  ReportCheckpointStore,
} from '../../core/reporting/interfaces/report-checkpoint-store.interface';
import { StrategyGroup } from '../../core/strategy/strategy-group';
import { PrismaService } from './prisma.service';

/**
 * Implementación real (PostgreSQL/Supabase vía Prisma) de ReportCheckpointStore.
 *
 * Nunca lanza: el checkpoint es una optimización de continuidad entre
 * despliegues, no una dependencia dura del motor (mismo criterio que
 * PrismaService.checkHealth). Si DATABASE_URL no está configurada o la
 * conexión falla, `loadAll` devuelve `[]` (el motor arranca desde cero,
 * comportamiento idéntico al actual) y `save` solo loguea un warning.
 */
@Injectable()
export class PrismaReportCheckpointStore implements ReportCheckpointStore {
  private readonly logger = new Logger(PrismaReportCheckpointStore.name);

  constructor(private readonly prisma: PrismaService) {}

  async loadAll(): Promise<ReadonlyArray<ReportCheckpointSnapshot>> {
    try {
      const rows = await this.prisma.getClient().reportCheckpoint.findMany();

      return rows.map((row) => ({
        channel: row.channel as StrategyGroup,
        won: row.won,
        lost: row.lost,
        alertsSent: row.alertsSent,
        firstStartedAt: row.firstStartedAt,
      }));
    } catch (error) {
      this.logger.warn(
        `No se pudo leer el checkpoint de reportes; se arranca desde cero. ${(error as Error).message}`,
      );
      return [];
    }
  }

  async save(snapshot: ReportCheckpointSnapshot): Promise<void> {
    try {
      await this.prisma.getClient().reportCheckpoint.upsert({
        where: { channel: snapshot.channel },
        create: {
          channel: snapshot.channel,
          won: snapshot.won,
          lost: snapshot.lost,
          alertsSent: snapshot.alertsSent,
          firstStartedAt: snapshot.firstStartedAt,
        },
        update: {
          won: snapshot.won,
          lost: snapshot.lost,
          alertsSent: snapshot.alertsSent,
          // firstStartedAt NUNCA se toca en un update: debe seguir
          // reflejando el primer arranque real, no el más reciente.
        },
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo guardar el checkpoint de reportes (canal "${snapshot.channel}"). ${(error as Error).message}`,
      );
    }
  }
}
