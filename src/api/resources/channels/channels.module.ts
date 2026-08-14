import { Module } from '@nestjs/common';

import { StrategyChannelRegistryModule } from '../../../application/strategy/strategy-channel-registry.module';
import { ChannelsController } from './channels.controller';

@Module({
  imports: [StrategyChannelRegistryModule],
  controllers: [ChannelsController],
})
export class ChannelsModule {}
