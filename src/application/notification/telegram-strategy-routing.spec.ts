import { Logger } from '@nestjs/common';

import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { NotificationSeverity } from '../../core/enums/notification-severity.enum';
import { createNotification } from '../../core/notification/notification.type';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import type { StrategyExecutionGuard } from '../../core/strategy/interfaces/strategy-execution-guard.interface';
import { TelegramChannel } from '../../infrastructure/telegram/telegram.channel';
import { NotificationChannelDispatcher } from './notification-channel-dispatcher';
import { StrategyChannelRegistry } from '../strategy/strategy-channel-registry';

/**
 * Verifica el enrutamiento real por estrategia entre el canal oficial de
 * Telegram y el de pruebas (ver NotificationModule), usando instancias
 * reales de `TelegramChannel` y `StrategyChannelRegistry`, configuradas
 * igual que en `NotificationModule`.
 *
 * Desde 2026-08-11: ninguna estrategia viene asignada a ningún canal por
 * default, y ningún canal viene activo — cada test que ejercita
 * enrutamiento asigna y activa explícitamente lo que necesita, para
 * separar "¿a qué canal pertenece esta estrategia?" (`isAssignedTo`) de
 * "¿el canal está prendido?" (`isActive`, que gatea `enabled()`).
 */
describe('Telegram official/test channel routing', () => {
  function buildRegistry(
    executionGuard: StrategyExecutionGuard = { canExecute: () => true },
  ): StrategyChannelRegistry {
    return new StrategyChannelRegistry(executionGuard);
  }

  function buildOfficialChannel(
    registry: StrategyChannelRegistry,
    overrides: { enabledWhen?: () => boolean } = {},
  ): TelegramChannel {
    return new TelegramChannel({
      label: 'Oficial',
      channelType: NotificationChannelType.TELEGRAM,
      botToken: 'official-token',
      chatId: 'official-chat',
      isStrategyAllowed: (strategyId) =>
        registry.isAssignedTo(strategyId, 'oficial'),
      enabledWhen: () => registry.isActive('oficial'),
      ...overrides,
    });
  }

  function buildTestChannel(
    registry: StrategyChannelRegistry,
    overrides: { enabledWhen?: () => boolean } = {},
  ): TelegramChannel {
    return new TelegramChannel({
      label: 'Pruebas',
      channelType: NotificationChannelType.TELEGRAM_PRUEBAS,
      botToken: 'test-token',
      chatId: 'test-chat',
      isStrategyAllowed: (strategyId) =>
        registry.isAssignedTo(strategyId, 'pruebas'),
      enabledWhen: () => registry.isActive('pruebas'),
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

  it('routes nothing anywhere when the strategy has no channel assigned (new default)', () => {
    const registry = buildRegistry();
    registry.setActive('oficial', true);
    registry.setActive('pruebas', true);
    const official = buildOfficialChannel(registry);
    const test = buildTestChannel(registry);
    const officialSend = jest
      .spyOn(official, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });
    const testSend = jest
      .spyOn(test, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });

    dispatchWithStrategy(official, test, 'streak-4');

    expect(officialSend).not.toHaveBeenCalled();
    expect(testSend).not.toHaveBeenCalled();
  });

  it('routes streak-3 notifications only to the official channel, once assigned and active', () => {
    const registry = buildRegistry();
    registry.assignStrategyToChannel('streak-3', 'oficial');
    registry.setActive('oficial', true);
    const official = buildOfficialChannel(registry);
    const test = buildTestChannel(registry);
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

  it('routes streak-4 notifications only to the official channel, once assigned and active', () => {
    const registry = buildRegistry();
    registry.assignStrategyToChannel('streak-4', 'oficial');
    registry.setActive('oficial', true);
    const official = buildOfficialChannel(registry);
    const test = buildTestChannel(registry);
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

  it('routes estrategia-pruebas notifications only to the test channel, once assigned and active', () => {
    const registry = buildRegistry();
    registry.assignStrategyToChannel('estrategia-pruebas', 'pruebas');
    registry.setActive('pruebas', true);
    const official = buildOfficialChannel(registry);
    const test = buildTestChannel(registry);
    const officialSend = jest
      .spyOn(official, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });
    const testSend = jest
      .spyOn(test, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });

    dispatchWithStrategy(official, test, 'estrategia-pruebas');

    expect(officialSend).not.toHaveBeenCalled();
    expect(testSend).toHaveBeenCalledTimes(1);
  });

  it('routes a strategy assigned to a channel but not active nowhere, even with the right assignment', () => {
    const registry = buildRegistry();
    registry.assignStrategyToChannel('estrategia-pruebas', 'pruebas');
    // "pruebas" never got activated.
    const official = buildOfficialChannel(registry);
    const test = buildTestChannel(registry);
    const officialSend = jest
      .spyOn(official, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });
    const testSend = jest
      .spyOn(test, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });

    dispatchWithStrategy(official, test, 'estrategia-pruebas');

    expect(officialSend).not.toHaveBeenCalled();
    expect(testSend).not.toHaveBeenCalled();
  });

  it('routes strategy-less notifications (e.g. reports) only to the official channel, once active', () => {
    const registry = buildRegistry();
    registry.setActive('oficial', true);
    const official = buildOfficialChannel(registry);
    const test = buildTestChannel(registry);
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

  it('routes nothing to the test channel once it is deactivated, regardless of strategy', () => {
    const registry = buildRegistry();
    registry.assignStrategyToChannel('estrategia-pruebas', 'pruebas');
    registry.setActive('pruebas', true);
    registry.setActive('pruebas', false);
    const official = buildOfficialChannel(registry);
    const test = buildTestChannel(registry);
    const officialSend = jest
      .spyOn(official, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });
    const testSend = jest
      .spyOn(test, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });

    dispatchWithStrategy(official, test, 'estrategia-pruebas');

    expect(officialSend).not.toHaveBeenCalled();
    expect(testSend).not.toHaveBeenCalled();
  });

  it('reflects a live reassignment: reassigning streak-4 to "pruebas" reroutes its very next notification', () => {
    const registry = buildRegistry();
    registry.setActive('oficial', true);
    registry.setActive('pruebas', true);
    const official = buildOfficialChannel(registry);
    const test = buildTestChannel(registry);
    const officialSend = jest
      .spyOn(official, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });
    const testSend = jest
      .spyOn(test, 'send')
      .mockResolvedValue({ delivered: true, messageId: 1 });

    registry.assignStrategyToChannel('streak-4', 'pruebas');
    dispatchWithStrategy(official, test, 'streak-4');

    expect(officialSend).not.toHaveBeenCalled();
    expect(testSend).toHaveBeenCalledTimes(1);
  });

  it('assigns a distinct getChannelType() to each instance, so message cleanup targets the right bot', () => {
    const registry = buildRegistry();
    const official = buildOfficialChannel(registry);
    const test = buildTestChannel(registry);

    expect(official.getChannelType()).toBe(NotificationChannelType.TELEGRAM);
    expect(test.getChannelType()).toBe(
      NotificationChannelType.TELEGRAM_PRUEBAS,
    );
    expect(official.getChannelType()).not.toBe(test.getChannelType());
  });
});
