import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventSource, EventSourceInit, FetchLike } from 'eventsource';

import { SseClient, SseConnectionHandlers } from './sse-client.interface';
import { TIPMINER_BROWSER_HEADERS } from './tipminer-browser-headers';
import { buildTipminerLiveUrl, TipminerConfig } from './tipminer-endpoints';

/**
 * Cliente SSE contra el stream en vivo de Tipminer (ver API.MD, sección 6),
 * implementado con la librería `eventsource` (WHATWG/W3C EventSource para
 * Node.js, ampliamente usada y mantenida: https://github.com/EventSource/eventsource).
 *
 * Se eligió una librería en vez de parsear el stream a mano porque ya
 * resuelve correctamente el framing "id:"/"data:" del protocolo SSE, algo
 * fácil de hacer mal a mano (líneas partidas entre chunks, keepalives, etc).
 *
 * La reconexión automática que trae la librería usa un intervalo fijo
 * (~3s), no el backoff exponencial que pide esta etapa. Por eso, ante
 * cualquier error, esta clase cierra la conexión de inmediato (lo que
 * neutraliza el reintento interno de la librería) y deja que
 * GameEventCollector decida cuándo reconectar.
 */
@Injectable()
export class TipminerSseClient implements SseClient {
  private eventSource?: EventSource;

  constructor(private readonly configService: ConfigService) {}

  connect(handlers: SseConnectionHandlers): void {
    this.close();

    const url = buildTipminerLiveUrl(this.readConfig());
    const eventSource = new EventSource(url, this.buildInit());

    eventSource.onopen = () => handlers.onOpen?.();
    eventSource.onmessage = (event: MessageEvent<string>) => {
      handlers.onMessage(event.data);
    };
    eventSource.onerror = (error: unknown) => {
      eventSource.close();
      handlers.onError(error);
    };

    this.eventSource = eventSource;
  }

  close(): void {
    this.eventSource?.close();
    this.eventSource = undefined;
  }

  private readConfig(): TipminerConfig {
    return {
      baseUrl: this.configService.get<string>('tipminer.baseUrl', ''),
      providerId: this.configService.get<string>('tipminer.providerId', ''),
      timezone: this.configService.get<string>('tipminer.timezone', ''),
    };
  }

  /**
   * Siempre inyecta headers de navegador real (ver tipminer-browser-headers.ts):
   * sin ellos, el SSE se identifica como un script genérico, lo que varios
   * WAF bloquean sin importar la IP de origen. Si además hay
   * TIPMINER_API_KEY definida (para cuando la API deje de ser pública, ver
   * API.MD), se suma el Authorization.
   */
  private buildInit(): EventSourceInit {
    const apiKey = this.configService.get<string>('tipminer.apiKey');

    const customFetch: FetchLike = (url, init) =>
      globalThis.fetch(url, {
        ...init,
        headers: {
          ...init.headers,
          ...TIPMINER_BROWSER_HEADERS,
          Accept: 'text/event-stream',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      });

    return { fetch: customFetch };
  }
}
