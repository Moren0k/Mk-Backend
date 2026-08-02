export type SseConnectionHandlers = {
  readonly onOpen?: () => void;
  readonly onMessage: (data: string) => void;
  readonly onError: (error: unknown) => void;
};

/**
 * Contrato mínimo para una conexión SSE en vivo.
 *
 * Existe para que GameEventCollector nunca dependa directamente de la
 * librería SSE concreta (ver TipminerSseClient), lo que permite probarlo
 * con mocks sin depender del backend real.
 */
export interface SseClient {
  connect(handlers: SseConnectionHandlers): void;
  close(): void;
}
