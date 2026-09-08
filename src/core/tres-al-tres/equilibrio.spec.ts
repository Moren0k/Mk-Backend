import {
  calcularEquilibrio,
  ESCALERA_1_2_4,
  evPorOperacion,
  tasaDeEscalera,
  ventajaPorUnidad,
} from './equilibrio';

/** Empates por nivel realmente observados sobre el histórico al 2026-09-09. */
const TIES_REALES = [
  { nivel: 0, ties: 561 },
  { nivel: 1, ties: 280 },
  { nivel: 2, ties: 127 },
];
const OPERACIONES_REALES = 4218;

const PAGO_1_1 = {
  escalera: ESCALERA_1_2_4,
  devolucionTie: 0.9,
  pagoAcierto: 1,
};

describe('calcularEquilibrio', () => {
  it('deriva la pérdida y el equilibrio sin empates de la escalera', () => {
    const e = calcularEquilibrio(PAGO_1_1, [], 0);

    expect(e.perdidaPorFallo).toBe(7);
    expect(e.gananciaPorAcierto).toBe(1);
    expect(e.umbralSinTie).toBeCloseTo(7 / 8, 12);
  });

  it('reproduce el peaje y el umbral medidos sobre el histórico real', () => {
    // Son los números con los que se justificó el rediseño. Si esta prueba
    // falla, el umbral del sistema dejó de corresponder a su origen.
    const e = calcularEquilibrio(PAGO_1_1, TIES_REALES, OPERACIONES_REALES);

    const costes = e.peajePorNivel.map((n) => n.coste);
    expect(costes[0]).toBeCloseTo(56.1, 6);
    expect(costes[1]).toBeCloseTo(56.0, 6);
    expect(costes[2]).toBeCloseTo(50.8, 6);
    // 56,10 + 56,00 + 50,80 = 162,90 unidades sobre 4.218 operaciones.
    expect(e.peajeTiePorOperacion).toBeCloseTo(0.0386201, 6);
    expect(100 * e.umbral).toBeCloseTo(87.983, 3);
  });

  it('cada nivel pesa casi lo mismo: el peaje NO se diluye con más gales', () => {
    // La mitad de empates en cada nivel siguiente, pero el doble de apuesta.
    const e = calcularEquilibrio(PAGO_1_1, TIES_REALES, OPERACIONES_REALES);
    const costes = e.peajePorNivel.map((n) => n.coste);

    for (const c of costes) {
      expect(c).toBeGreaterThan(0.85 * costes[0]);
      expect(c).toBeLessThan(1.15 * costes[0]);
    }
  });

  it('si el empate devolviera el 100 %, el peaje es 0 y el umbral cae a 7/8', () => {
    const e = calcularEquilibrio(
      { ...PAGO_1_1, devolucionTie: 1 },
      TIES_REALES,
      OPERACIONES_REALES,
    );

    expect(e.peajeTiePorOperacion).toBe(0);
    expect(e.umbral).toBeCloseTo(7 / 8, 12);
    expect(e.umbral).toBe(e.umbralSinTie);
  });

  it('un empate más caro sube el umbral, monótonamente', () => {
    const umbrales = [1, 0.95, 0.9, 0.8, 0].map(
      (d) =>
        calcularEquilibrio(
          { ...PAGO_1_1, devolucionTie: d },
          TIES_REALES,
          OPERACIONES_REALES,
        ).umbral,
    );

    for (let i = 1; i < umbrales.length; i++) {
      expect(umbrales[i]).toBeGreaterThan(umbrales[i - 1]);
    }
  });

  it('sin operaciones medidas cae al umbral MENOS exigente y lo dice', () => {
    // Importa que no falle en silencio: sin datos de coste el umbral baja,
    // así que la traza tiene que dejar constancia.
    const e = calcularEquilibrio(PAGO_1_1, TIES_REALES, 0);

    expect(e.peajeTiePorOperacion).toBe(0);
    expect(e.umbral).toBe(e.umbralSinTie);
    expect(e.traza.join(' ')).toContain('MENOS exigente');
  });

  it('un nivel sin datos aporta 0, no un valor inventado', () => {
    const e = calcularEquilibrio(PAGO_1_1, [{ nivel: 0, ties: 100 }], 1000);

    expect(e.peajePorNivel[1].ties).toBe(0);
    expect(e.peajePorNivel[2].coste).toBe(0);
    expect(e.peajeTiePorOperacion).toBeCloseTo((100 * 0.1) / 1000, 12);
  });

  it('una escalera más profunda sube la pérdida y el equilibrio', () => {
    const dos = calcularEquilibrio(PAGO_1_1, [], 0);
    const tres = calcularEquilibrio(
      { ...PAGO_1_1, escalera: [1, 2, 4, 8] },
      [],
      0,
    );

    expect(dos.perdidaPorFallo).toBe(7);
    expect(tres.perdidaPorFallo).toBe(15);
    expect(tres.umbralSinTie).toBeCloseTo(15 / 16, 12);
  });

  it('la traza deja auditar el umbral contra la estructura de pago', () => {
    const e = calcularEquilibrio(PAGO_1_1, TIES_REALES, OPERACIONES_REALES);
    const texto = e.traza.join('\n');

    expect(texto).toContain('escalera = [1, 2, 4]');
    expect(texto).toContain('87.500%');
    expect(texto).toContain('561 empates');
    expect(texto).toContain('unidades por operación');
    expect(texto).toContain('umbral =');
  });
});

