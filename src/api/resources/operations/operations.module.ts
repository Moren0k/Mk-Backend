import { Module } from '@nestjs/common';

import { ReadModelsModule } from '../../../application/read-models/read-models.module';
import { OperationsController } from './operations.controller';

@Module({
  imports: [ReadModelsModule],
  controllers: [OperationsController],
})
export class OperationsModule {}
