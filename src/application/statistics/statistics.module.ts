import { Module } from '@nestjs/common';

import { DomainEventBusModule } from '../domain-events/domain-event-bus.module';
import { StatisticsService } from './statistics.service';

@Module({
  imports: [DomainEventBusModule],
  providers: [StatisticsService],
  exports: [StatisticsService],
})
export class StatisticsModule {}
