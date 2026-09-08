import { WinnerType } from '../enums/winner-type.enum';
import { calcularRacha3TestScore } from './racha3-test-score.calculator';
import {
  Racha3TestContexto,
  Racha3TestEstadoAnalytics,
  Racha3TestEvidencia,
  Racha3TestParametros,
} from './types/racha3-test.type';

const PARAMS: Racha3TestParametros = {
  umbralScore: 86.87,
  muestraMinima: 500,
  maxRezagoJugadas: 50,
};

/** Evidencia real de PLAYER al 2026-09-08: score esperado 87.83. */
const PLAYER: Racha3TestEvidencia = {
  condicion: 'tipo_racha=PLAYER',
  tipoRacha: WinnerType.PLAYER,
  aciertos: 1802,
  resueltas: 2019,
  directa: 1048,
  mg1: 483,
  mg2: 271,
  perdidas: 217,
  muestraN: 2019,
  advertenciaMuestra: null,
  muestraBloqueadasExcluidas: 25,
  muestraIntegridadDudosa: 4,
  ventanaDesde: '2026-08-21T18:23:15.232Z',
  ventanaHasta: '2026-09-08T01:00:00.000Z',
};

/** Evidencia real de BANKER: score esperado 85.04 (bajo el umbral). */
const BANKER: Racha3TestEvidencia = {
  ...PLAYER,
  condicion: 'tipo_racha=BANKER',
  tipoRacha: WinnerType.BANKER,
  aciertos: 1775,
  resueltas: 2050,
  directa: 991,
  mg1: 531,
  mg2: 253,
  perdidas: 275,
  muestraN: 2050,
};

const CONTEXTO: Racha3TestContexto = {
  horaColombia: 21,
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
  jugadasSinProcesar: 2,
  totalOportunidades: 4119,
  error: null,
};

const calcular = (
  over: Partial<{
    evidencia: Racha3TestEvidencia | null;
    contexto: Racha3TestContexto;
    estadoAnalytics: Racha3TestEstadoAnalytics;
    operacionVirtualAbierta: boolean;
    parametros: Racha3TestParametros;
  }> = {},
) =>
  calcularRacha3TestScore({
    evidencia: PLAYER,
    contexto: CONTEXTO,
    estadoAnalytics: ESTADO_OK,
    operacionVirtualAbierta: false,
    parametros: PARAMS,
    ...over,
  });

const gate = (r: ReturnType<typeof calcular>, nombre: string) =>
  r.gates.find((g) => g.gate === nombre);

