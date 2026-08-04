import { Logger } from '@nestjs/common';

import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { NotificationSeverity } from '../../core/enums/notification-severity.enum';
import {
  createNotification,
  Notification,
} from '../../core/notification/notification.type';
import { TelegramChannel, TelegramChannelConfig } from './telegram.channel';
import { MAX_SEND_ATTEMPTS, RETRY_DELAY_MS } from './telegram-retry.constants';

function buildNotification(
  overrides: Partial<Notification> = {},
): Notification {
  return {
    ...createNotification({
      title: 'Nueva operación',
      message: 'Estrategia: Streak 3\nEntrada: BANKER',
      severity: NotificationSeverity.INFO,
      channel: NotificationChannelType.TELEGRAM,
    }),
    ...overrides,
  };
}

function buildConfig(
  overrides: Partial<TelegramChannelConfig> = {},
): TelegramChannelConfig {
  return {
    label: 'Oficial',
    channelType: NotificationChannelType.TELEGRAM,
    botToken: 'test-bot-token',
    chatId: 'test-chat-id',
    isStrategyAllowed: () => true,
    ...overrides,
  };
}

describe('TelegramChannel', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock = jest.fn();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reports its channel type and a name that includes its label', () => {
    const channel = new TelegramChannel(buildConfig({ label: 'Oficial' }));

    expect(channel.getChannelType()).toBe(NotificationChannelType.TELEGRAM);
    expect(channel.name()).toBe('Telegram (Oficial)');
  });

  it('reports a distinct channel type when configured for pruebas', () => {
    const channel = new TelegramChannel(
      buildConfig({
        label: 'Pruebas',
        channelType: NotificationChannelType.TELEGRAM_PRUEBAS,
      }),
    );

    expect(channel.getChannelType()).toBe(
      NotificationChannelType.TELEGRAM_PRUEBAS,
    );
  });

  it('is enabled only when both botToken and chatId are configured', () => {
    expect(new TelegramChannel(buildConfig()).enabled()).toBe(true);
    expect(
      new TelegramChannel(buildConfig({ botToken: undefined })).enabled(),
    ).toBe(false);
    expect(
      new TelegramChannel(buildConfig({ chatId: undefined })).enabled(),
    ).toBe(false);
  });

  it('supports a notification only when isStrategyAllowed says so', () => {
    const channel = new TelegramChannel(
      buildConfig({ isStrategyAllowed: (id) => id === 'streak-3' }),
    );

    expect(
      channel.supports(
        buildNotification({ metadata: { strategyId: 'streak-3' } }),
      ),
    ).toBe(true);
    expect(
      channel.supports(
        buildNotification({ metadata: { strategyId: 'streak-4' } }),
      ),
    ).toBe(false);
    expect(channel.supports(buildNotification({ metadata: {} }))).toBe(false);
  });

  it('sends a POST to sendMessage and returns SendResult with messageId', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ result: { message_id: 456 } }),
    });
    const channel = new TelegramChannel(
      buildConfig({ botToken: 'ABC123', chatId: '-999' }),
    );

    const result = await channel.send(
      buildNotification({
        title: 'Nueva operación',
        message: 'Racha de 3 (streak) - test!',
      }),
    );

    expect(result.delivered).toBe(true);
    expect(result.messageId).toBe(456);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://api.telegram.org/botABC123/sendMessage');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string) as {
      chat_id: string;
      text: string;
      parse_mode: string;
    };
    expect(body.chat_id).toBe('-999');
    expect(body.parse_mode).toBe('MarkdownV2');
    expect(body.text).toBe(
      '*Nueva operación*\nRacha de 3 \\(streak\\) \\- test\\!',
    );
  });

  it('retries up to MAX_SEND_ATTEMPTS times and then returns delivered=false', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('{"description":"boom"}'),
    });
    const channel = new TelegramChannel(buildConfig());

    const sendPromise = channel.send(buildNotification());
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS * MAX_SEND_ATTEMPTS);
    const result = await sendPromise;

    expect(result.delivered).toBe(false);
    expect(result.messageId).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(MAX_SEND_ATTEMPTS);
  });

  it('surfaces the response body Telegram sent back, so the real cause of a 400 is visible', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: jest
        .fn()
        .mockResolvedValue(
          '{"ok":false,"error_code":400,"description":"Bad Request: can\'t parse entities"}',
        ),
    });
    const channel = new TelegramChannel(buildConfig());

    const sendPromise = channel.send(buildNotification());
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS * MAX_SEND_ATTEMPTS);
    await sendPromise;

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('Intento'),
      expect.objectContaining({
        message: expect.stringContaining("can't parse entities") as string,
      }),
    );
  });

  it('succeeds on a later attempt after earlier ones fail', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ result: { message_id: 1 } }),
      });
    const channel = new TelegramChannel(buildConfig());

    const sendPromise = channel.send(buildNotification());
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    const result = await sendPromise;

    expect(result.delivered).toBe(true);
    expect(result.messageId).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never throws, even if fetch itself rejects on every attempt', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const channel = new TelegramChannel(buildConfig());

    const sendPromise = channel.send(buildNotification());
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS * MAX_SEND_ATTEMPTS);
    const result = await sendPromise;

    expect(result.delivered).toBe(false);
  });

  it('deletes a message via deleteMessage endpoint', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const channel = new TelegramChannel(
      buildConfig({ botToken: 'ABC123', chatId: '-999' }),
    );

    const deleted = await channel.deleteMessage(456);

    expect(deleted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://api.telegram.org/botABC123/deleteMessage');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as {
      chat_id: string;
      message_id: number;
    };
    expect(body.chat_id).toBe('-999');
    expect(body.message_id).toBe(456);
  });

  it('returns false when deleteMessage fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    const channel = new TelegramChannel(buildConfig());

    const deleted = await channel.deleteMessage(456);

    expect(deleted).toBe(false);
  });

  it('logs a warning and returns false when deleteMessage throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const channel = new TelegramChannel(buildConfig());

    const deleted = await channel.deleteMessage(456);

    expect(deleted).toBe(false);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });
});
