import { WinnerType } from '../enums/winner-type.enum';
import { calcularRacha3TestScore } from './racha3-test-score.calculator';
import {
  Racha3TestContexto,
  Racha3TestEstadoAnalytics,
  Racha3TestEvidencia,
  Racha3TestLados,
  Racha3TestParametros,
} from './types/racha3-test.type';

/**
 * Fixtures con los CONTEOS REALES del histórico al 2026-09-09, para que las
 * pruebas fijen los números con los que se justificó el rediseño y no unos
 * inventados.
 */
const EVIDENCIA_PLAYER: Racha3TestEvidencia = {
  condicion: 'tipo_racha=PLAYER',
  tipoRacha: WinnerType.PLAYER,
  aciertos: 1873,
  resueltas: 2095,
  directa: 1089,
  mg1: 502,
  mg2: 282,
  perdidas: 222,
  muestraN: 2095,
  advertenciaMuestra: null,
  muestraBloqueadasExcluidas: 25,
  muestraIntegridadDudosa: 0,
  ventanaDesde: null,
  ventanaHasta: null,
};

/** Distribución real de `jugadas`: BANKER gana un poco más que PLAYER. */
const LADOS: Racha3TestLados = {
  total: 44139,
  banker: 19733,
  player: 19312,
  tie: 5094,
  noTie: 39045,
  corteId: 44718,
};

/** Empates por nivel de las operaciones que apostaron BANKER. */
const TIES_BANKER = [
  { nivel: 0, ties: 269 },
  { nivel: 1, ties: 126 },
  { nivel: 2, ties: 57 },
];
const OPERACIONES_BANKER = 2095;

const CONTEXTO: Racha3TestContexto = {
  horaColombia: 10,
  diaSemana: 2,
  distanciaActual: 7,
  distanciaExacta: true,
  bucketDistancia: '6-10',
  hazardBucket: 0.1326,
  frecuenciaHistoricaBucket: 0.3819,
  columnaConCortePorGap: false,
};

const ESTADO_OK: Racha3TestEstadoAnalytics = {
  disponible: true,
  checkpointExiste: true,
  jugadasSinProcesar: 1,
  totalOportunidades: 4220,
  error: null,
};

const PARAMETROS: Racha3TestParametros = {
  umbralMinimo: 0,
  muestraMinima: 500,
  maxRezagoJugadas: 50,
  escalera: [1, 2, 4],
  devolucionTie: 0.9,
  pagoAcierto: 1,
};

type Entrada = Parameters<typeof calcularRacha3TestScore>[0];

function calcular(cambios: Partial<Entrada> = {}) {
  return calcularRacha3TestScore({
    evidencia: EVIDENCIA_PLAYER,
    lados: LADOS,
    tiesPorNivel: TIES_BANKER,
    operacionesMedidas: OPERACIONES_BANKER,
    apuesta: WinnerType.BANKER,
    contexto: CONTEXTO,
    estadoAnalytics: ESTADO_OK,
    operacionVirtualAbierta: false,
    parametros: PARAMETROS,
    ...cambios,
  });
}

const gate = (r: ReturnType<typeof calcular>, nombre: string) =>
  r.gates.find((g) => g.gate === nombre);

