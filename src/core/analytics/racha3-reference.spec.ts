import { WinnerType } from '../enums/winner-type.enum';
import {
  construirColumnas,
  horaColombia,
  reconstruirRacha3,
  UMBRAL_GAP_MS_DEFECTO,
} from './racha3-reference';
import { AnalyticsGame } from './types/analytics-game.type';

/**
 * Casos manuales conocidos de Racha 3, escritos como cadenas legibles.
 *
 * Notación: `P` = PLAYER, `B` = BANKER, `T` = TIE, `|` = discontinuidad
 * temporal mayor al umbral (un hueco en el historial). Los espacios se
 * ignoran, para poder escribir `P P P T B` tal como aparece en la
 * especificación.
 *
 * Cadencia normal entre jugadas: 33 s (la real medida de la mesa está entre
 * 29,6 s y 40 s). Un `|` inserta 10 minutos, muy por encima de los 120 s
 * del umbral.
 */
const CADENCIA_MS = 33_000;
const HUECO_MS = 600_000;
const INICIO = new Date('2026-09-01T15:00:00.000Z'); // 10:00 en America/Bogota

const LETRA: Readonly<Record<string, WinnerType>> = {
  P: WinnerType.PLAYER,
  B: WinnerType.BANKER,
  T: WinnerType.TIE,
};

function jugadas(patron: string): AnalyticsGame[] {
  const salida: AnalyticsGame[] = [];
  let t = INICIO.getTime();
  let id = 1n;
  let saltar = false;

  for (const c of patron) {
    if (c === ' ') continue;
    if (c === '|') {
      saltar = true;
      continue;
    }
    const winner = LETRA[c];
    if (!winner) throw new Error(`Letra desconocida en el patrón: "${c}"`);

    if (salida.length > 0) t += saltar ? HUECO_MS : CADENCIA_MS;
    saltar = false;

    salida.push({
      id,
      uuid: `00000000-0000-4000-8000-${id.toString().padStart(12, '0')}`,
      winner,
      playedAt: new Date(t),
    });
    // Los ids saltan de a 2 a propósito: `jugadas.id` NO es contiguo en la
    // base real (579 valores consumidos sin fila). Nada de este código puede
    // depender de que lo sea.
    id += 2n;
  }
  return salida;
}

/** Forma compacta de una columna, para asertar de un vistazo. */
const forma = (patron: string) =>
  construirColumnas(jugadas(patron)).columnas.map(
    (c) => `${c.tipo}:${c.longitud}`,
  );

const reconstruir = (patron: string) => reconstruirRacha3(jugadas(patron));

describe('racha3-reference: columnas', () => {
  it('separa PLAYER, BANKER y TIE como tipos de columna independientes', () => {
    expect(forma('P P P T B')).toEqual(['PLAYER:3', 'TIE:1', 'BANKER:1']);
  });

  it('un TIE rompe la columna de PLAYER en dos', () => {
    expect(forma('P T P')).toEqual(['PLAYER:1', 'TIE:1', 'PLAYER:1']);
  });

  it('agrupa TIEs consecutivos en una sola columna TIE', () => {
    expect(forma('P P P T T T T B')).toEqual(['PLAYER:3', 'TIE:4', 'BANKER:1']);
  });

  it('la suma de longitudes cubre exactamente el historial (invariante V1)', () => {
    const js = jugadas('P P B T T P B B B P');
    const { columnas } = construirColumnas(js);
    expect(columnas.reduce((n, c) => n + c.longitud, 0)).toBe(js.length);
  });

  it('corta la columna ante un hueco y NO la fusiona a través de él', () => {
    const { columnas } = construirColumnas(jugadas('P P P | P P P'));
    expect(columnas.map((c) => `${c.tipo}:${c.longitud}`)).toEqual([
      'PLAYER:3',
      'PLAYER:3',
    ]);
    // Dos columnas adyacentes del mismo tipo: válido si y solo si la
    // segunda empieza por gap.
    expect(columnas[0].cortePorGap).toBe(false);
    expect(columnas[1].cortePorGap).toBe(true);
    // Y la primera queda marcada como truncada por la derecha.
    expect(columnas[0].cerradaPorGap).toBe(true);
    expect(columnas[1].cerradaPorGap).toBe(false);
  });

  it('un hueco por debajo del umbral no corta nada', () => {
    const js = jugadas('P P P');
    js[2] = {
      ...js[2],
      playedAt: new Date(js[1].playedAt.getTime() + UMBRAL_GAP_MS_DEFECTO - 1),
    };
    expect(construirColumnas(js).columnas).toHaveLength(1);
  });
});

