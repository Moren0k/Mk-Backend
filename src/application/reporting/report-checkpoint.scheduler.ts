import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SummaryReportService } from './summary-report.service';

/** Default si `REPORT_CHECKPOINT_INTERVAL_MS` no está definida: 10 minutos. */
const DEFAULT_CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Guarda periódicamente el checkpoint de reportes (won/lost/alertsSent/
 * firstStartedAt por canal) en la base de datos, vía
 * `SummaryReportService.persistCheckpoint` — así un redeploy/reinicio del
 * proceso (p. ej. en Vercel/Railway, donde la memoria en runtime no
 * sobrevive entre despliegues) nunca pierde el acumulado que expone
 * `GET /api/v1/reports/summary`.
 *
 * A diferencia de ReportScheduler (que alinea sus ticks a límites de hora
 * de reloj de Bogotá, porque el reporte horario tiene significado de
 * negocio atado a esa hora exacta), este intervalo es puramente técnico —
 * "cada tantos minutos, sea la hora que sea" — así que un `setInterval`
 * simple alcanza, sin necesidad de recalcular contra ningún límite de
 * reloj.
 *
 * Nunca lanza ni tumba el proceso: `persistCheckpoint` ya absorbe
 * cualquier fallo de persistencia (ver `PrismaReportCheckpointStore`) — si
 * Supabase está caído, el checkpoint simplemente no se actualiza en ese
 * tick, sin afectar el resto del motor.
 */
@Injectable()
export class ReportCheckpointScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ReportCheckpointScheduler.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly summaryReportService: SummaryReportService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.configService.get<number>(
      'report.checkpointIntervalMs',
      DEFAULT_CHECKPOINT_INTERVAL_MS,
    );

    this.timer = setInterval(() => {
      this.runTick();
    }, intervalMs);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private runTick(): void {
    this.summaryReportService.persistCheckpoint().catch((error: unknown) => {
      this.logger.error(
        'Error inesperado al guardar el checkpoint de reportes.',
        error as Error,
      );
    });
  }
}
