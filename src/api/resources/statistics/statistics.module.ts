import { Module } from '@nestjs/common';

import { StatisticsModule as ApplicationStatisticsModule } from '../../../application/statistics/statistics.module';
import { StatisticsController } from './statistics.controller';

@Module({
  imports: [ApplicationStatisticsModule],
  controllers: [StatisticsController],
})
export class StatisticsModule {}
