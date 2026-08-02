import { WinnerType } from '../enums/winner-type.enum';

/**
 * Entidad de dominio: una jugada de BacBo ya finalizada, tal como la
 * conserva el HistoryStore. Nunca debe confundirse con GameDto
 * (infraestructura), que es la forma en la que llega desde el collector.
 */
export type Game = {
  readonly uuid: string;
  readonly winner: WinnerType;
  readonly score: number;
  readonly playedAt: Date;
};
