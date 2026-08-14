import { Module } from '@nestjs/common';

import { ReadModelsModule } from '../../../application/read-models/read-models.module';
import { StrategiesController } from './strategies.controller';

@Module({
  imports: [ReadModelsModule],
  controllers: [StrategiesController],
})
export class StrategiesModule {}
