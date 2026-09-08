import { WinnerType } from '../../enums/winner-type.enum';
import { IntervaloWilson } from '../wilson';

/** Identidad de la estrategia experimental. Nunca es `streak-3`. */
export const RACHA3_TEST_ID = 'racha-3-test';
export const RACHA3_TEST_NAME = 'Racha3TestStrategy';

/**
 * Evidencia histórica que Analytics puede aportar sobre una oportunidad.
 *
 * Separada en dos bloques por una razón que no es cosmética:
 *
 *   `evidencia`  rasgos con capacidad discriminante MEDIDA sobre el
 *                histórico. Son los únicos que entran al score.
 *   `contexto`   rasgos observables que se midieron y NO discriminan el
 *                resultado (hora, día, distancia, hazard). Viajan al DEBUG
 *                con peso 0 explícito.
 *
 * La medición está en `ANALYTICS.md`; el resumen: de seis rasgos observables
 * en el instante de la confirmación, sólo `tipo_racha` supera el ruido
 * (2,67 pp, z=2,61) y apenas. Hora, día, distancia y "resultado de la
 * anterior" son planos. Darles peso sería fabricar señal.
 */
export type Racha3TestEvidencia = {
  /** Condición sobre la que se condicionó la tasa. Hoy: el tipo de racha. */
  readonly condicion: string;
  readonly tipoRacha: WinnerType;

  /** Conteos crudos de `racha3_resumen()`. `p` se calcula de acá, no de la tasa redondeada. */
  readonly aciertos: number;
  readonly resueltas: number;
  readonly directa: number;
  readonly mg1: number;
  readonly mg2: number;
  readonly perdidas: number;

  /** `muestra_n` tal como lo reporta Analytics (= `resueltas`). */
  readonly muestraN: number;
  readonly advertenciaMuestra: string | null;
  readonly muestraBloqueadasExcluidas: number;
  readonly muestraIntegridadDudosa: number;

  readonly ventanaDesde: string | null;
  readonly ventanaHasta: string | null;
};

/**
 * Rasgos observados que NO alimentan el score. Se reportan porque el
 * experimento necesita poder revisar después si alguno empieza a mostrar
 * estructura — pero hoy su peso es 0 y el DEBUG lo dice.
 */
export type Racha3TestContexto = {
  readonly horaColombia: number;
  readonly diaSemana: number;
  readonly distanciaActual: number | null;
  readonly distanciaExacta: boolean;
  readonly bucketDistancia: string | null;
  /**
   * Tasa condicionada por distancia. Responde "¿cuándo aparece la próxima
   * Racha 3?", NO "¿gana esta apuesta?". Son preguntas distintas y por eso
   * no entra al score. Se muestra para que nadie tenga que confiar en que
   * alguien las distinguió: está a la vista, con su peso en 0.
   */
  readonly hazardBucket: number | null;
  readonly frecuenciaHistoricaBucket: number | null;
  /**
   * `corte_por_gap` de la columna que produjo la oportunidad: la única
   * parte de la integridad que es observable en la confirmación.
   * `integridad_ok` completo mira la ventana de resolución, que es futuro.
   */
  readonly columnaConCortePorGap: boolean | null;
};

/** Estado del pipeline derivado en el momento de la evaluación. */
export type Racha3TestEstadoAnalytics = {
  readonly disponible: boolean;
  readonly checkpointExiste: boolean;
  readonly jugadasSinProcesar: number;
  readonly totalOportunidades: number;
  readonly error: string | null;
};

export type Racha3TestGate =
  | 'ANALYTICS_SIN_EVIDENCIA'
  | 'ANALYTICS_REZAGADO'
  | 'MUESTRA_INSUFICIENTE'
  | 'OPERACION_VIRTUAL_ABIERTA'
  | 'SCORE_BAJO_UMBRAL';

export type Racha3TestGateEvaluado = {
  readonly gate: Racha3TestGate;
  readonly disparado: boolean;
  readonly motivo: string;
};