describe('tasaDeEscalera', () => {
  it('sobre un juego simétrico da exactamente el equilibrio sin empates', () => {
    // ES LA PROPIEDAD CENTRAL DE TODO EL DISEÑO: una martingala sobre una
    // apuesta 50/50 tiene expectativa EXACTAMENTE cero, para cualquier
    // profundidad. La detección de la racha no aporta nada a la
    // expectativa; solo decide cuándo se juega.
    for (const intentos of [1, 2, 3, 4, 5, 8]) {
      const escalera = Array.from({ length: intentos }, (_, i) => 2 ** i);
      const e = calcularEquilibrio(
        { escalera, devolucionTie: 1, pagoAcierto: 1 },
        [],
        0,
      );

      expect(tasaDeEscalera(0.5, intentos)).toBeCloseTo(e.umbral, 12);
      expect(evPorOperacion(tasaDeEscalera(0.5, intentos), e)).toBeCloseTo(
        0,
        12,
      );
    }
  });

  it('crece con la ventaja del lado y con los intentos', () => {
    expect(tasaDeEscalera(0.5053, 3)).toBeGreaterThan(tasaDeEscalera(0.5, 3));
    expect(tasaDeEscalera(0.5, 4)).toBeGreaterThan(tasaDeEscalera(0.5, 3));
  });

  it('es monótona, que es lo que permite transformar los extremos del IC', () => {
    // La estimación por modelo propaga un intervalo de confianza de ω por
    // esta función. Solo es válido porque es monótona creciente.
    const previos = [0.3, 0.4, 0.5, 0.6, 0.7].map((w) => tasaDeEscalera(w, 3));
    for (let i = 1; i < previos.length; i++) {
      expect(previos[i]).toBeGreaterThan(previos[i - 1]);
    }
  });

  it('acota la entrada a [0,1] en vez de devolver un valor imposible', () => {
    expect(tasaDeEscalera(-1, 3)).toBe(0);
    expect(tasaDeEscalera(2, 3)).toBe(1);
  });
});

describe('ventajaPorUnidad', () => {
  /** Conteos reales de `jugadas` al 2026-09-09. */
  const BANKER = { gana: 19726, pierde: 19309, empata: 5094 };
  const PLAYER = { gana: 19309, pierde: 19726, empata: 5094 };

  it('apostar BANKER es negativo: el peaje del empate se come la ventaja', () => {
    const v = ventajaPorUnidad({ ...BANKER, devolucionTie: 0.9 });

    // La ventaja del lado es +0,94 % del importe; el peaje del empate
    // −1,15 %. El peaje es más grande.
    expect(v).toBeLessThan(0);
    expect(100 * v).toBeCloseTo(-0.212, 2);
  });

  it('apostar PLAYER es mucho peor', () => {
    const v = ventajaPorUnidad({ ...PLAYER, devolucionTie: 0.9 });

    expect(100 * v).toBeCloseTo(-2.099, 2);
    expect(v).toBeLessThan(ventajaPorUnidad({ ...BANKER, devolucionTie: 0.9 }));
  });

  it('con devolución del 100 % la ventaja del banco pasa a ser positiva', () => {
    // Es el parámetro que voltea el signo de toda la estrategia.
    expect(ventajaPorUnidad({ ...BANKER, devolucionTie: 1 })).toBeGreaterThan(
      0,
    );
  });

  it('sobre un juego perfectamente simétrico y sin peaje es exactamente 0', () => {
    expect(
      ventajaPorUnidad({
        gana: 1000,
        pierde: 1000,
        empata: 200,
        devolucionTie: 1,
      }),
    ).toBeCloseTo(0, 12);
  });

  it('sin rondas devuelve 0, no NaN', () => {
    expect(
      ventajaPorUnidad({ gana: 0, pierde: 0, empata: 0, devolucionTie: 0.9 }),
    ).toBe(0);
  });
});

describe('evPorOperacion', () => {
  it('el umbral es exactamente la tasa que hace el EV cero', () => {
    const e = calcularEquilibrio(PAGO_1_1, TIES_REALES, OPERACIONES_REALES);

    expect(evPorOperacion(e.umbral, e)).toBeCloseTo(0, 12);
    expect(evPorOperacion(e.umbral + 0.01, e)).toBeGreaterThan(0);
    expect(evPorOperacion(e.umbral - 0.01, e)).toBeLessThan(0);
  });

  it('la tasa global observada del histórico queda por debajo del equilibrio', () => {
    // 3711/4218 = 87,98 % contra un equilibrio de 87,983 %: el histórico
    // completo está esencialmente en cero, no en ganancia.
    const e = calcularEquilibrio(PAGO_1_1, TIES_REALES, OPERACIONES_REALES);

    expect(3711 / 4218).toBeLessThan(e.umbral);
    expect(evPorOperacion(3711 / 4218, e)).toBeLessThan(0);
    expect(evPorOperacion(3711 / 4218, e)).toBeGreaterThan(-0.01);
  });
});
