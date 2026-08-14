import { Module } from '@nestjs/common';

import { ReportingModule } from '../../../application/reporting/reporting.module';
import { ReportsController } from './reports.controller';

@Module({
  imports: [ReportingModule],
  controllers: [ReportsController],
})
export class ReportsModule {}
