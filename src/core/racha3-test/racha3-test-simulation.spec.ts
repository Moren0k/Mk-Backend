import { WinnerType } from '../enums/winner-type.enum';
import { Game } from '../history/game.type';
import { Racha3TestSimulacion } from './racha3-test-simulation';

const LETRA: Readonly<Record<string, WinnerType>> = {
  P: WinnerType.PLAYER,
  B: WinnerType.BANKER,
  T: WinnerType.TIE,
};

const INICIO = new Date('2026-09-01T15:00:00.000Z');

/** Jugadas a partir de un patrón legible, con cadencia real de 33 s. */
function jugadas(patron: string): Game[] {
  return patron
    .replace(/ /g, '')
    .split('')
    .map((c, i) => ({
      uuid: `game-${i}`,
      winner: LETRA[c],
      score: 0,
      playedAt: new Date(INICIO.getTime() + i * 33_000),
    }));
}

/** Simula una racha PLAYER (apuesta BANKER) sobre el patrón dado. */
function correr(patron: string) {
  const sim = new Racha3TestSimulacion(
    'eval-1',
    WinnerType.PLAYER,
    WinnerType.BANKER,
    'trigger',
    87.83,
    INICIO,
  );

  for (const game of jugadas(patron)) {
    const resolucion = sim.actualizar(game);
    if (resolucion !== undefined) return { sim, resolucion };
  }
  return { sim, resolucion: undefined };
}

describe('Racha3TestSimulacion', () => {
  describe('semántica idéntica a la operación real', () => {
    it('gana en la primera apuesta → DIRECTA', () => {
      const { resolucion } = correr('B');
      expect(resolucion?.resultado).toBe('DIRECTA');
      expect(resolucion?.jugadasEvaluadas).toBe(1);
      expect(resolucion?.ties).toBe(0);
    });

    it('pierde una y gana → MG1', () => {
      expect(correr('PB').resolucion?.resultado).toBe('MG1');
    });

    it('pierde dos y gana → MG2', () => {
      expect(correr('PPB').resolucion?.resultado).toBe('MG2');
    });

    it('pierde las tres → LOSS', () => {
      const { resolucion } = correr('PPP');
      expect(resolucion?.resultado).toBe('LOSS');
      expect(resolucion?.jugadasEvaluadas).toBe(3);
    });

    it('el TIE es neutral: no gana, no pierde, no avanza la martingala', () => {
      const { sim, resolucion } = correr('TTP');
      expect(resolucion).toBeUndefined();
      expect(sim.estaAbierta()).toBe(true);
      expect(sim.empates).toBe(2);
      expect(sim.resultadoParcial()).toBe('PENDIENTE');
    });

    it('con TIEs intercalados el resultado no cambia, solo el conteo', () => {
      const { resolucion } = correr('T P T P T B');
      expect(resolucion?.resultado).toBe('MG2');
      expect(resolucion?.ties).toBe(3);
      expect(resolucion?.jugadasEvaluadas).toBe(6);
    });

    it('los TIE no tienen tope', () => {
      const { resolucion } = correr('TTTTTTTTB');
      expect(resolucion?.resultado).toBe('DIRECTA');
      expect(resolucion?.ties).toBe(8);
    });

    it('mientras no resuelve, el resultado parcial es PENDIENTE', () => {
      const { sim } = correr('PP');
      expect(sim.estaAbierta()).toBe(true);
      expect(sim.resultadoParcial()).toBe('PENDIENTE');
    });

    it('conserva max_martingalas = 2: nunca hay MG3', () => {
      const { resolucion } = correr('PPPP');
      expect(resolucion?.resultado).toBe('LOSS');
      // Resolvió en la tercera pérdida, no en la cuarta.
      expect(resolucion?.jugadasEvaluadas).toBe(3);
    });
  });

  describe('salvaguardas', () => {
    it('ignora la jugada que disparó la señal', () => {
      const sim = new Racha3TestSimulacion(
        'eval-1',
        WinnerType.PLAYER,
        WinnerType.BANKER,
        'game-0',
        87.83,
        INICIO,
      );
      const [primera] = jugadas('B');
      expect(sim.actualizar(primera)).toBeUndefined();
      expect(sim.jugadas).toBe(0);
      expect(sim.estaAbierta()).toBe(true);
    });

    it('una vez resuelta, no vuelve a procesar jugadas', () => {
      const { sim } = correr('B');
      expect(sim.estaAbierta()).toBe(false);
      const [otra] = jugadas('P');
      expect(sim.actualizar({ ...otra, uuid: 'nueva' })).toBeUndefined();
    });
  });

  describe('aislamiento', () => {
    it('la resolución se identifica con el evaluacionId, no con un operationId real', () => {
      const { resolucion } = correr('B');
      expect(resolucion?.evaluacionId).toBe('eval-1');
      expect(resolucion?.score).toBe(87.83);
      expect(resolucion?.apuesta).toBe(WinnerType.BANKER);
      expect(resolucion?.tipoRacha).toBe(WinnerType.PLAYER);
    });

    it('una racha BANKER apuesta PLAYER', () => {
      const sim = new Racha3TestSimulacion(
        'eval-2',
        WinnerType.BANKER,
        WinnerType.PLAYER,
        'trigger',
        85.04,
        INICIO,
      );
      const resolucion = sim.actualizar(jugadas('P')[0]);
      expect(resolucion?.resultado).toBe('DIRECTA');
    });
  });
});