export type Racha3TestPenalizacion = {
  readonly concepto: string;
  readonly puntos: number;
  readonly motivo: string;
};

export type Racha3TestNivel =
  'SIN_EVIDENCIA' | 'BAJO_UMBRAL' | 'EN_UMBRAL' | 'SOBRE_UMBRAL';

/**
 * Resultado del cálculo del score, con toda la cadena a la vista.
 *
 * `traza` existe para que la decisión sea verificable a mano: cada paso
 * desde los conteos hasta la decisión, con sus números. Sin eso, "score 87"
 * es un número que hay que creer.
 */
export type Racha3TestScore = {
  /** `null` cuando no hubo evidencia con la que calcular nada. */
  readonly score: number | null;
  readonly umbral: number;
  readonly nivel: Racha3TestNivel;
  readonly tomar: boolean;

  readonly componentes: {
    /** Tasa observada y sus conteos. */
    readonly historico: {
      readonly aciertos: number;
      readonly resueltas: number;
      readonly tasaObservada: number | null;
    };
    /** Muestra y el mínimo exigido. No aporta puntos: habilita o bloquea. */
    readonly muestra: {
      readonly muestraN: number;
      readonly minimoRequerido: number;
      readonly suficiente: boolean;
    };
    /** El intervalo del que sale el score. */
    readonly intervalo: IntervaloWilson | null;
    /** Rasgos con peso 0, explícito. */
    readonly contexto: Racha3TestContexto & { readonly peso: 0 };
  };

  /**
   * Penalizaciones numéricas aplicadas. Hoy siempre vacío, y es una
   * decisión con motivo: ninguna de las degradaciones candidatas tiene una
   * magnitud justificable por los datos, así que todas están modeladas como
   * gate (bloquean) o como advertencia (informan). Inventar "−5 puntos por
   * X" sería exactamente el peso artificial que este diseño evita.
   */
  readonly penalizaciones: readonly Racha3TestPenalizacion[];

  readonly gates: readonly Racha3TestGateEvaluado[];
  readonly razones: readonly string[];
  readonly advertencias: readonly string[];
  /** Cadena verificable: conteos → tasa → IC95 → score → gates → decisión. */
  readonly traza: readonly string[];
};

/** Parámetros del cálculo. Todo configurable, nada hardcodeado en la fórmula. */
export type Racha3TestParametros = {
  readonly umbralScore: number;
  readonly muestraMinima: number;
  readonly maxRezagoJugadas: number;
};

/**
 * Una evaluación completa: qué se detectó, con qué evidencia, qué se decidió
 * y por qué. Es la unidad que viaja al log estructurado y al DEBUG.
 */
export type Racha3TestEvaluacion = {
  readonly evaluacionId: string;
  readonly evaluadaEn: Date;
  readonly strategy: typeof RACHA3_TEST_ID;

  readonly triggerGameUuid: string;
  readonly triggerGameEn: Date;
  readonly tipoRacha: WinnerType;
  readonly ganadorRacha: WinnerType;
  readonly apuestaSugerida: WinnerType;
  readonly longitudRacha: number;

  readonly evidencia: Racha3TestEvidencia | null;
  readonly estadoAnalytics: Racha3TestEstadoAnalytics;
  readonly score: Racha3TestScore;
  readonly decision: 'TOMAR' | 'NO_TOMAR';
};

export type Racha3TestResultadoSimulado =
  'DIRECTA' | 'MG1' | 'MG2' | 'LOSS' | 'PENDIENTE';

/**
 * Cierre de una operación VIRTUAL. Nunca corresponde a una apuesta real:
 * `Racha 3 Test` no crea `Operation` en `OperationCoordinator` ni se
 * registra en `ActiveOperationRegistry`.
 */
export type Racha3TestResolucion = {
  readonly evaluacionId: string;
  readonly resultado: Racha3TestResultadoSimulado;
  readonly jugadasEvaluadas: number;
  readonly ties: number;
  readonly resueltaEn: Date;
  readonly apuesta: WinnerType;
  readonly tipoRacha: WinnerType;
  readonly score: number | null;
};
