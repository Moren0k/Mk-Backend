import { Module } from '@nestjs/common';

import { ReportingModule } from '../../../application/reporting/reporting.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [ReportingModule],
  controllers: [AdminController],
})
export class AdminModule {}