describe('racha3-reference: deteccion de la oportunidad', () => {
  it('B P P P produce UNA Racha 3 PLAYER: inicia en el primer P, confirma en el tercero', () => {
    const js = jugadas('B P P P');
    const { oportunidades } = reconstruirRacha3(js);

    expect(oportunidades).toHaveLength(1);
    expect(oportunidades[0].tipoRacha).toBe(WinnerType.PLAYER);
    expect(oportunidades[0].jugadaInicioId).toBe(js[1].id);
    expect(oportunidades[0].jugadaConfirmacionId).toBe(js[3].id);
  });

  it('una corrida larga sigue siendo UNA sola oportunidad, no una por jugada', () => {
    expect(reconstruir('B P P P P P P B').oportunidades).toHaveLength(1);
  });

  it('un TIE durante la formacion impide la Racha 3', () => {
    expect(reconstruir('B P P T P').oportunidades).toHaveLength(0);
  });

  it('si la racha es PLAYER la apuesta es BANKER, y viceversa', () => {
    expect(reconstruir('P P P').oportunidades[0].apuesta).toBe(
      WinnerType.BANKER,
    );
    expect(reconstruir('B B B').oportunidades[0].apuesta).toBe(
      WinnerType.PLAYER,
    );
  });

  it('una columna TIE nunca genera oportunidad, por larga que sea', () => {
    expect(reconstruir('T T T T T').oportunidades).toHaveLength(0);
  });
});

describe('racha3-reference: resultado de la operacion', () => {
  const resultado = (patron: string) => reconstruir(patron).oportunidades[0];

  it('gana en la apuesta inmediata -> DIRECTA', () => {
    const o = resultado('P P P B');
    expect(o.resultadoFinal).toBe('DIRECTA');
    expect(o.jugadaMg1Id).toBeNull();
  });

  it('pierde una y gana -> MG1', () => {
    expect(resultado('P P P P B').resultadoFinal).toBe('MG1');
  });

  it('pierde dos y gana -> MG2', () => {
    expect(resultado('P P P P P B').resultadoFinal).toBe('MG2');
  });

  it('pierde las tres -> LOSS', () => {
    const o = resultado('P P P P P P');
    expect(o.resultadoFinal).toBe('LOSS');
    expect(o.jugadaMg2Id).not.toBeNull();
  });

  it('sin jugadas posteriores la operacion queda PENDIENTE', () => {
    const o = resultado('P P P');
    expect(o.estado).toBe('PENDIENTE');
    expect(o.resultadoFinal).toBeNull();
    expect(o.jugadasEvaluadas).toBe(0);
  });

  it('un TIE es neutral: no gana, no pierde y no avanza la martingala', () => {
    // PPP -> apuesta BANKER. El TIE repite la apuesta; el P siguiente
    // recién ahí pierde la directa y pasa a MG1.
    const o = resultado('P P P T P');
    expect(o.estado).toBe('PENDIENTE');
    expect(o.tiesEnOperacion).toBe(1);
    expect(o.jugadasEvaluadas).toBe(2);
    expect(o.jugadaDirectaId).not.toBeNull();
    expect(o.jugadaMg1Id).toBeNull();
  });

  it('con TIE intercalado: P P P T P P P termina en LOSS', () => {
    const o = resultado('P P P T P P P');
    expect(o.resultadoFinal).toBe('LOSS');
    expect(o.tiesEnOperacion).toBe(1);
    expect(o.jugadasEvaluadas).toBe(4);
  });

  it('los TIE no tienen tope: cuatro seguidos siguen siendo neutrales', () => {
    const o = resultado('P P P T T T T B');
    expect(o.resultadoFinal).toBe('DIRECTA');
    expect(o.tiesEnOperacion).toBe(4);
    expect(o.jugadasEvaluadas).toBe(5);
  });

  it('la escalera apunta a las jugadas PLAYER/BANKER, nunca a los TIE', () => {
    const js = jugadas('P P P T P T P T B');
    const o = reconstruirRacha3(js).oportunidades[0];
    expect(o.jugadaDirectaId).toBe(js[4].id);
    expect(o.jugadaMg1Id).toBe(js[6].id);
    expect(o.jugadaMg2Id).toBe(js[8].id);
    expect(o.jugadaResolucionId).toBe(js[8].id);
    expect(o.resultadoFinal).toBe('MG2');
    expect(o.tiesEnOperacion).toBe(3);
  });
});