describe('calcularRacha3TestScore', () => {
  describe('fórmula', () => {
    it('el score ES 100 × límite inferior del IC95, con los datos reales de PLAYER', () => {
      const r = calcular();
      expect(r.score).toBe(87.83);
      expect(r.componentes.intervalo?.limiteInferior).toBeCloseTo(0.878258, 6);
      expect(100 * (r.componentes.intervalo?.limiteInferior ?? 0)).toBeCloseTo(
        87.83,
        2,
      );
    });

    it('calcula la tasa de los CONTEOS, no de una tasa redondeada', () => {
      const r = calcular();
      expect(r.componentes.historico.tasaObservada).toBeCloseTo(0.89252105, 8);
      expect(r.componentes.historico.aciertos).toBe(1802);
      expect(r.componentes.historico.resueltas).toBe(2019);
    });

    it('BANKER da 85.04 y queda bajo el umbral', () => {
      const r = calcular({ evidencia: BANKER });
      expect(r.score).toBe(85.04);
      expect(r.tomar).toBe(false);
      expect(r.nivel).toBe('BAJO_UMBRAL');
    });

    it('es determinístico y reproducible', () => {
      const a = calcular();
      const b = calcular();
      expect(a.score).toBe(b.score);
      expect(a.traza).toEqual(b.traza);
      expect(a.gates).toEqual(b.gates);
    });

    it('no aplica ninguna penalización numérica (por diseño)', () => {
      // Lo que degrada la decisión está modelado como gate o advertencia:
      // restar puntos inventados sería el peso artificial que se evita.
      expect(calcular().penalizaciones).toEqual([]);
      expect(
        calcular({
          evidencia: { ...PLAYER, advertenciaMuestra: 'muestra_n < 100' },
        }).penalizaciones,
      ).toEqual([]);
    });
  });

  describe('la traza permite verificar el score a mano', () => {
    it('incluye conteos, tasa, IC, score, gates y decisión, en orden', () => {
      const t = calcular().traza;
      expect(t[0]).toContain('aciertos=1802 de resueltas=2019');
      expect(t[1]).toContain('1802/2019');
      expect(t[2]).toContain('IC95 Wilson');
      expect(t[3]).toContain('score = 100 × límite_inferior');
      expect(t[3]).toContain('87.83');
      expect(t[5]).toContain('Gates');
      expect(t[6]).toContain('Decisión: TOMAR');
    });
  });

  describe('umbral', () => {
    it('score por encima del umbral → TOMAR', () => {
      const r = calcular({ parametros: { ...PARAMS, umbralScore: 80 } });
      expect(r.tomar).toBe(true);
      expect(r.nivel).toBe('SOBRE_UMBRAL');
    });

    it('score EXACTAMENTE igual al umbral → TOMAR (la regla es >=)', () => {
      const r = calcular({ parametros: { ...PARAMS, umbralScore: 87.83 } });
      expect(r.score).toBe(87.83);
      expect(r.tomar).toBe(true);
      expect(r.nivel).toBe('EN_UMBRAL');
      expect(gate(r, 'SCORE_BAJO_UMBRAL')?.disparado).toBe(false);
    });

    it('score un centésimo por debajo del umbral → NO TOMAR', () => {
      const r = calcular({ parametros: { ...PARAMS, umbralScore: 87.84 } });
      expect(r.tomar).toBe(false);
      expect(gate(r, 'SCORE_BAJO_UMBRAL')?.disparado).toBe(true);
    });
  });

  describe('gate: muestra insuficiente', () => {
    it('bloquea aunque el score sea alto, y NO se compensa con puntos', () => {
      // 95 de 100 tiene mejor tasa que 1802/2019, pero muestra insuficiente.
      const r = calcular({
        evidencia: { ...PLAYER, aciertos: 95, resueltas: 100, muestraN: 100 },
        parametros: { ...PARAMS, umbralScore: 80 },
      });
      expect(r.componentes.muestra.suficiente).toBe(false);
      expect(gate(r, 'MUESTRA_INSUFICIENTE')?.disparado).toBe(true);
      expect(r.tomar).toBe(false);
      expect(r.razones.some((x) => x.includes('Muestra insuficiente'))).toBe(
        true,
      );
    });

    it('exactamente en el mínimo NO bloquea (la regla es >=)', () => {
      const r = calcular({
        evidencia: { ...PLAYER, aciertos: 470, resueltas: 500, muestraN: 500 },
        parametros: { ...PARAMS, umbralScore: 80 },
      });
      expect(gate(r, 'MUESTRA_INSUFICIENTE')?.disparado).toBe(false);
      expect(r.tomar).toBe(true);
    });
  });

  describe('gate: Analytics sin evidencia', () => {
    it('un error de Analytics NUNCA produce score favorable', () => {
      const r = calcular({
        evidencia: null,
        estadoAnalytics: {
          disponible: false,
          checkpointExiste: false,
          jugadasSinProcesar: 0,
          totalOportunidades: 0,
          error: "Can't reach database server",
        },
      });
      expect(r.score).toBeNull();
      expect(r.nivel).toBe('SIN_EVIDENCIA');
      expect(r.tomar).toBe(false);
      expect(gate(r, 'ANALYTICS_SIN_EVIDENCIA')?.disparado).toBe(true);
      expect(r.razones.some((x) => x.includes("Can't reach"))).toBe(true);
    });

    it('Analytics disponible pero sin datos para la condición también bloquea', () => {
      const r = calcular({
        evidencia: { ...PLAYER, aciertos: 0, resueltas: 0, muestraN: 0 },
      });
      expect(r.score).toBeNull();
      expect(r.tomar).toBe(false);
    });

    it('no inventa un intervalo cuando no hay evidencia', () => {
      const r = calcular({
        evidencia: null,
        estadoAnalytics: { ...ESTADO_OK, disponible: false },
      });
      expect(r.componentes.intervalo).toBeNull();
      expect(r.componentes.historico.tasaObservada).toBeNull();
    });
  });

  describe('gate: Analytics rezagado', () => {
    it('bloquea cuando el rezago supera el máximo, aunque el score alcance', () => {
      const r = calcular({
        estadoAnalytics: { ...ESTADO_OK, jugadasSinProcesar: 371 },
        parametros: { ...PARAMS, umbralScore: 80 },
      });
      expect(r.score).toBe(87.83);
      expect(gate(r, 'ANALYTICS_REZAGADO')?.disparado).toBe(true);
      expect(r.tomar).toBe(false);
    });

    it('exactamente en el máximo no bloquea', () => {
      const r = calcular({
        estadoAnalytics: { ...ESTADO_OK, jugadasSinProcesar: 50 },
        parametros: { ...PARAMS, umbralScore: 80 },
      });
      expect(gate(r, 'ANALYTICS_REZAGADO')?.disparado).toBe(false);
      expect(r.tomar).toBe(true);
    });
  });

  describe('gate: operación virtual abierta', () => {
    it('bloquea aunque todo lo demás dé para tomar', () => {
      const r = calcular({
        operacionVirtualAbierta: true,
        parametros: { ...PARAMS, umbralScore: 80 },
      });
      expect(gate(r, 'OPERACION_VIRTUAL_ABIERTA')?.disparado).toBe(true);
      expect(r.tomar).toBe(false);
    });
  });

  describe('contexto: peso 0 explícito', () => {
    it('el contexto viaja con peso 0 y no altera el score', () => {
      const base = calcular().score;

      for (const contexto of [
        { ...CONTEXTO, horaColombia: 4, diaSemana: 0 },
        {
          ...CONTEXTO,
          distanciaActual: 51,
          bucketDistancia: '51+',
          hazardBucket: 0.1081,
        },
        { ...CONTEXTO, hazardBucket: 0.99, frecuenciaHistoricaBucket: 0.99 },
      ]) {
        const r = calcular({ contexto });
        expect(r.score).toBe(base);
        expect(r.componentes.contexto.peso).toBe(0);
      }
    });

    it('conserva el hazard y la frecuencia como campos distintos', () => {
      // Son magnitudes distintas y no comparables; el DEBUG las muestra
      // separadas justamente para que no se confundan.
      const c = calcular().componentes.contexto;
      expect(c.hazardBucket).toBe(0.1326);
      expect(c.frecuenciaHistoricaBucket).toBe(0.3819);
    });
  });

  describe('advertencias (informan, no castigan)', () => {
    it('reporta la advertencia de muestra de Analytics sin tocar el score', () => {
      const r = calcular({
        evidencia: { ...PLAYER, advertenciaMuestra: 'muestra_n < 100' },
      });
      expect(r.score).toBe(87.83);
      expect(r.advertencias.some((a) => a.includes('muestra_n < 100'))).toBe(
        true,
      );
    });

    it('advierte si la distancia no es exacta, sin tocar el score', () => {
      const r = calcular({ contexto: { ...CONTEXTO, distanciaExacta: false } });
      expect(r.score).toBe(87.83);
      expect(r.advertencias.some((a) => a.includes('no es exacta'))).toBe(true);
    });

    it('advierte si la corrida empieza tras un hueco del historial', () => {
      const r = calcular({
        contexto: { ...CONTEXTO, columnaConCortePorGap: true },
      });
      expect(
        r.advertencias.some((a) => a.includes('discontinuidad del historial')),
      ).toBe(true);
    });

    it('advierte cuántas filas de integridad dudosa hay en la evidencia', () => {
      const r = calcular();
      expect(r.advertencias.some((a) => a.includes('integridad dudosa'))).toBe(
        true,
      );
    });
  });

  describe('no usa vocabulario predictivo', () => {
    it('ningún campo ni texto dice probabilidad, prediccion o confianza', () => {
      const json = JSON.stringify(calcular()).toLowerCase();
      expect(json).not.toContain('probabilidad');
      expect(json).not.toContain('prediccion');
      expect(json).not.toContain('confianza');
    });
  });
});
