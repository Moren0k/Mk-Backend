import { Get } from '@nestjs/common';

import { SummaryReportService } from '../../../application/reporting/summary-report.service';
import { ApiResource } from '../../common/decorators/api-resource.decorator';
import { toReportsSummaryVm } from '../../contracts/mappers/reports-summary.mapper';
import type { ReportsSummaryVm } from '../../contracts/view-models/reports-summary.vm';

/**
 * GET /api/v1/reports/summary — variante de solo lectura del comando admin
 * RESUMEN (`SummaryReportService.getSnapshot()`, sin dispatch a Telegram):
 * ganadas, perdidas y alertas enviadas por canal, más el uptime del
 * proceso. Pensado para que el dashboard del frontend lo sondee
 * libremente.
 */
@ApiResource('reports')
export class ReportsController {
  constructor(private readonly summaryReportService: SummaryReportService) {}

  @Get('summary')
  getSummary(): ReportsSummaryVm {
    return toReportsSummaryVm(this.summaryReportService.getSnapshot());
  }
}
