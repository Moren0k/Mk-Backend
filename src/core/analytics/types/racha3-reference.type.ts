import { WinnerType } from '../../enums/winner-type.enum';

/** Resultado de una operación Racha 3, en el vocabulario de Analytics. */
export type Racha3Resultado = 'DIRECTA' | 'MG1' | 'MG2' | 'LOSS';

export type Racha3Estado = 'PENDIENTE' | 'RESUELTA';

/**
 * Corrida continua observada del mismo ganador. Espejo exacto de la fila de
 * `columnas`, con los mismos nombres de concepto que el SQL para que la
 * comparación TS <-> SQL sea campo a campo y sin traducción intermedia.
 */
export type ColumnaRef = {
  readonly tipo: WinnerType;
  readonly longitud: number;
  readonly inicioJugadaId: bigint;
  readonly finJugadaId: bigint;
  readonly inicioEn: Date;
  readonly finEn: Date;
  /** Empieza por discontinuidad temporal, no por cambio de ganador. */
  readonly cortePorGap: boolean;
  /** La columna siguiente empieza por gap: puede estar truncada por la derecha. */
  readonly cerradaPorGap: boolean;
};

/** Espejo exacto de la fila de `racha3_operaciones`. */
export type OportunidadRef = {
  /** Índice de su columna dentro del arreglo devuelto. `columnas[i]`. */
  readonly columnaIndice: number;
  readonly tipoRacha: WinnerType;
  readonly apuesta: WinnerType;

  readonly jugadaInicioId: bigint;
  readonly jugadaConfirmacionId: bigint;
  readonly jugadaDirectaId: bigint | null;
  readonly jugadaMg1Id: bigint | null;
  readonly jugadaMg2Id: bigint | null;
  readonly jugadaResolucionId: bigint | null;

  readonly inicioEn: Date;
  readonly confirmacionEn: Date;
  readonly resueltaEn: Date | null;

  readonly estado: Racha3Estado;
  readonly resultadoFinal: Racha3Resultado | null;
  readonly maxMartingalas: number;

  readonly duracionMs: number | null;
  readonly jugadasEvaluadas: number;
  readonly tiesEnOperacion: number;

  readonly jugadasDesdeAnterior: number | null;
  readonly columnasDesdeAnterior: number | null;
  readonly segundosDesdeAnterior: number | null;

  readonly horaColInicio: number;
  readonly horaColConfirmacion: number;
  readonly horaColResolucion: number | null;

  readonly bloqueadaPorOperacionPrevia: boolean;
  readonly integridadOk: boolean;
};

export type Racha3Reconstruccion = {
  readonly columnas: readonly ColumnaRef[];
  readonly oportunidades: readonly OportunidadRef[];
};
