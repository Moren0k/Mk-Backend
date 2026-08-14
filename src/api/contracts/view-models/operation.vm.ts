/**
 * Contrato público de operaciones (Mk-Api.md Anexo A, confirmado también
 * en Anexo D §10 como el payload completo de los eventos de operación por
 * SSE en F5 — mismo shape en ambos casos, nunca un diff parcial).
 *
 * `reason` expone el patrón detectado (p. ej. "Racha de 4 PLAYER
 * consecutivos.") para que el frontend pueda mostrarlo junto a
 * `streakWinner`/`recommendedWinner` sin adivinarlo.
 */
export type OperationVm = {
  readonly operationId: string;
  readonly strategyId: string;
  readonly recommendedWinner: 'PLAYER' | 'BANKER' | 'TIE';
  readonly streakWinner: 'PLAYER' | 'BANKER' | 'TIE';
  readonly currentState: 'OPEN' | 'MG1' | 'MG2' | 'WON' | 'LOST' | 'CANCELLED';
  readonly currentMartingale: number;
  readonly reason: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
};
