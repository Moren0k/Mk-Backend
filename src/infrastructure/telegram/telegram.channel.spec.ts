import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { NotificationSeverity } from '../../core/enums/notification-severity.enum';
import {
  createNotification,
  Notification,
} from '../../core/notification/notification.type';
import { TelegramChannel } from './telegram.channel';
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

function buildConfigService(
  overrides: { botToken?: string; chatId?: string } = {},
): ConfigService {
  const values: Record<string, string | undefined> = {
    'telegram.botToken':
      'botToken' in overrides ? overrides.botToken : 'test-bot-token',
    'telegram.chatId':
      'chatId' in overrides ? overrides.chatId : 'test-chat-id',
  };

  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('TelegramChannel', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fetchMock = jest.fn();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reports its channel type and name', () => {
    const channel = new TelegramChannel(buildConfigService());

    expect(channel.getChannelType()).toBe(NotificationChannelType.TELEGRAM);
    expect(channel.name()).toBe('Telegram');
  });

  it('is enabled only when both botToken and chatId are configured', () => {
    expect(new TelegramChannel(buildConfigService()).enabled()).toBe(true);
    expect(
      new TelegramChannel(
        buildConfigService({ botToken: undefined }),
      ).enabled(),
    ).toBe(false);
    expect(
      new TelegramChannel(buildConfigService({ chatId: undefined })).enabled(),
    ).toBe(false);
  });

  it('supports any notification', () => {
    const channel = new TelegramChannel(buildConfigService());

    expect(channel.supports(buildNotification())).toBe(true);
  });

  it('sends a POST to the official sendMessage endpoint with MarkdownV2 text', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const channel = new TelegramChannel(
      buildConfigService({ botToken: 'ABC123', chatId: '-999' }),
    );

    const delivered = await channel.send(
      buildNotification({
        title: 'Nueva operación',
        message: 'Racha de 3 (streak) - test!',
      }),
    );

    expect(delivered).toBe(true);
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

  it('retries up to MAX_SEND_ATTEMPTS times and then gives up without throwing', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('{"description":"boom"}'),
    });
    const channel = new TelegramChannel(buildConfigService());

    const sendPromise = channel.send(buildNotification());
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS * MAX_SEND_ATTEMPTS);
    await expect(sendPromise).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(MAX_SEND_ATTEMPTS);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('Intento'),
      expect.objectContaining({
        message: expect.stringContaining('boom') as string,
      }),
    );
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
    const channel = new TelegramChannel(buildConfigService());

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
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const channel = new TelegramChannel(buildConfigService());

    const sendPromise = channel.send(buildNotification());
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    await expect(sendPromise).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never throws, even if fetch itself rejects on every attempt', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const channel = new TelegramChannel(buildConfigService());

    const sendPromise = channel.send(buildNotification());
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS * MAX_SEND_ATTEMPTS);

    await expect(sendPromise).resolves.toBe(false);
  });
});
