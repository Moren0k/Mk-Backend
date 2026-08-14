import { Module } from '@nestjs/common';

import { ReadModelsModule } from '../../../application/read-models/read-models.module';
import { EventsController } from './events.controller';

@Module({
  imports: [ReadModelsModule],
  controllers: [EventsController],
})
export class EventsModule {}
