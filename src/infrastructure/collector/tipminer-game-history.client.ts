import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MAX_HISTORY_SIZE } from '../../core/constants/history.constants';
import { GameHistoryClient } from './game-history-client.interface';
import { GameDto } from './game.dto';
import { buildTipminerHistoryUrl, TipminerConfig } from './tipminer-endpoints';
import { TIPMINER_BROWSER_HEADERS } from './tipminer-browser-headers';

/**
 * Obtiene las últimas MAX_HISTORY_SIZE partidas desde la API pública de
 * Tipminer (ver API.MD, sección 5). La API las devuelve de más reciente a
 * más antigua; este cliente no reordena nada, esa decisión pertenece a
 * quien consume el resultado (GameEventCollector).
 */
@Injectable()
export class TipminerGameHistoryClient implements GameHistoryClient {
  constructor(private readonly configService: ConfigService) {}

  async fetchInitialHistory(): Promise<ReadonlyArray<GameDto>> {
    const url = buildTipminerHistoryUrl(this.readConfig(), MAX_HISTORY_SIZE);
    const response = await fetch(url, { headers: this.buildHeaders() });

    if (!response.ok) {
      throw new Error(
        `Tipminer history request failed with status ${response.status}`,
      );
    }

    const payload: unknown = await response.json();
    return Array.isArray(payload) ? (payload as GameDto[]) : [];
  }

  private readConfig(): TipminerConfig {
    return {
      baseUrl: this.configService.get<string>('tipminer.baseUrl', ''),
      providerId: this.configService.get<string>('tipminer.providerId', ''),
      timezone: this.configService.get<string>('tipminer.timezone', ''),
    };
  }

  private buildHeaders(): Record<string, string> {
    const apiKey = this.configService.get<string>('tipminer.apiKey');
    return {
      ...TIPMINER_BROWSER_HEADERS,
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
  }
}
