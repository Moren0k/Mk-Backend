/**
 * Estados del ciclo de vida de una Operation.
 *
 * OPEN -> MG1 -> MG2 -> WON | LOST
 *
 * WON, LOST y CANCELLED son estados finales. CANCELLED queda preparado
 * para una etapa futura: nada en el motor actual lo produce todavía.
 */
export enum OperationState {
  OPEN = 'OPEN',
  MARTINGALE_ONE = 'MG1',
  MARTINGALE_TWO = 'MG2',
  WON = 'WON',
  LOST = 'LOST',
  CANCELLED = 'CANCELLED',
}
