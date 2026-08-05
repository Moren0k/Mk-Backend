import { Logger } from '@nestjs/common';

import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { NotificationSeverity } from '../../core/enums/notification-severity.enum';
import { createNotification } from '../../core/notification/notification.type';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { resolveStrategyGroup } from '../../core/strategy/strategy-group';
import { TelegramChannel } from '../../infrastructure/telegram/telegram.channel';
import { NotificationChannelDispatcher } from './notification-channel-dispatcher';

/**
 * Verifica el enrutamiento real por estrategia entre el canal oficial de
 * Telegram y el de pruebas (ver NotificationModule): alternancia-34 (y
 * solo las estrategias marcadas como "solo pruebas" en strategy-group.ts)
 * debe llegar exclusivamente al canal de pruebas; cualquier otra estrategia
 * (o ninguna, como los reportes) debe llegar exclusivamente al canal
 * oficial. Usa instancias reales de TelegramChannel, configuradas igual que
 * en NotificationModule (mismo `resolveStrategyGroup` de `core/strategy`,
 * no una copia local), en vez de dobles genéricos.
 */
describe('Telegram official/test channel routing', () => {
  function buildOfficialChannel(
    overrides: { enabledWhen?: () => boolean } = {},
  ): TelegramChannel {
    return new TelegramChannel({
      label: 'Oficial',
      channelType: NotificationChannelType.TELEGRAM,
      botToken: 'official-token',
      chatId: 'official-chat',
      isStrategyAllowed: (strategyId) =>
        resolveStrategyGroup(strategyId) === 'oficial',
      ...overrides,
    });
  }

  function buildTestChannel(
    overrides: { enabledWhen?: () => boolean } = {},
  ): TelegramChannel {
    return new TelegramChannel({
      label: 'Pruebas',
      channelType: NotificationChannelType.TELEGRAM_PRUEBAS,
      botToken: 'test-token',
      chatId: 'test-chat',
      isStrategyAllowed: (strategyId) =>
        resolveStrategyGroup(strategyId) === 'pruebas',
      ...overrides,
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

  it('routes streak-4 notifications only to the official channel', () => {
    const official = buildOfficialChannel();
    const test = buildTestChannel();
    const officialSend = jest
      .spyOn(official, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });
    const testSend = jest
      .spyOn(test, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });

    dispatchWithStrategy(official, test, 'streak-4');

    expect(officialSend).toHaveBeenCalledTimes(1);
    expect(testSend).not.toHaveBeenCalled();
  });

  it('routes alternancia-34 notifications only to the test channel', () => {
    const official = buildOfficialChannel();
    const test = buildTestChannel();
    const officialSend = jest
      .spyOn(official, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });
    const testSend = jest
      .spyOn(test, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });

    dispatchWithStrategy(official, test, 'alternancia-34');

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

  it('routes nothing to the test channel when TELEGRAM_PRUEBAS_ENABLED is false, regardless of strategy', () => {
    const official = buildOfficialChannel();
    const test = buildTestChannel({ enabledWhen: () => false });
    const officialSend = jest
      .spyOn(official, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });
    const testSend = jest
      .spyOn(test, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });

    dispatchWithStrategy(official, test, 'alternancia-34');

    expect(officialSend).not.toHaveBeenCalled();
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
