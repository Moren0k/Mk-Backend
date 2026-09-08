import { Injectable } from '@nestjs/common';

import { Game } from '../../core/history/game.type';
import { Racha3TestSimulacion } from '../../core/racha3-test/racha3-test-simulation';
import { Racha3TestResolucion } from '../../core/racha3-test/types/racha3-test.type';

/**
 * Registro de las operaciones VIRTUALES de Racha 3 Test.
 *
 * Completamente aislado de `ActiveOperationRegistry`: no lo extiende, no lo
 * inyecta y no comparte estado con él. Las operaciones reales de `streak-3`
 * y `streak-4` viven allá y nunca aparecen acá, ni al revés. Es la razón por
 * la que existe esta clase en vez de reutilizar el registro real: compartirlo
 * habría hecho que una simulación bloquee una alerta de producción.
 *
 * Modela también la ventana asíncrona: entre que se detecta una señal y que
 * termina la consulta a Analytics pasan cientos de milisegundos, y en ese
 * intervalo el hueco tiene que estar reservado. Sin la reserva, dos señales
 * seguidas podrían abrir dos simulaciones simultáneas, algo que el motor
 * real nunca haría.
 */
@Injectable()
export class Racha3TestSimulationRegistry {
  private simulacion: Racha3TestSimulacion | undefined;
  /** Reserva sincrónica mientras corre la evaluación asíncrona. */
  private evaluacionEnCurso = false;

  /**
   * ¿Puede Racha 3 Test emitir una señal ahora?
   *
   * Réplica del criterio de `ActiveOperationRegistry.canExecute`, aplicado a
   * la simulación propia: nunca dos operaciones virtuales a la vez.
   */
  puedeEmitir(): boolean {
    return !this.evaluacionEnCurso && this.simulacion?.estaAbierta() !== true;
  }

  hayOperacionAbierta(): boolean {
    return this.simulacion?.estaAbierta() === true;
  }

  /** Reserva el hueco antes de lanzar la evaluación asíncrona. */
  reservar(): void {
    this.evaluacionEnCurso = true;
  }

  /** Libera la reserva cuando la evaluación terminó sin abrir simulación. */
  liberarReserva(): void {
    this.evaluacionEnCurso = false;
  }

  /** Convierte la reserva en una operación virtual abierta. */
  abrir(simulacion: Racha3TestSimulacion): void {
    this.simulacion = simulacion;
    this.evaluacionEnCurso = false;
  }

  /**
   * Aplica una jugada a la simulación abierta, si hay alguna. Devuelve la
   * resolución cuando la operación virtual termina con esta jugada.
   */
  actualizar(game: Game): Racha3TestResolucion | undefined {
    if (this.simulacion === undefined || !this.simulacion.estaAbierta()) {
      return undefined;
    }

    const resolucion = this.simulacion.actualizar(game);

    if (resolucion !== undefined) {
      this.simulacion = undefined;
    }

    return resolucion;
  }

  /** Sólo para observabilidad y tests. */
  estadoActual(): {
    readonly abierta: boolean;
    readonly evaluacionEnCurso: boolean;
    readonly evaluacionId: string | undefined;
    readonly jugadasEvaluadas: number;
  } {
    return {
      abierta: this.hayOperacionAbierta(),
      evaluacionEnCurso: this.evaluacionEnCurso,
      evaluacionId: this.simulacion?.evaluacionId,
      jugadasEvaluadas: this.simulacion?.jugadas ?? 0,
    };
  }
}
