/**
 * Intervalo de confianza de Wilson para una proporción.
 *
 * Es el corazón del score de Racha 3 Test, así que conviene decir por qué
 * este intervalo y no otro.
 *
 * El score responde "¿qué tan respaldada está esta oportunidad por la
 * evidencia histórica?", y la respuesta honesta tiene que castigar por sí
 * sola a una tasa alta con muestra chica. El límite inferior de un intervalo
 * de confianza hace exactamente eso: 9 aciertos de 10 y 900 de 1.000 son la
 * misma tasa, pero la primera no se puede defender. Usar el límite inferior
 * unifica "tasa observada" y "tamaño de muestra" en una sola cantidad, sin
 * inventar pesos para combinarlas.
 *
 * Wilson y no la aproximación normal (`p ± z·√(p(1−p)/n)`) porque la normal
 * se degrada cuando `p` se acerca a 0 o 1 — y acá `p ≈ 0,88 — y puede
 * producir límites fuera de [0,1]. Wilson mantiene cobertura razonable en
 * todo el rango y nunca sale del intervalo válido.
 *
 * Se calcula SIEMPRE a partir de los conteos crudos (`aciertos`, `total`)
 * que devuelve `racha3_resumen()`, nunca de la tasa ya redondeada a
 * `numeric(6,4)` que también devuelve: el redondeo introduce un error de
 * ~1e-5 en `p` que no hace falta arrastrar.
 */

/** Cuantil normal de dos colas al 95 %. */
export const Z_95 = 1.959963984540054;

export type IntervaloWilson = {
  /** Proporción observada, exacta: `aciertos / total`. */
  readonly proporcion: number;
  readonly aciertos: number;
  readonly total: number;
  readonly z: number;
  /** Centro del intervalo (desplazado respecto de `proporcion`). */
  readonly centro: number;
  readonly margen: number;
  readonly limiteInferior: number;
  readonly limiteSuperior: number;
  readonly metodo: 'wilson';
};

/**
 * `total = 0` no tiene proporción que estimar: devuelve un intervalo
 * completo [0,1] con `limiteInferior = 0`. Así el score resultante es 0 y
 * ninguna decisión puede apoyarse en una muestra vacía por accidente.
 */
export function intervaloWilson(
  aciertos: number,
  total: number,
  z: number = Z_95,
): IntervaloWilson {
  if (!Number.isFinite(aciertos) || !Number.isFinite(total) || total <= 0) {
    return {
      proporcion: 0,
      aciertos: 0,
      total: 0,
      z,
      centro: 0,
      margen: 0,
      limiteInferior: 0,
      limiteSuperior: 1,
      metodo: 'wilson',
    };
  }

  const p = aciertos / total;
  const z2 = z * z;
  const denominador = 1 + z2 / total;
  const centro = (p + z2 / (2 * total)) / denominador;
  const margen =
    (z / denominador) *
    Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));

  return {
    proporcion: p,
    aciertos,
    total,
    z,
    centro,
    margen,
    // El clamp cubre el borde numérico: con p exactamente 0 o 1 y n chico,
    // el redondeo de punto flotante puede dejar el límite en -1e-17.
    limiteInferior: Math.min(1, Math.max(0, centro - margen)),
    limiteSuperior: Math.min(1, Math.max(0, centro + margen)),
    metodo: 'wilson',
  };
}
