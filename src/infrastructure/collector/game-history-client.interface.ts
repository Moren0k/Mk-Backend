import { GameDto } from './game.dto';

/**
 * Contrato para obtener el historial inicial de partidas antes de abrir el SSE.
 *
 * Igual que SseClient, existe para poder probar GameEventCollector con
 * mocks sin depender del backend real.
 */
export interface GameHistoryClient {
  fetchInitialHistory(): Promise<ReadonlyArray<GameDto>>;
}
