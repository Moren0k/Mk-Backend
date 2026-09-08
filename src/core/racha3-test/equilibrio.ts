/**
 * Punto de equilibrio de una operación con martingala.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE ARCHIVO EXISTE
 *
 * El umbral original de Racha 3 Test era el límite inferior del IC95 del
 * histórico GLOBAL (86,87), y el score el del subgrupo. Comparar los dos es
 * incoherente: el subgrupo es parte del grupo, así que se compara el dato
 * contra sí mismo. Y como hay exactamente dos categorías (racha PLAYER,
 * racha BANKER), una está siempre por encima del promedio y la otra siempre
 * por debajo — por aritmética, no por evidencia. El filtro no filtraba: era
 * una tautología que siempre tomaba un lado y siempre rechazaba el otro.
 *
 * El defecto de fondo es peor: ese umbral NUNCA puede decir "no tomes
 * nada". Si la estrategia no tuviera ventaja alguna, seguiría tomando la
 * mitad de las oportunidades para siempre, las del lado que salió con más
 * suerte.
 *
 * ─────────────────────────────────────────────────────────────────────
 * QUÉ ES EL UMBRAL, ENTONCES
 *
 * La tasa de acierto por debajo de la cual la operación PIERDE dinero. No
 * depende del historial de aciertos: depende sólo de cuánto se cobra al
 * ganar, cuánto se paga al fallar y cuánto cuesta un empate.
 *
 *   gana  → +1 unidad, en cualquier nivel de la escalera
 *   falla → −(1+2+4) = −7 unidades
 *   TIE   → devuelve el 90 %: cuesta el 10 % de lo apostado en ese nivel.
 *           No consume gale y no cierra la operación, pero cobra peaje.
 *
 *   EV = p·ganancia − (1−p)·pérdida − peaje = 0
 *   ⟹  umbral = (pérdida + peaje) / (pérdida + ganancia)
 *
 * Con la escalera 1-2-4 y sin contar el TIE serían 7/8 = 87,500 %. Con el
 * peaje medido sobre el histórico (0,0386 unidades por operación) el
 * equilibrio real es 87,983 %.
 *
 * Ese medio punto decide el proyecto: la tasa global observada es 87,980 %,
 * tres milésimas POR DEBAJO del equilibrio, y las unidades netas reales del
 * histórico completo son −0,9 en vez de las +162 que se reportan ignorando
 * el peaje.
 *
 * ─────────────────────────────────────────────────────────────────────
 * DINÁMICO, PERO POR EL LADO DEL COSTE
 *
 * El umbral se recalcula con los datos, sí, pero con los datos de COSTE
 * (cuántos TIE hubo y en qué nivel cayeron), nunca con los de acierto. Es
 * la distinción que hace que la comparación signifique algo:
 *
 *   score   → sale del historial de aciertos. Cambia con cada dato nuevo.
 *   umbral  → sale de la estructura de pago. Cambia si cambia la escalera,
 *             el pago o la frecuencia de empates.
 *
 * Si el umbral saliera de los aciertos, volveríamos a comparar los datos
 * contra sí mismos.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ AÑADIR GALES NO AYUDA
 *
 * `EV por operación = ventaja_por_unidad × importe_esperado_total`. La
 * ventaja por unidad no depende de la escalera; la escalera sólo cambia
 * cuánto se apuesta. Si la ventaja por unidad es negativa, apostar más
 * pierde más. Medido sobre el histórico, para 0..4 gales el EV por
 * operación es −0,0024, −0,0048, −0,0071, −0,0094 y −0,0117: la tasa
 * esperada queda siempre un pelo por debajo del equilibrio, en todas las
 * profundidades. `ventajaPorUnidad()` calcula ese número.
 */

/** Importe apostado en cada nivel. Progresión por defecto: 1, 2, 4. */
export type EscaleraApuesta = readonly number[];

export const ESCALERA_1_2_4: EscaleraApuesta = Object.freeze([1, 2, 4]);

export type ParametrosEconomicos = {
  /** Importe por nivel. Su longitud es el número de intentos. */
  readonly escalera: EscaleraApuesta;
  /** Fracción del importe que devuelve un empate: 0,90 = devuelve el 90 %. */
  readonly devolucionTie: number;
  /** Ganancia neta de un acierto, en unidades. 1 = pago 1:1. */
  readonly pagoAcierto: number;
};

/** TIEs observados en un nivel de la escalera. */
export type TiesEnNivel = {
  readonly nivel: number;
  readonly ties: number;
};

export type Equilibrio = {
  /** Importe total en riesgo si se falla toda la escalera (1+2+4 = 7). */
  readonly perdidaPorFallo: number;
  readonly gananciaPorAcierto: number;
  /** Coste medio de los empates, en unidades por operación. */
  readonly peajeTiePorOperacion: number;
  /** Desglose del peaje por nivel, para poder auditarlo. */
  readonly peajePorNivel: readonly {
    nivel: number;
    ties: number;
    coste: number;
  }[];
  /** Equilibrio ignorando los empates: `perdida / (perdida + ganancia)`. */
  readonly umbralSinTie: number;
  /** El que decide, como fracción de [0,1]. */
  readonly umbral: number;
  readonly operaciones: number;
  readonly traza: readonly string[];
};

/**
 * Coste de un empate en un nivel, en unidades.
 *
 * Un empate en el nivel `i` no pierde el importe: devuelve
 * `devolucionTie × importe`, así que cuesta la fracción restante. Es la
 * corrección que faltaba — el sistema lo trataba como gratis.
 */