describe('calcularRacha3TestScore', () => {
  describe('el umbral sale de la estructura de pago, no del historial', () => {
    it('con la escalera 1-2-4 y devolución 0,9 el umbral es 87,95', () => {
      // (7 + 74,90/2095) / 8 = 87,947 % → 87,95.
      const r = calcular();

      expect(r.umbral).toBe(87.95);
      expect(r.economia.perdidaPorFallo).toBe(7);
      expect(r.economia.peajeTiePorOperacion).toBeCloseTo(0.035752, 6);
      expect(100 * r.economia.umbralSinTie).toBeCloseTo(87.5, 6);
    });

    it('NO depende de la tasa de acierto: cambiarla no mueve el umbral', () => {
      // Es la propiedad que arregla el defecto del diseño anterior, donde
      // el umbral salía del propio historial de aciertos y con dos
      // categorías aprobaba una y rechazaba la otra por aritmética.
      const base = calcular().umbral;

      expect(
        calcular({
          evidencia: { ...EVIDENCIA_PLAYER, aciertos: 1000, perdidas: 1095 },
        }).umbral,
      ).toBe(base);
      expect(
        calcular({
          evidencia: { ...EVIDENCIA_PLAYER, aciertos: 2095, perdidas: 0 },
        }).umbral,
      ).toBe(base);
    });

    it('sí depende del coste: un empate más caro sube el umbral', () => {
      expect(
        calcular({ parametros: { ...PARAMETROS, devolucionTie: 1 } }).umbral,
      ).toBeLessThan(calcular().umbral);
      expect(
        calcular({ parametros: { ...PARAMETROS, devolucionTie: 0.5 } }).umbral,
      ).toBeGreaterThan(calcular().umbral);
    });

    it('una escalera más profunda sube la pérdida y el equilibrio', () => {
      const r = calcular({
        parametros: { ...PARAMETROS, escalera: [1, 2, 4, 8] },
      });

      expect(r.economia.perdidaPorFallo).toBe(15);
      expect(100 * r.economia.umbralSinTie).toBeCloseTo(93.75, 6);
    });

    it('`umbralMinimo` solo puede hacerlo más exigente, nunca menos', () => {
      expect(
        calcular({ parametros: { ...PARAMETROS, umbralMinimo: 50 } }).umbral,
      ).toBe(87.95);
      expect(
        calcular({ parametros: { ...PARAMETROS, umbralMinimo: 95 } }).umbral,
      ).toBe(95);
    });
  });

  describe('las dos estimaciones', () => {
    it('la DIRECTA es el límite inferior del IC95 de los conteos', () => {
      const r = calcular();

      expect(r.scoreDirecto).toBe(88.01);
      expect(r.componentes.intervalo?.limiteInferior).toBeCloseTo(
        0.88012449,
        8,
      );
      expect(r.componentes.historico.tasaObservada).toBeCloseTo(
        1873 / 2095,
        10,
      );
    });

    it('la del MODELO propaga el IC de la ventaja del lado por la escalera', () => {
      const r = calcular();
      const m = r.componentes.modelo!;

      expect(m.lado).toBe(WinnerType.BANKER);
      expect(m.gana).toBe(19733);
      expect(m.pierde).toBe(19312);
      expect(m.omega).toBeCloseTo(19733 / 39045, 10);
      expect(m.intentos).toBe(3);
      // 1 − (1−ω)³ aplicado al límite inferior de ω: exacto por monotonía,
      // sin método delta.
      expect(m.tasaLimiteInferior).toBeCloseTo(
        1 - Math.pow(1 - m.intervaloOmega.limiteInferior, 3),
        12,
      );
      expect(r.scoreModelo).toBe(87.53);
    });

    it('el score que decide es el MENOR de los dos', () => {
      const r = calcular();

      expect(r.score).toBe(Math.min(r.scoreDirecto!, r.scoreModelo!));
      expect(r.score).toBe(87.53);
    });

    it('usa el lado correcto: apostar PLAYER invierte los conteos', () => {
      const r = calcular({ apuesta: WinnerType.PLAYER });
      const m = r.componentes.modelo!;

      expect(m.gana).toBe(19312);
      expect(m.pierde).toBe(19733);
      expect(r.scoreModelo!).toBeLessThan(calcular().scoreModelo!);
    });
  });

  describe('la decisión', () => {
    it('con los datos reales y devolución del 90 %: NO TOMAR', () => {
      // El resultado honesto del histórico actual: incluso la mejor apuesta
      // posible (BANKER) no llega al punto de equilibrio.
      const r = calcular();

      expect(r.tomar).toBe(false);
      expect(r.nivel).toBe('BAJO_UMBRAL');
      expect(gate(r, 'SCORE_BAJO_UMBRAL')?.disparado).toBe(true);
      expect(r.economia.evEstimado!).toBeLessThan(0);
    });

    it('con devolución del 100 % la MISMA evidencia pasa a TOMAR', () => {
      // El parámetro que voltea el signo de la estrategia entera: sin peaje
      // el equilibrio baja a 87,50 y el score de 87,53 ya lo supera.
      const r = calcular({ parametros: { ...PARAMETROS, devolucionTie: 1 } });

      expect(r.umbral).toBe(87.5);
      expect(r.score).toBe(87.53);
      expect(r.tomar).toBe(true);
      expect(r.economia.evEstimado!).toBeGreaterThan(0);
    });

    it('exige las DOS: si la directa falla, no toma aunque el modelo pase', () => {
      const r = calcular({
        parametros: { ...PARAMETROS, devolucionTie: 1 },
        evidencia: { ...EVIDENCIA_PLAYER, aciertos: 1800, perdidas: 295 },
      });

      expect(r.scoreModelo!).toBeGreaterThanOrEqual(r.umbral);
      expect(r.scoreDirecto!).toBeLessThan(r.umbral);
      expect(r.tomar).toBe(false);
    });

    it('empate exacto con el umbral → TOMAR (la regla es >=)', () => {
      const r = calcular({
        parametros: { ...PARAMETROS, devolucionTie: 1, umbralMinimo: 87.53 },
      });

      expect(r.score).toBe(r.umbral);
      expect(r.nivel).toBe('EN_UMBRAL');
      expect(r.tomar).toBe(true);
    });

    it('un centésimo por encima del score → NO TOMAR', () => {
      const r = calcular({
        parametros: { ...PARAMETROS, devolucionTie: 1, umbralMinimo: 87.54 },
      });

      expect(r.tomar).toBe(false);
      expect(r.nivel).toBe('BAJO_UMBRAL');
    });
  });

  describe('la ventaja por unidad', () => {
    it('es negativa apostando BANKER con devolución del 90 %', () => {
      const r = calcular();

      expect(r.economia.ventajaPorUnidad!).toBeLessThan(0);
      expect(r.razones.join(' ')).toContain('ninguna escalera');
    });

    it('es positiva con devolución del 100 %', () => {
      expect(
        calcular({ parametros: { ...PARAMETROS, devolucionTie: 1 } }).economia
          .ventajaPorUnidad!,
      ).toBeGreaterThan(0);
    });
  });

  describe('gates', () => {
    it('sin evidencia directa: score null y NO TOMAR', () => {
      const r = calcular({
        evidencia: null,
        estadoAnalytics: {
          ...ESTADO_OK,
          disponible: false,
          error: "Can't reach database server",
        },
      });

      expect(r.score).toBeNull();
      expect(r.scoreDirecto).toBeNull();
      expect(r.scoreModelo).toBeNull();
      expect(r.nivel).toBe('SIN_EVIDENCIA');
      expect(r.tomar).toBe(false);
      expect(gate(r, 'ANALYTICS_SIN_EVIDENCIA')?.disparado).toBe(true);
      expect(r.componentes.intervalo).toBeNull();
      expect(r.componentes.modelo).toBeNull();
      expect(r.economia.evEstimado).toBeNull();
    });

    it('sin conteos de jugadas: bloquea aunque la directa alcance', () => {
      const r = calcular({ lados: null });

      expect(gate(r, 'MODELO_SIN_EVIDENCIA')?.disparado).toBe(true);
      expect(r.score).toBeNull();
      expect(r.tomar).toBe(false);
    });

    it('Analytics disponible pero sin resueltas también bloquea', () => {
      const r = calcular({
        evidencia: { ...EVIDENCIA_PLAYER, resueltas: 0, aciertos: 0 },
      });

      expect(gate(r, 'ANALYTICS_SIN_EVIDENCIA')?.disparado).toBe(true);
      expect(r.tomar).toBe(false);
    });

    it('muestra insuficiente bloquea y no se compensa con score', () => {
      const r = calcular({
        parametros: { ...PARAMETROS, devolucionTie: 1, muestraMinima: 5000 },
      });

      expect(r.score!).toBeGreaterThanOrEqual(r.umbral);
      expect(gate(r, 'MUESTRA_INSUFICIENTE')?.disparado).toBe(true);
      expect(r.tomar).toBe(false);
    });

    it('exactamente en el mínimo de muestra NO bloquea', () => {
      const r = calcular({
        parametros: { ...PARAMETROS, muestraMinima: 2095 },
      });

      expect(gate(r, 'MUESTRA_INSUFICIENTE')?.disparado).toBe(false);
    });

    it('rezago por encima del máximo bloquea aunque el score alcance', () => {
      const r = calcular({
        parametros: { ...PARAMETROS, devolucionTie: 1 },
        estadoAnalytics: { ...ESTADO_OK, jugadasSinProcesar: 371 },
      });

      expect(r.score!).toBeGreaterThanOrEqual(r.umbral);
      expect(gate(r, 'ANALYTICS_REZAGADO')?.disparado).toBe(true);
      expect(r.tomar).toBe(false);
    });

    it('exactamente en el máximo de rezago no bloquea', () => {
      const r = calcular({
        estadoAnalytics: { ...ESTADO_OK, jugadasSinProcesar: 50 },
      });

      expect(gate(r, 'ANALYTICS_REZAGADO')?.disparado).toBe(false);
    });

    it('operación virtual abierta bloquea', () => {
      const r = calcular({
        parametros: { ...PARAMETROS, devolucionTie: 1 },
        operacionVirtualAbierta: true,
      });

      expect(gate(r, 'OPERACION_VIRTUAL_ABIERTA')?.disparado).toBe(true);
      expect(r.tomar).toBe(false);
    });
  });

  describe('contexto: peso 0 explícito', () => {
    it('viaja con peso 0 y no altera el score ni el umbral', () => {
      const r = calcular();
      const otro = calcular({
        contexto: {
          ...CONTEXTO,
          horaColombia: 3,
          diaSemana: 6,
          distanciaActual: 42,
          bucketDistancia: '31-50',
          hazardBucket: 0.99,
        },
      });

      expect(r.componentes.contexto.peso).toBe(0);
      expect(otro.score).toBe(r.score);
      expect(otro.umbral).toBe(r.umbral);
    });

    it('conserva el hazard y la frecuencia como campos distintos', () => {
      const c = calcular().componentes.contexto;

      expect(c.hazardBucket).toBe(0.1326);
      expect(c.frecuenciaHistoricaBucket).toBe(0.3819);
      expect(c.hazardBucket).not.toBe(c.frecuenciaHistoricaBucket);
    });
  });

  describe('advertencias (informan, no castigan)', () => {
    it('avisa cuando las dos estimaciones difieren en más de un punto', () => {
      // 88,01 contra 87,53: la directa viene por encima del modelo, y con
      // ~9x menos muestra eso suele ser suerte.
      const r = calcular({
        evidencia: { ...EVIDENCIA_PLAYER, aciertos: 1950, perdidas: 145 },
      });

      expect(r.advertencias.join(' ')).toContain('difieren');
      expect(r.advertencias.join(' ')).toContain('9×');
    });

    it('reporta la advertencia de muestra de Analytics sin tocar el score', () => {
      const r = calcular({
        evidencia: {
          ...EVIDENCIA_PLAYER,
          advertenciaMuestra: 'muestra_n < 100',
        },
      });

      expect(r.advertencias.join(' ')).toContain('muestra_n < 100');
      expect(r.score).toBe(calcular().score);
    });

    it('advierte si la distancia no es exacta, sin tocar el score', () => {
      const r = calcular({ contexto: { ...CONTEXTO, distanciaExacta: false } });

      expect(r.advertencias.join(' ')).toContain('no es exacta');
      expect(r.score).toBe(calcular().score);
    });

    it('advierte si la corrida empieza tras un hueco del historial', () => {
      const r = calcular({
        contexto: { ...CONTEXTO, columnaConCortePorGap: true },
      });

      expect(r.advertencias.join(' ')).toContain('discontinuidad');
      expect(r.score).toBe(calcular().score);
    });

    it('advierte cuántas filas de integridad dudosa hay', () => {
      const r = calcular({
        evidencia: { ...EVIDENCIA_PLAYER, muestraIntegridadDudosa: 7 },
      });

      expect(r.advertencias.join(' ')).toContain('7 oportunidad');
      expect(r.score).toBe(calcular().score);
    });

    it('advierte si no hay operaciones con las que medir el peaje', () => {
      const r = calcular({ operacionesMedidas: 0, tiesPorNivel: [] });

      expect(r.advertencias.join(' ')).toContain('MENOS exigente');
      expect(r.umbral).toBe(87.5);
    });
  });

  describe('trazabilidad', () => {
    it('la traza recorre umbral, las dos estimaciones, score y decisión', () => {
      const t = calcular().traza.join('\n');

      expect(t).toContain('estructura de pago');
      expect(t).toContain('escalera = [1, 2, 4]');
      expect(t).toContain('empates');
      expect(t).toContain('DIRECTA');
      expect(t).toContain('IC95 Wilson');
      expect(t).toContain('MODELO');
      expect(t).toContain('ventaja por unidad');
      expect(t).toContain('score = min(');
      expect(t).toContain('EV estimado');
      expect(t).toContain('Gates:');
      expect(t).toContain('Decisión:');
    });

    it('es determinística y no aplica penalizaciones numéricas', () => {
      expect(calcular()).toEqual(calcular());
      expect(calcular().penalizaciones).toEqual([]);
    });

    it('no usa vocabulario predictivo', () => {
      const texto = JSON.stringify(calcular()).toLowerCase();

      expect(texto).not.toContain('probabilidad');
      expect(texto).not.toContain('prediccion');
      expect(texto).not.toContain('predicción');
      expect(texto).not.toContain('confianza');
    });
  });
});
