import { intervaloWilson, Z_95 } from './wilson';

describe('intervaloWilson', () => {
  it('reproduce los valores reales del histórico al 2026-09-08', () => {
    // Son los números con los que se justificó el umbral. Si esta prueba
    // falla, el umbral configurado dejó de corresponder a su origen.
    const global = intervaloWilson(3577, 4069);
    expect(global.proporcion).toBeCloseTo(0.87908577, 8);
    expect(100 * global.limiteInferior).toBeCloseTo(86.87, 2);

    const player = intervaloWilson(1802, 2019);
    expect(100 * player.limiteInferior).toBeCloseTo(87.83, 2);

    const banker = intervaloWilson(1775, 2050);
    expect(100 * banker.limiteInferior).toBeCloseTo(85.04, 2);
  });

  it('el límite inferior castiga la muestra chica con la MISMA tasa', () => {
    // Es la propiedad por la que el score no necesita un componente
    // separado de "muestra": ya está dentro del intervalo.
    const pocas = intervaloWilson(9, 10);
    const muchas = intervaloWilson(900, 1000);

    expect(pocas.proporcion).toBeCloseTo(muchas.proporcion, 10);
    expect(pocas.limiteInferior).toBeLessThan(muchas.limiteInferior);
    expect(pocas.limiteInferior).toBeLessThan(0.7);
    expect(muchas.limiteInferior).toBeGreaterThan(0.87);
  });

  it('el límite inferior crece monótonamente con la muestra', () => {
    const previos = [10, 50, 100, 500, 1000, 5000].map(
      (n) => intervaloWilson(Math.round(0.88 * n), n).limiteInferior,
    );
    for (let i = 1; i < previos.length; i++) {
      expect(previos[i]).toBeGreaterThan(previos[i - 1]);
    }
  });

  it('nunca sale de [0,1], ni en los extremos', () => {
    for (const [k, n] of [
      [0, 1],
      [1, 1],
      [0, 100],
      [100, 100],
      [1, 2],
    ] as const) {
      const ic = intervaloWilson(k, n);
      expect(ic.limiteInferior).toBeGreaterThanOrEqual(0);
      expect(ic.limiteSuperior).toBeLessThanOrEqual(1);
      expect(ic.limiteInferior).toBeLessThanOrEqual(ic.limiteSuperior);
    }
  });

  it('con muestra vacía devuelve límite inferior 0, no NaN', () => {
    // Importa: un NaN se propagaría al score y una comparación con NaN es
    // siempre falsa, así que la decisión saldría "NO TOMAR" por accidente
    // en vez de por regla.
    for (const [k, n] of [
      [0, 0],
      [5, 0],
      [Number.NaN, 10],
      [10, Number.NaN],
    ] as const) {
      const ic = intervaloWilson(k, n);
      expect(ic.limiteInferior).toBe(0);
      expect(Number.isNaN(ic.limiteInferior)).toBe(false);
    }
  });

  it('el centro de Wilson se desplaza hacia 0.5 respecto de la proporción', () => {
    // Es lo que distingue Wilson de la aproximación normal y lo que le da
    // mejor cobertura cerca de los extremos.
    const ic = intervaloWilson(95, 100);
    expect(ic.centro).toBeLessThan(ic.proporcion);
    expect(ic.metodo).toBe('wilson');
    expect(ic.z).toBe(Z_95);
  });

  it('es determinístico: mismos inputs, mismo output bit a bit', () => {
    const a = intervaloWilson(1802, 2019);
    const b = intervaloWilson(1802, 2019);
    expect(a).toEqual(b);
    expect(a.limiteInferior).toBe(b.limiteInferior);
  });
});
