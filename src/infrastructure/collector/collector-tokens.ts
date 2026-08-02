/**
 * Tokens de inyección de dependencias propios de infraestructura.
 *
 * A diferencia de HISTORY_STORE (core/constants), estos tokens enlazan
 * interfaces que son puramente detalles de infraestructura (cliente SSE,
 * cliente HTTP del historial inicial): el dominio nunca los conoce.
 */
export const SSE_CLIENT = Symbol('SseClient');
export const GAME_HISTORY_CLIENT = Symbol('GameHistoryClient');
