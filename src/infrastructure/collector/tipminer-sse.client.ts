import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventSource, EventSourceInit, FetchLike } from 'eventsource';

import { SseClient, SseConnectionHandlers } from './sse-client.interface';
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
   * La API hoy es pública (ver API.MD). Si en el futuro requiere
   * autenticación, basta con definir TIPMINER_API_KEY: este fetch
   * personalizado ya queda preparado para adjuntarla.
   */
  private buildInit(): EventSourceInit | undefined {
    const apiKey = this.configService.get<string>('tipminer.apiKey');
    if (!apiKey) {
      return undefined;
    }

    const authorizedFetch: FetchLike = (url, init) =>
      globalThis.fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${apiKey}` },
      });

    return { fetch: authorizedFetch };
  }
}
