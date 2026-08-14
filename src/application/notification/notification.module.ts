import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  NOTIFICATION_CHANNELS,
  TELEGRAM_OFFICIAL_CHANNEL,
  TELEGRAM_TEST_CHANNEL,
} from '../../core/constants/injection-tokens.constants';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { NotificationFactory } from '../../core/notification/notification.factory';
import {
  TelegramChannel,
  TelegramChannelConfig,
} from '../../infrastructure/telegram/telegram.channel';
import { DomainEventBusModule } from '../domain-events/domain-event-bus.module';
import { DistributionMetricModule } from '../metrics/distribution-metric.module';
import { ErrorTrackingModule } from '../observability/error-tracking.module';
import { StrategyChannelRegistry } from '../strategy/strategy-channel-registry';
import { StrategyChannelRegistryModule } from '../strategy/strategy-channel-registry.module';
import { NotificationCoordinator } from './notification.coordinator';
import { MessageTracker } from './message-tracker';

/** Tokens privados de este módulo: solo unen la config con su canal. */
const TELEGRAM_OFFICIAL_CONFIG = Symbol('TelegramOfficialConfig');
const TELEGRAM_TEST_CONFIG = Symbol('TelegramTestConfig');

/**
 * TelegramChannel es una clase parametrizable (ver su config), no un
 * singleton: aquí se arman dos instancias —oficial y de pruebas—, cada una
 * con su propio bot/chat y su propio criterio de qué estrategias le
 * corresponden, reutilizando toda la lógica de envío/reintentos sin
 * duplicarla.
 *
 * `isStrategyAllowed`/`enabledWhen` consultan `StrategyChannelRegistry`
 * (Mk-Api.md Anexo D §3) en cada llamada — no `resolveStrategyGroup`
 * estático — porque `TelegramChannel.supports()`/`enabled()` se invocan en
 * vivo por cada notificación (ver `notification-channel-dispatcher.ts`),
 * así que una reasignación de canal o activar/desactivar un canal vía
 * `PATCH /api/v1/channels/:channel` aplica de inmediato a la siguiente
 * notificación, sin reiniciar el proceso. Ambos canales arrancan
 * inactivos por default (2026-08-11): sin configurar nada vía API, no
 * sale ningún mensaje.
 */
const officialTelegramConfigProvider: Provider = {
  provide: TELEGRAM_OFFICIAL_CONFIG,
  useFactory: (
    configService: ConfigService,
    strategyChannelRegistry: StrategyChannelRegistry,
  ): TelegramChannelConfig => ({
    label: 'Oficial',
    channelType: NotificationChannelType.TELEGRAM,
    botToken: configService.get<string>('telegram.botToken'),
    chatId: configService.get<string>('telegram.chatId'),
    isStrategyAllowed: (strategyId) =>
      strategyChannelRegistry.isAssignedTo(strategyId, 'oficial'),
    enabledWhen: () => strategyChannelRegistry.isActive('oficial'),
  }),
  inject: [ConfigService, StrategyChannelRegistry],
};

const testTelegramConfigProvider: Provider = {
  provide: TELEGRAM_TEST_CONFIG,
  useFactory: (
    configService: ConfigService,
    strategyChannelRegistry: StrategyChannelRegistry,
  ): TelegramChannelConfig => ({
    label: 'Pruebas',
    channelType: NotificationChannelType.TELEGRAM_PRUEBAS,
    botToken: configService.get<string>('telegram.pruebas.botToken'),
    chatId: configService.get<string>('telegram.pruebas.chatId'),
    isStrategyAllowed: (strategyId) =>
      strategyChannelRegistry.isAssignedTo(strategyId, 'pruebas'),
    // TELEGRAM_PRUEBAS_ENABLED (deploy-time) Y StrategyChannelRegistry
    // (runtime, activo por canal) deben permitir el envío: el env var
    // sigue siendo el interruptor maestro de despliegue, el registro es
    // el control fino desde la API — y ambos arrancan restrictivos.
    enabledWhen: () =>
      (configService.get<boolean>('telegram.pruebas.enabled') ?? true) &&
      strategyChannelRegistry.isActive('pruebas'),
  }),
  inject: [ConfigService, StrategyChannelRegistry],
};

const officialTelegramChannelProvider: Provider = {
  provide: TELEGRAM_OFFICIAL_CHANNEL,
  useFactory: (config: TelegramChannelConfig) => new TelegramChannel(config),
  inject: [TELEGRAM_OFFICIAL_CONFIG],
};

const testTelegramChannelProvider: Provider = {
  provide: TELEGRAM_TEST_CHANNEL,
  useFactory: (config: TelegramChannelConfig) => new TelegramChannel(config),
  inject: [TELEGRAM_TEST_CONFIG],
};

/**
 * NestJS no tiene "multi providers" nativos (ver StrategyModule para el
 * mismo razonamiento): cada canal se registra como su propio provider y
 * este factory los agrupa bajo NOTIFICATION_CHANNELS. Agregar un canal
 * nuevo (Discord, email...): sumarlo a `providers`, a `inject` y al
 * arreglo. NotificationCoordinator nunca cambia.
 */
const notificationChannelsProvider: Provider = {
  provide: NOTIFICATION_CHANNELS,
  useFactory: (official: TelegramChannel, test: TelegramChannel) => [
    official,
    test,
  ],
  inject: [TELEGRAM_OFFICIAL_CHANNEL, TELEGRAM_TEST_CHANNEL],
};

@Module({
  imports: [
    DomainEventBusModule,
    ErrorTrackingModule,
    DistributionMetricModule,
    StrategyChannelRegistryModule,
  ],
  providers: [
    NotificationCoordinator,
    NotificationFactory,
    MessageTracker,
    officialTelegramConfigProvider,
    testTelegramConfigProvider,
    officialTelegramChannelProvider,
    testTelegramChannelProvider,
    notificationChannelsProvider,
  ],
  exports: [NOTIFICATION_CHANNELS, NotificationFactory],
})
export class NotificationModule {}
