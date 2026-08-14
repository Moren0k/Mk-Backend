import { Module } from '@nestjs/common';

import { ObservabilityModule } from '../../../application/observability/observability.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ObservabilityModule],
  controllers: [HealthController],
})
export class HealthModule {}
