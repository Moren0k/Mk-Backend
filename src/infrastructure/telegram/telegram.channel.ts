import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import type { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { Notification } from '../../core/notification/notification.type';
import { sleep } from '../shared/sleep';
import { escapeMarkdownV2 } from './markdown-v2';
import { MAX_SEND_ATTEMPTS, RETRY_DELAY_MS } from './telegram-retry.constants';

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org';

/**
 * Único canal que sabe que Telegram existe. No conoce Operation, Strategy,
 * History ni ningún DomainEvent: únicamente recibe una Notification ya
 * construida por NotificationFactory y la envía.
 *
 * Usa HTTP directo contra la API oficial de Bot de Telegram (sendMessage),
 * sin librerías externas: es un único POST con `fetch` nativo de Node.
 */
@Injectable()
export class TelegramChannel implements NotificationChannel {
  private readonly logger = new Logger(TelegramChannel.name);

  constructor(private readonly configService: ConfigService) {}

  getChannelType(): NotificationChannelType {
    return NotificationChannelType.TELEGRAM;
  }

  name(): string {
    return 'Telegram';
  }

  enabled(): boolean {
    return Boolean(this.botToken && this.chatId);
  }

  supports(): boolean {
    // Hoy Telegram maneja cualquier Notification. Queda como punto de
    // extensión (por ejemplo, filtrar por severidad) sin tocar el resto.
    return true;
  }

  async send(notification: Notification): Promise<boolean> {
    const text = this.buildMarkdownV2Text(notification);

    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      try {
        await this.callSendMessage(text);
        return true;
      } catch (error) {
        this.logger.error(
          `Intento ${attempt}/${MAX_SEND_ATTEMPTS} fallido al enviar a Telegram (notificationId=${notification.notificationId}).`,
          error as Error,
        );

        if (attempt < MAX_SEND_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS);
        }
      }
    }

    this.logger.error(
      `Se agotaron los ${MAX_SEND_ATTEMPTS} intentos; se descarta la notificación ${notification.notificationId}.`,
    );
    return false;
  }

  private get botToken(): string | undefined {
    return this.configService.get<string>('telegram.botToken');
  }

  private get chatId(): string | undefined {
    return this.configService.get<string>('telegram.chatId');
  }

  private buildMarkdownV2Text(notification: Notification): string {
    const title = escapeMarkdownV2(notification.title);
    const message = escapeMarkdownV2(notification.message);
    return `*${title}*\n${message}`;
  }

  private async callSendMessage(text: string): Promise<void> {
    const url = `${TELEGRAM_API_BASE_URL}/bot${this.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: 'MarkdownV2',
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '<sin cuerpo>');
      throw new Error(
        `Telegram respondió con estado ${response.status}: ${body}`,
      );
    }
  }
}
