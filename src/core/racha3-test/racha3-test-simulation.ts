import { OperationState } from '../enums/operation-state.enum';
import { WinnerType } from '../enums/winner-type.enum';
import { Game } from '../history/game.type';
import { Operation } from '../operation/operation.entity';
import {
  Racha3TestResolucion,
  Racha3TestResultadoSimulado,
  RACHA3_TEST_ID,
  RACHA3_TEST_NAME,
} from './types/racha3-test.type';

/** Techo de martingalas de la simulación. Mismo valor que la estrategia real. */
export const RACHA3_TEST_MAX_MARTINGALAS = 2;

/**
 * Operación VIRTUAL de Racha 3 Test.
 *
 * Nunca es una apuesta. No se registra en `ActiveOperationRegistry`, no pasa
 * por `OperationCoordinator`, no publica ningún evento de dominio y no
 * dispara ninguna notificación de las estrategias reales. Su único efecto es
 * que, cuando se resuelve, el DEBUG puede informar cómo habría terminado.
 *
 * La máquina de estados NO se reimplementa: se conduce la clase `Operation`
 * REAL del motor. Es la misma decisión de diseño que tomó la implementación
 * de referencia de Analytics, y por el mismo motivo: si alguien cambia la
 * regla de martingala o la neutralidad del TIE, la simulación cambia con
 * ella en vez de quedar describiendo un motor que ya no existe.
 *
 * `Operation.open()` exige un `StrategyTrigger`, así que se construye uno
 * con `strategyId = 'racha-3-test'`. Ese trigger se pasa directo al
 * constructor — NUNCA se publica como `StrategyTriggeredEvent`, que es lo
 * que crearía una operación real.
 */
export class Racha3TestSimulacion {
  private readonly operacion: Operation;
  private jugadasEvaluadas = 0;
  private ties = 0;

  constructor(
    readonly evaluacionId: string,
    readonly tipoRacha: WinnerType,
    readonly apuesta: WinnerType,
    readonly triggerGameUuid: string,
    readonly score: number | null,
    readonly abiertaEn: Date,
    maxMartingalas: number = RACHA3_TEST_MAX_MARTINGALAS,
  ) {
    this.operacion = Operation.open({
      triggered: true,
      strategyId: RACHA3_TEST_ID,
      strategyName: RACHA3_TEST_NAME,
      triggeredAt: abiertaEn,
      recommendedWinner: apuesta,
      streakWinner: tipoRacha,
      maxMartingales: maxMartingalas,
      triggerGameUuid,
      reason: 'Operación virtual de Racha 3 Test (no es una apuesta real).',
      metadata: { experimental: true },
      // El contexto de negocio no aplica: esta operación no pertenece a
      // ningún canal real. Se fija 'pruebas' porque el tipo lo exige y es
      // el valor que no puede confundirse con producción.
      context: 'pruebas',
    });
  }

  /**
   * Procesa una jugada. Devuelve la resolución si la operación virtual
   * terminó con esta jugada, o `undefined` si sigue abierta.
   *
   * El TIE es neutral por la propia `Operation`: no consume martingala, no
   * cambia de estado y no cierra. Acá sólo se cuenta para el DEBUG.
   */
  actualizar(game: Game): Racha3TestResolucion | undefined {
    if (this.operacion.isFinished()) {
      return undefined;
    }
    // Misma salvaguarda que la operación real: la jugada que disparó la
    // señal no se evalúa como actualización.
    if (game.uuid === this.triggerGameUuid) {
      return undefined;
    }

    this.jugadasEvaluadas += 1;
    const resultado = this.operacion.update(game);

    if (resultado.tieOccurred) {
      this.ties += 1;
      return undefined;
    }
    if (!resultado.completed) {
      return undefined;
    }

    return {
      evaluacionId: this.evaluacionId,
      resultado: this.resultadoFinal(),
      jugadasEvaluadas: this.jugadasEvaluadas,
      ties: this.ties,
      resueltaEn: game.playedAt,
      apuesta: this.apuesta,
      tipoRacha: this.tipoRacha,
      score: this.score,
    };
  }

  estaAbierta(): boolean {
    return !this.operacion.isFinished();
  }

  /** Estado en curso, para el DEBUG de una operación todavía sin resolver. */
  resultadoParcial(): Racha3TestResultadoSimulado {
    return this.operacion.isFinished() ? this.resultadoFinal() : 'PENDIENTE';
  }

  get jugadas(): number {
    return this.jugadasEvaluadas;
  }

  get empates(): number {
    return this.ties;
  }

  /**
   * Traducción del vocabulario del motor al de Analytics. El motor no tiene
   * el concepto "DIRECTA": es `WON` con `currentMartingale = 0`.
   */
  private resultadoFinal(): Racha3TestResultadoSimulado {
    if (this.operacion.currentState === OperationState.LOST) {
      return 'LOSS';
    }
    if (this.operacion.currentState === OperationState.WON) {
      const nivel = this.operacion.currentMartingale;
      if (nivel === 0) return 'DIRECTA';
      if (nivel === 1) return 'MG1';
      return 'MG2';
    }
    return 'PENDIENTE';
  }
}
