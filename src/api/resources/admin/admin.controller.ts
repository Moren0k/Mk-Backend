import { BadRequestException, Post, Query } from '@nestjs/common';

import { AdminNotificationChannel } from '../../../application/admin/admin-command.type';
import { SummaryReportService } from '../../../application/reporting/summary-report.service';
import type { SummaryReportResult } from '../../../core/reporting/types/summary-report-result.type';
import { ApiResource } from '../../common/decorators/api-resource.decorator';

const SUPPORTED_CHANNELS: ReadonlySet<string> = new Set(
  Object.values(AdminNotificationChannel),
);

type GenerateReportResponse = {
  readonly channel: AdminNotificationChannel;
  readonly dispatchedAt: string;
  readonly metrics: SummaryReportResult;
};

/**
 * POST /api/v1/admin/reports — migración del comando `RESUMEN` (Mk-Api.md
 * ADR-11, Anexo D §7): mismo caso de uso que `POST /admin/commands`
 * (`AdminController` en `application/admin/`, que sigue activo en
 * paralelo durante la ventana de transición), autenticado con
 * `X-Api-Key` (`@ApiResource`, Anexo D §5) en vez de una contraseña en el
 * body. El alcance no crece más allá de este único comando.
 */
@ApiResource('admin')
export class AdminController {
  constructor(private readonly summaryReportService: SummaryReportService) {}

  @Post('reports')
  generateReport(
    @Query('channel') channelParam?: string,
  ): GenerateReportResponse {
    const channel = this.parseChannel(channelParam);
    const metrics = this.summaryReportService.generateAndDispatch(channel);

    return {
      channel,
      dispatchedAt: new Date().toISOString(),
      metrics,
    };
  }

  /** Default "todos" si el cliente no manda `channel`, igual que el endpoint legado. */
  private parseChannel(
    candidate: string | undefined,
  ): AdminNotificationChannel {
    if (candidate === undefined) {
      return AdminNotificationChannel.TODOS;
    }

    if (!SUPPORTED_CHANNELS.has(candidate)) {
      throw new BadRequestException(
        `Canal no soportado. Usa "${AdminNotificationChannel.OFICIAL}", "${AdminNotificationChannel.PRUEBAS}" o "${AdminNotificationChannel.TODOS}".`,
      );
    }

    return candidate as AdminNotificationChannel;
  }
}