function costeTie(importe: number, devolucionTie: number): number {
  return importe * (1 - devolucionTie);
}

/**
 * Calcula el punto de equilibrio a partir de los empates MEDIDOS.
 *
 * Se usan conteos observados en vez de un modelo (`t/(1−t)` por nivel)
 * porque están disponibles y no exigen suponer independencia. Si algún
 * nivel no tiene datos, su peaje es 0 y la traza lo dice: no se inventa.
 */
export function calcularEquilibrio(
  parametros: ParametrosEconomicos,
  tiesPorNivel: readonly TiesEnNivel[],
  operaciones: number,
): Equilibrio {
  const { escalera, devolucionTie, pagoAcierto } = parametros;

  const perdidaPorFallo = escalera.reduce((a, b) => a + b, 0);

  const peajePorNivel = escalera.map((importe, nivel) => {
    const ties = tiesPorNivel.find((t) => t.nivel === nivel)?.ties ?? 0;
    return { nivel, ties, coste: ties * costeTie(importe, devolucionTie) };
  });

  const costeTotal = peajePorNivel.reduce((a, n) => a + n.coste, 0);
  const peajeTiePorOperacion = operaciones > 0 ? costeTotal / operaciones : 0;

  const umbralSinTie = perdidaPorFallo / (perdidaPorFallo + pagoAcierto);
  const umbral =
    (perdidaPorFallo + peajeTiePorOperacion) / (perdidaPorFallo + pagoAcierto);

  const traza: string[] = [
    `escalera = [${escalera.join(', ')}] → pérdida por fallo = ${perdidaPorFallo}, ` +
      `ganancia por acierto = ${pagoAcierto}`,
    `equilibrio sin contar empates = ${perdidaPorFallo}/${perdidaPorFallo + pagoAcierto} = ` +
      `${(100 * umbralSinTie).toFixed(3)}%`,
  ];

  if (operaciones > 0) {
    for (const n of peajePorNivel) {
      traza.push(
        `  nivel ${n.nivel}: ${n.ties} empates × ${escalera[n.nivel]} × ` +
          `(1 − ${devolucionTie}) = ${n.coste.toFixed(2)} unidades`,
      );
    }
    traza.push(
      `peaje de empates = ${costeTotal.toFixed(2)} / ${operaciones} operaciones = ` +
        `${peajeTiePorOperacion.toFixed(5)} unidades por operación`,
    );
    traza.push(
      `umbral = (${perdidaPorFallo} + ${peajeTiePorOperacion.toFixed(5)}) / ` +
        `${perdidaPorFallo + pagoAcierto} = ${(100 * umbral).toFixed(3)}%`,
    );
  } else {
    traza.push(
      'sin operaciones medidas: el peaje de empates es 0 y el umbral cae al ' +
        'equilibrio sin empates. Es el valor MENOS exigente, así que se ' +
        'reporta como advertencia.',
    );
  }

  return {
    perdidaPorFallo,
    gananciaPorAcierto: pagoAcierto,
    peajeTiePorOperacion,
    peajePorNivel,
    umbralSinTie,
    umbral,
    operaciones,
    traza,
  };
}

/**
 * Expectativa por operación, en unidades, dada una tasa de acierto.
 *
 * `tasa × ganancia − (1 − tasa) × pérdida − peaje`. Es el número que decide
 * si merece la pena apostar; el umbral es exactamente la tasa que lo hace 0.
 */
export function evPorOperacion(tasa: number, equilibrio: Equilibrio): number {
  return (
    tasa * equilibrio.gananciaPorAcierto -
    (1 - tasa) * equilibrio.perdidaPorFallo -
    equilibrio.peajeTiePorOperacion
  );
}

/**
 * Ventaja por unidad apostada, el número que ninguna progresión cambia.
 *
 * `P(gana) − P(pierde) − P(empate) × coste_del_empate`, todo por unidad.
 * Sobre el histórico: apostar BANKER da −0,00212 (la ventaja del lado,
 * +0,94 %, no cubre el peaje del empate, −1,15 %); apostar PLAYER da
 * −0,02094. Como el EV por operación es esta cantidad multiplicada por el
 * importe esperado total, un valor negativo no se arregla con ninguna
 * escalera: sólo se agranda.
 */
export function ventajaPorUnidad(entrada: {
  readonly gana: number;
  readonly pierde: number;
  readonly empata: number;
  readonly devolucionTie: number;
}): number {
  const { gana, pierde, empata, devolucionTie } = entrada;
  const total = gana + pierde + empata;
  if (total <= 0) return 0;

  return gana / total - pierde / total - (empata / total) * (1 - devolucionTie);
}

/**
 * Tasa de acierto de la escalera completa si cada intento gana con
 * probabilidad `omega` de forma independiente: `1 − (1−omega)^intentos`.
 *
 * Es monótona creciente en `omega`, y de eso se aprovecha la estimación por
 * modelo: transformar los extremos de un intervalo de confianza de `omega`
 * da directamente el intervalo de la tasa, sin aproximaciones (nada de
 * método delta).
 *
 * `omega` es la probabilidad CONDICIONADA a que la ronda no sea empate: un
 * empate no consume intento, así que no cambia quién gana la escalera, solo
 * cuánto cuesta llegar.
 */
export function tasaDeEscalera(omega: number, intentos: number): number {
  const acotada = Math.min(1, Math.max(0, omega));
  return 1 - Math.pow(1 - acotada, intentos);
}
