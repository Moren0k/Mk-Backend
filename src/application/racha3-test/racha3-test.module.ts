import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RACHA3_TEST_DEBUG_CHANNEL } from '../../core/constants/injection-tokens.constants';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import {
  TelegramChannel,
  TelegramChannelConfig,
} from '../../infrastructure/telegram/telegram.channel';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DomainEventBusModule } from '../domain-events/domain-event-bus.module';
import { HistoryModule } from '../history/history.module';
import { StrategyModule } from '../strategy/strategy.module';
import { Racha3TestCoordinator } from './racha3-test.coordinator';
import { Racha3TestDebugNotifier } from './racha3-test-debug.notifier';
import { Racha3TestEvidenceProvider } from './racha3-test.evidence-provider';
import { Racha3TestSimulationRegistry } from './racha3-test-simulation.registry';

/** Token privado: sólo une la config con su canal. */
const RACHA3_TEST_DEBUG_CONFIG = Symbol('Racha3TestDebugConfig');

/**
 * Canal Telegram dedicado al DEBUG de Racha 3 Test.
 *
 * Es una tercera instancia de `TelegramChannel` — la clase está diseñada
 * para eso: "parametrizable, no un singleton" (ver `NotificationModule`).
 *
 * Tres diferencias con los canales de producción, todas necesarias:
 *
 * 1. **NO se registra en `NOTIFICATION_CHANNELS`.** Si estuviera ahí,
 *    `NotificationCoordinator.dispatchToAll()` le enviaría también las
 *    alertas reales de `streak-3`/`streak-4`, y el canal experimental
 *    recibiría producción.
 *
 * 2. **`enabledWhen` depende sólo de `RACHA3_TEST_ENABLED`**, nunca de
 *    `StrategyChannelRegistry`. Los canales oficial y de pruebas se apagan
 *    y encienden desde `PATCH /api/v1/channels/:channel`; atar el DEBUG a
 *    eso habría hecho que el experimento dependa de la configuración de las
 *    estrategias reales, y que activarlo expulsara a la estrategia asignada
 *    al canal de pruebas ("un canal, como máximo una estrategia").
 *
 * 3. **`isStrategyAllowed` siempre `true`.** El destino ya está elegido a
 *    propósito y el notificador no aplica `supports()`; el filtro por
 *    asignación de estrategia es precisamente el acoplamiento que se evita.
 *
 * Si conviene reutilizar el bot/chat de pruebas, basta no definir
 * `RACHA3_TEST_TELEGRAM_*`: la config cae a `TELEGRAM_PRUEBAS_*`. Eso
 * comparte el destino sin compartir el interruptor.
 */
const debugConfigProvider: Provider = {
  provide: RACHA3_TEST_DEBUG_CONFIG,
  useFactory: (configService: ConfigService): TelegramChannelConfig => ({
    label: 'Racha3Test DEBUG',
    channelType: NotificationChannelType.TELEGRAM_RACHA3_TEST,
    botToken:
      configService.get<string>('racha3Test.telegram.botToken') ??
      configService.get<string>('telegram.pruebas.botToken'),
    chatId:
      configService.get<string>('racha3Test.telegram.chatId') ??
      configService.get<string>('telegram.pruebas.chatId'),
    isStrategyAllowed: () => true,
    enabledWhen: () => configService.get<boolean>('racha3Test.enabled', false),
  }),
  inject: [ConfigService],
};

const debugChannelProvider: Provider = {
  provide: RACHA3_TEST_DEBUG_CHANNEL,
  useFactory: (config: TelegramChannelConfig) => new TelegramChannel(config),
  inject: [RACHA3_TEST_DEBUG_CONFIG],
};

/**
 * Estrategia experimental Racha 3 Test.
 *
 * Importa `StrategyModule` únicamente para leer el token `STRATEGIES` y
 * localizar la instancia real de `Streak3Strategy` con la que detecta la
 * señal. No aporta nada a ese token: `racha-3-test` NO es una `Strategy`
 * registrada, y por eso `OperationCoordinator` nunca ve una señal suya y
 * nunca crea una operación real.
 *
 * Arranca apagada. Sin `RACHA3_TEST_ENABLED=true` el coordinator no se
 * suscribe a nada y el canal DEBUG no envía nada.
 */
@Module({
  imports: [
    DomainEventBusModule,
    HistoryModule,
    StrategyModule,
    AnalyticsModule,
  ],
  providers: [
    debugConfigProvider,
    debugChannelProvider,
    Racha3TestSimulationRegistry,
    Racha3TestEvidenceProvider,
    Racha3TestDebugNotifier,
    Racha3TestCoordinator,
  ],
  exports: [Racha3TestCoordinator, Racha3TestSimulationRegistry],
})
export class Racha3TestModule {}
