import { Logger } from '@nestjs/common';

import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { NotificationSeverity } from '../../core/enums/notification-severity.enum';
import { createNotification } from '../../core/notification/notification.type';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { TelegramChannel } from '../../infrastructure/telegram/telegram.channel';
import { NotificationChannelDispatcher } from './notification-channel-dispatcher';

/**
 * Verifica el enrutamiento real por estrategia entre el canal oficial de
 * Telegram y el de pruebas (ver NotificationModule): streak-4 (y solo
 * streak-4) debe llegar exclusivamente al canal de pruebas; cualquier otra
 * estrategia (o ninguna, como los reportes) debe llegar exclusivamente al
 * canal oficial. Usa instancias reales de TelegramChannel, configuradas
 * igual que en NotificationModule, en vez de dobles genéricos.
 */
describe('Telegram official/test channel routing', () => {
  const TEST_ONLY_STRATEGY_IDS = new Set(['streak-4']);

  function buildOfficialChannel(): TelegramChannel {
    return new TelegramChannel({
      label: 'Oficial',
      channelType: NotificationChannelType.TELEGRAM,
      botToken: 'official-token',
      chatId: 'official-chat',
      isStrategyAllowed: (strategyId) =>
        strategyId === undefined || !TEST_ONLY_STRATEGY_IDS.has(strategyId),
    });
  }

  function buildTestChannel(): TelegramChannel {
    return new TelegramChannel({
      label: 'Pruebas',
      channelType: NotificationChannelType.TELEGRAM_PRUEBAS,
      botToken: 'test-token',
      chatId: 'test-chat',
      isStrategyAllowed: (strategyId) =>
        strategyId !== undefined && TEST_ONLY_STRATEGY_IDS.has(strategyId),
    });
  }

  function buildDispatcher(
    official: TelegramChannel,
    test: TelegramChannel,
  ): NotificationChannelDispatcher {
    const domainEventBus: jest.Mocked<DomainEventBus> = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      publish: jest.fn(),
      publishMany: jest.fn(),
      clear: jest.fn(),
    };
    return new NotificationChannelDispatcher(
      domainEventBus,
      [official, test],
      new EngineErrorTracker(),
    );
  }

  function dispatchWithStrategy(
    official: TelegramChannel,
    test: TelegramChannel,
    strategyId?: string,
  ): void {
    buildDispatcher(official, test).dispatchToAll((channelType) =>
      createNotification({
        title: '',
        message: 'msg',
        severity: NotificationSeverity.INFO,
        channel: channelType,
        metadata: strategyId ? { strategyId } : {},
      }),
    );
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('routes streak-3 notifications only to the official channel', () => {
    const official = buildOfficialChannel();
    const test = buildTestChannel();
    const officialSend = jest
      .spyOn(official, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });
    const testSend = jest
      .spyOn(test, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });

    dispatchWithStrategy(official, test, 'streak-3');

    expect(officialSend).toHaveBeenCalledTimes(1);
    expect(testSend).not.toHaveBeenCalled();
  });

  it('routes streak-4 notifications only to the test channel', () => {
    const official = buildOfficialChannel();
    const test = buildTestChannel();
    const officialSend = jest
      .spyOn(official, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });
    const testSend = jest
      .spyOn(test, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });

    dispatchWithStrategy(official, test, 'streak-4');

    expect(officialSend).not.toHaveBeenCalled();
    expect(testSend).toHaveBeenCalledTimes(1);
  });

  it('routes strategy-less notifications (e.g. reports) only to the official channel', () => {
    const official = buildOfficialChannel();
    const test = buildTestChannel();
    const officialSend = jest
      .spyOn(official, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });
    const testSend = jest
      .spyOn(test, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });

    dispatchWithStrategy(official, test, undefined);

    expect(officialSend).toHaveBeenCalledTimes(1);
    expect(testSend).not.toHaveBeenCalled();
  });

  it('assigns a distinct getChannelType() to each instance, so message cleanup targets the right bot', () => {
    const official = buildOfficialChannel();
    const test = buildTestChannel();

    expect(official.getChannelType()).toBe(NotificationChannelType.TELEGRAM);
    expect(test.getChannelType()).toBe(
      NotificationChannelType.TELEGRAM_PRUEBAS,
    );
    expect(official.getChannelType()).not.toBe(test.getChannelType());
  });
});
