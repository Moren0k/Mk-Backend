import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import { Racha3TestSimulacion } from '../../core/racha3-test/racha3-test-simulation';
import { Racha3TestSimulationRegistry } from './racha3-test-simulation.registry';

const INICIO = new Date('2026-09-01T15:00:00.000Z');

function game(winner: WinnerType, i = 0): Game {
  return {
    uuid: `game-${i}`,
    winner,
    score: 0,
    playedAt: new Date(INICIO.getTime() + i * 33_000),
  };
}

function simulacion(id = 'eval-1'): Racha3TestSimulacion {
  return new Racha3TestSimulacion(
    id,
    WinnerType.PLAYER,
    WinnerType.BANKER,
    'trigger',
    87.83,
    INICIO,
  );
}

describe('Racha3TestSimulationRegistry', () => {
  let registry: Racha3TestSimulationRegistry;

  beforeEach(() => {
    registry = new Racha3TestSimulationRegistry();
  });

  describe('estado inicial', () => {
    it('arranca vacío y habilitado', () => {
      expect(registry.puedeEmitir()).toBe(true);
      expect(registry.hayOperacionAbierta()).toBe(false);
      expect(registry.estadoActual()).toEqual({
        abierta: false,
        evaluacionEnCurso: false,
        evaluacionId: undefined,
        jugadasEvaluadas: 0,
      });
    });

    it('una jugada sin simulación abierta no hace nada', () => {
      expect(registry.actualizar(game(WinnerType.BANKER))).toBeUndefined();
    });
  });

  describe('reserva durante la ventana asíncrona', () => {
    it('reservar bloquea la emisión aunque no haya operación abierta', () => {
      registry.reservar();

      expect(registry.puedeEmitir()).toBe(false);
      // La distinción importa: el gate OPERACION_VIRTUAL_ABIERTA del score
      // no debe dispararse por la reserva de la propia evaluación en curso.
      expect(registry.hayOperacionAbierta()).toBe(false);
      expect(registry.estadoActual().evaluacionEnCurso).toBe(true);
    });

    it('liberarReserva devuelve la capacidad de emitir', () => {
      registry.reservar();
      registry.liberarReserva();

      expect(registry.puedeEmitir()).toBe(true);
      expect(registry.hayOperacionAbierta()).toBe(false);
    });

    it('abrir convierte la reserva en operación y la mantiene bloqueada', () => {
      registry.reservar();
      registry.abrir(simulacion());

      expect(registry.estadoActual().evaluacionEnCurso).toBe(false);
      expect(registry.hayOperacionAbierta()).toBe(true);
      expect(registry.puedeEmitir()).toBe(false);
    });

    it('liberar la reserva con una operación abierta NO la desbloquea', () => {
      // Salvaguarda: un `liberarReserva()` de más (por ejemplo, desde el
      // catch de una evaluación posterior) no puede abrir el hueco mientras
      // una simulación sigue viva.
      registry.abrir(simulacion());
      registry.liberarReserva();

      expect(registry.puedeEmitir()).toBe(false);
      expect(registry.hayOperacionAbierta()).toBe(true);
    });
  });

  describe('ciclo de la operación virtual', () => {
    it('reporta el progreso mientras la simulación avanza', () => {
      registry.abrir(simulacion('eval-progreso'));

      expect(registry.actualizar(game(WinnerType.PLAYER, 1))).toBeUndefined();
      expect(registry.estadoActual()).toEqual({
        abierta: true,
        evaluacionEnCurso: false,
        evaluacionId: 'eval-progreso',
        jugadasEvaluadas: 1,
      });
    });

    it('al resolverse devuelve la resolución, se descarta y libera el hueco', () => {
      registry.abrir(simulacion('eval-cierre'));

      const resolucion = registry.actualizar(game(WinnerType.BANKER, 1));

      expect(resolucion?.evaluacionId).toBe('eval-cierre');
      expect(resolucion?.resultado).toBe('DIRECTA');
      expect(registry.hayOperacionAbierta()).toBe(false);
      expect(registry.puedeEmitir()).toBe(true);
      expect(registry.estadoActual().evaluacionId).toBeUndefined();
    });

    it('no devuelve la resolución dos veces', () => {
      registry.abrir(simulacion());
      expect(registry.actualizar(game(WinnerType.BANKER, 1))).toBeDefined();
      expect(registry.actualizar(game(WinnerType.BANKER, 2))).toBeUndefined();
    });

    it('el TIE no resuelve ni libera el hueco', () => {
      registry.abrir(simulacion());

      expect(registry.actualizar(game(WinnerType.TIE, 1))).toBeUndefined();
      expect(registry.hayOperacionAbierta()).toBe(true);
      expect(registry.puedeEmitir()).toBe(false);
    });

    it('tras cerrar una simulación acepta la siguiente', () => {
      registry.abrir(simulacion('primera'));
      registry.actualizar(game(WinnerType.BANKER, 1));

      registry.reservar();
      registry.abrir(simulacion('segunda'));

      expect(registry.estadoActual().evaluacionId).toBe('segunda');
    });
  });
});
