import { Module } from '@nestjs/common';

import { ReadModelsModule } from '../../../application/read-models/read-models.module';
import { HistoryController } from './history.controller';

@Module({
  imports: [ReadModelsModule],
  controllers: [HistoryController],
})
export class HistoryModule {}