describe('racha3-reference: derivados', () => {
  it('marca bloqueada la oportunidad que confirma sobre una operacion abierta', () => {
    // La columna PLAYER que nace tras el TIE alcanza longitud 3 en la MISMA
    // jugada que lleva la operacion previa a LOSS. El motor real no habria
    // podido alertar ahi.
    const { oportunidades } = reconstruir('P P P T P P P');
    expect(oportunidades).toHaveLength(2);
    expect(oportunidades[0].resultadoFinal).toBe('LOSS');
    expect(oportunidades[0].bloqueadaPorOperacionPrevia).toBe(false);
    expect(oportunidades[1].bloqueadaPorOperacionPrevia).toBe(true);
    expect(oportunidades[1].jugadaConfirmacionId).toBe(
      oportunidades[0].jugadaResolucionId,
    );
  });

  it('no marca bloqueada cuando la anterior ya habia resuelto', () => {
    const { oportunidades } = reconstruir('P P P B B B');
    expect(oportunidades).toHaveLength(2);
    expect(oportunidades[0].resultadoFinal).toBe('DIRECTA');
    expect(oportunidades[1].bloqueadaPorOperacionPrevia).toBe(false);
  });

  it('invalida la integridad de una oportunidad que nace despues de un hueco', () => {
    // La segunda columna empieza por gap: su "tercera jugada" puede no ser
    // la tercera real de la corrida. La PRIMERA tambien queda invalidada,
    // pero por otro motivo: su operacion se resuelve con las jugadas
    // posteriores al hueco, asi que su ventana lo cruza.
    const { oportunidades } = reconstruir('P P P | P P P');
    expect(oportunidades).toHaveLength(2);
    expect(oportunidades[0].resultadoFinal).toBe('LOSS');
    expect(oportunidades[0].integridadOk).toBe(false);
    expect(oportunidades[1].integridadOk).toBe(false);
  });

  it('conserva la integridad si la operacion resuelve ANTES del hueco', () => {
    const { oportunidades } = reconstruir('P P P B | P P P');
    expect(oportunidades).toHaveLength(2);
    // Resuelve en la B, previa al hueco: su ventana no lo toca.
    expect(oportunidades[0].resultadoFinal).toBe('DIRECTA');
    expect(oportunidades[0].integridadOk).toBe(true);
    // La segunda nace del otro lado del hueco.
    expect(oportunidades[1].integridadOk).toBe(false);
  });

  it('invalida la integridad si el hueco cae dentro de la ventana de la operacion', () => {
    const o = reconstruir('B B B | P').oportunidades[0];
    expect(o.resultadoFinal).toBe('DIRECTA');
    expect(o.integridadOk).toBe(false);
  });

  it('mide las distancias contra la Racha 3 anterior, y deja NULL la primera', () => {
    const { oportunidades } = reconstruir('P P P B B B');
    expect(oportunidades[0].jugadasDesdeAnterior).toBeNull();
    expect(oportunidades[0].columnasDesdeAnterior).toBeNull();
    expect(oportunidades[0].segundosDesdeAnterior).toBeNull();

    // Confirmaciones en los indices 2 y 5: tres jugadas de distancia, una
    // columna de distancia, y 3 x 33 s.
    expect(oportunidades[1].jugadasDesdeAnterior).toBe(3);
    expect(oportunidades[1].columnasDesdeAnterior).toBe(1);
    expect(oportunidades[1].segundosDesdeAnterior).toBe(99);
  });

  it('duracion y jugadas evaluadas son coherentes con la resolucion', () => {
    const o = reconstruir('P P P T B').oportunidades[0];
    expect(o.jugadasEvaluadas).toBe(2);
    expect(o.tiesEnOperacion).toBe(1);
    expect(o.duracionMs).toBe(2 * CADENCIA_MS);
  });
});

describe('racha3-reference: hora Colombia', () => {
  it('deriva la hora con el nombre de zona, no con aritmetica de offsets', () => {
    // 15:00Z = 10:00 en Bogota (UTC-5, sin horario de verano).
    expect(horaColombia(new Date('2026-09-01T15:00:00Z'))).toBe(10);
    // Cruce de dia: 03:00Z del dia 2 = 22:00 del dia 1 en Bogota.
    expect(horaColombia(new Date('2026-09-02T03:00:00Z'))).toBe(22);
    expect(horaColombia(new Date('2026-09-02T04:59:59Z'))).toBe(23);
    expect(horaColombia(new Date('2026-09-02T05:00:00Z'))).toBe(0);
  });

  it('Colombia no aplica horario de verano: el offset es fijo todo el año', () => {
    expect(horaColombia(new Date('2026-01-15T15:00:00Z'))).toBe(10);
    expect(horaColombia(new Date('2026-07-15T15:00:00Z'))).toBe(10);
  });

  it('las horas de la oportunidad salen de sus propios timestamps', () => {
    const o = reconstruir('P P P B').oportunidades[0];
    expect(o.horaColInicio).toBe(10);
    expect(o.horaColConfirmacion).toBe(10);
    expect(o.horaColResolucion).toBe(10);
  });
});
