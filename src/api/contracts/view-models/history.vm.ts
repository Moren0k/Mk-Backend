/**
 * Contrato público de `GET /api/v1/history` (Mk-Api.md Anexo A):
 * `roundId` es el `uuid` de la jugada, renombrado para no acoplar el
 * contrato público al nombre interno del campo.
 */
export type HistoryVm = {
  readonly roundId: string;
  readonly winner: 'PLAYER' | 'BANKER' | 'TIE';
  readonly score: number;
  readonly playedAt: string;
};
