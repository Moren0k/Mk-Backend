import { Module } from '@nestjs/common';

import { ReportingModule } from '../reporting/reporting.module';
import { AdminController } from './admin.controller';

/**
 * Único punto de entrada HTTP administrativo del sistema. Importa
 * ReportingModule solo para inyectar SummaryReportService — no expone ni
 * depende de nada más del motor de señales.
 */
@Module({
  imports: [ReportingModule],
  controllers: [AdminController],
})
export class AdminModule {}
