import { Module, Provider } from '@nestjs/common';

import { NOTIFICATION_CHANNELS } from '../../core/constants/injection-tokens.constants';
import { NotificationFactory } from '../../core/notification/notification.factory';
import { TelegramChannel } from '../../infrastructure/telegram/telegram.channel';
import { DomainEventBusModule } from '../domain-events/domain-event-bus.module';
import { DistributionMetricModule } from '../metrics/distribution-metric.module';
import { ErrorTrackingModule } from '../observability/error-tracking.module';
import { NotificationCoordinator } from './notification.coordinator';

/**
 * NestJS no tiene "multi providers" nativos (ver StrategyModule para el
 * mismo razonamiento): cada canal se registra como su propio provider y
 * este factory los agrupa bajo NOTIFICATION_CHANNELS. Agregar un canal
 * nuevo (Discord, email...): sumarlo a `providers`, a `inject` y al
 * arreglo. NotificationCoordinator nunca cambia.
 */
const notificationChannelsProvider: Provider = {
  provide: NOTIFICATION_CHANNELS,
  useFactory: (telegram: TelegramChannel) => [telegram],
  inject: [TelegramChannel],
};

@Module({
  imports: [
    DomainEventBusModule,
    ErrorTrackingModule,
    DistributionMetricModule,
  ],
  providers: [
    NotificationCoordinator,
    NotificationFactory,
    TelegramChannel,
    notificationChannelsProvider,
  ],
  exports: [NOTIFICATION_CHANNELS, NotificationFactory],
})
export class NotificationModule {}
