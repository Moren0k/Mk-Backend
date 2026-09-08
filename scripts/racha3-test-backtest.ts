/**
 * Backtest de la estrategia experimental "Racha 3 Test".
 *
 *   pnpm racha3-test:backtest
 *
 * Corre DOS evaluaciones distintas sobre el mismo histórico, y la diferencia
 * entre las dos es el punto del ejercicio:
 *
 *   RETROSPECTIVA   calcula la tasa con TODO el histórico y después la
 *                   aplica a cada oportunidad de ese mismo histórico. Tiene
 *                   fuga de información (leakage) por construcción: para
 *                   decidir sobre la oportunidad nº 500 usa el resultado de
 *                   la nº 3.000, que en vivo no existía. Sus números son
 *                   optimistas y NO son una expectativa de rendimiento.
 *
 *   WALK-FORWARD    para cada oportunidad usa exclusivamente las
 *                   oportunidades que ya estaban RESUELTAS antes del
 *                   instante de su confirmación. Es la única de las dos que
 *                   reproduce lo que el sistema podía saber en vivo.
 *
 * El criterio de "resuelta antes de la confirmación" es deliberadamente
 * estricto: una Racha 3 se confirma y tarda hasta 3 jugadas (más TIE) en
 * resolverse, así que en el instante de confirmar hay operaciones abiertas
 * cuyo resultado todavía no es evidencia. Contarlas sería una fuga sutil y
 * difícil de ver después.
 *
 * Solo LEE de la base.
 *
 * ─── Limitaciones, explícitas ─────────────────────────────────────────────
 *
 * 1. El histórico refleja la secuencia REAL de jugadas, en la que las
 *    operaciones se abrieron una detrás de otra. Al filtrar oportunidades
 *    (tomar unas y descartar otras), el hueco de "una operación a la vez"
 *    quedaría libre en momentos en que históricamente estaba ocupado — y
 *    ahí podrían haberse tomado oportunidades que el histórico marca como
 *    `bloqueada_por_operacion_previa`. Este backtest NO las recupera: las
 *    excluye, igual que el motor y que el proveedor de evidencia. Son 50 de
 *    4.102 filas; el sesgo existe y es conocido, no se estima.
 * 2. El umbral (86,87) se derivó del MISMO histórico sobre el que se mide.
 *    Eso es fuga de información a nivel de diseño, y ninguna de las dos
 *    evaluaciones la corrige. Es la razón por la que este umbral se
 *    documenta como experimental inicial y no como un valor validado.
 * 3. La tasa histórica no es una probabilidad de la próxima jugada. Estos
 *    números describen lo que ya pasó.
 */
import { PrismaClient } from '@prisma/client';

import { intervaloWilson } from '../src/core/racha3-test/wilson';

/** Los mismos defaults que `configuration.ts`. */
const UMBRAL = Number.parseFloat(process.env.RACHA3_TEST_SCORE_THRESHOLD ?? '86.87');
const MUESTRA_MINIMA = Number.parseInt(process.env.RACHA3_TEST_MIN_MUESTRA ?? '500', 10);

type Resultado = 'DIRECTA' | 'MG1' | 'MG2' | 'LOSS';

type Oportunidad = {
  readonly id: number;
  readonly tipoRacha: 'PLAYER' | 'BANKER';
  readonly confirmacionEn: Date;
  readonly resueltaEn: Date;
  readonly resultado: Resultado;
  readonly integridadOk: boolean;
};

type Decision = {
  readonly oportunidad: Oportunidad;
  readonly score: number | null;
  readonly muestraN: number;
  readonly tomar: boolean;
  readonly gate: 'MUESTRA_INSUFICIENTE' | 'SCORE_BAJO_UMBRAL' | null;
};

/** Conteos por condición, exactamente los que alimentan el score en vivo. */
class Contadores {
  private readonly aciertos = new Map<string, number>();
  private readonly resueltas = new Map<string, number>();

  sumar(condicion: string, acierto: boolean): void {
    this.resueltas.set(condicion, (this.resueltas.get(condicion) ?? 0) + 1);
    if (acierto) {
      this.aciertos.set(condicion, (this.aciertos.get(condicion) ?? 0) + 1);
    }
  }

  de(condicion: string): { aciertos: number; resueltas: number } {
    return {
      aciertos: this.aciertos.get(condicion) ?? 0,
      resueltas: this.resueltas.get(condicion) ?? 0,
    };
  }
}

const esAcierto = (r: Resultado): boolean => r !== 'LOSS';

/** La fórmula real: score = 100 × límite inferior del IC95 de Wilson. */
function scoreDe(aciertos: number, resueltas: number): number {
  return Math.round(100 * intervaloWilson(aciertos, resueltas).limiteInferior * 100) / 100;
}

function decidir(
  oportunidad: Oportunidad,
  aciertos: number,
  resueltas: number,
): Decision {
  if (resueltas < MUESTRA_MINIMA) {
    return {
      oportunidad,
      score: resueltas > 0 ? scoreDe(aciertos, resueltas) : null,
      muestraN: resueltas,
      tomar: false,
      gate: 'MUESTRA_INSUFICIENTE',
    };
  }

  const score = scoreDe(aciertos, resueltas);
  return {
    oportunidad,
    score,
    muestraN: resueltas,
    tomar: score >= UMBRAL,
    gate: score >= UMBRAL ? null : 'SCORE_BAJO_UMBRAL',
  };
}

// ─── Informe ───────────────────────────────────────────────────────────────

type Grupo = {
  n: number;
  directa: number;
  mg1: number;
  mg2: number;
  loss: number;
};

const grupoVacio = (): Grupo => ({ n: 0, directa: 0, mg1: 0, mg2: 0, loss: 0 });

function acumular(g: Grupo, r: Resultado): void {
  g.n += 1;
  if (r === 'DIRECTA') g.directa += 1;
  else if (r === 'MG1') g.mg1 += 1;
  else if (r === 'MG2') g.mg2 += 1;
  else g.loss += 1;
}

function lineaGrupo(etiqueta: string, g: Grupo): string {
  if (g.n === 0) {
    return `  ${etiqueta.padEnd(14)} n=0`;
  }
  const aciertos = g.n - g.loss;
  const ic = intervaloWilson(aciertos, g.n);
  const pct = (x: number) => `${((100 * x) / g.n).toFixed(2)}%`;

  return (
    `  ${etiqueta.padEnd(14)} n=${String(g.n).padStart(5)}  ` +
    `acierto=${pct(aciertos).padStart(7)}  ` +
    `IC95=[${(100 * ic.limiteInferior).toFixed(2)}, ${(100 * ic.limiteSuperior).toFixed(2)}]  ` +
    `directa=${pct(g.directa).padStart(7)} mg1=${pct(g.mg1).padStart(7)} ` +
    `mg2=${pct(g.mg2).padStart(7)} loss=${pct(g.loss).padStart(7)}`
  );
}

const BUCKETS_SCORE = [
  { hasta: 80, etiqueta: '< 80' },
  { hasta: 84, etiqueta: '80 – 84' },
  { hasta: 86, etiqueta: '84 – 86' },
  { hasta: UMBRAL, etiqueta: `86 – ${UMBRAL}` },
  { hasta: 88, etiqueta: `${UMBRAL} – 88` },
  { hasta: 90, etiqueta: '88 – 90' },
  { hasta: Infinity, etiqueta: '>= 90' },
];

function distribucionScore(decisiones: readonly Decision[]): string[] {
  const cuentas = BUCKETS_SCORE.map(() => 0);
  let sinScore = 0;

  for (const d of decisiones) {
    if (d.score === null) {
      sinScore += 1;
      continue;
    }
    const i = BUCKETS_SCORE.findIndex((b) => d.score! < b.hasta);
    cuentas[i === -1 ? BUCKETS_SCORE.length - 1 : i] += 1;
  }

  const total = decisiones.length;
  const filas = BUCKETS_SCORE.map((b, i) => {
    const pct = total === 0 ? 0 : (100 * cuentas[i]) / total;
    const barra = '█'.repeat(Math.round(pct / 2));
    return `  ${b.etiqueta.padEnd(14)} ${String(cuentas[i]).padStart(5)}  ${pct.toFixed(2).padStart(6)}%  ${barra}`;
  });

  if (sinScore > 0) {
    filas.push(`  ${'sin score'.padEnd(14)} ${String(sinScore).padStart(5)}  (evidencia vacía)`);
  }
  return filas;
}

function informe(titulo: string, decisiones: readonly Decision[]): void {
  const tomadas = decisiones.filter((d) => d.tomar);
  const descartadas = decisiones.filter((d) => !d.tomar);
  const porMuestra = decisiones.filter((d) => d.gate === 'MUESTRA_INSUFICIENTE');
  const porScore = decisiones.filter((d) => d.gate === 'SCORE_BAJO_UMBRAL');

  const conScore = decisiones.filter((d) => d.score !== null);
  const promedio =
    conScore.length === 0
      ? null
      : conScore.reduce((a, d) => a + d.score!, 0) / conScore.length;

  const gTomar = grupoVacio();
  const gNoTomar = grupoVacio();
  const gTodas = grupoVacio();
  const porTipo = new Map<string, Grupo>();

  for (const d of decisiones) {
    acumular(gTodas, d.oportunidad.resultado);
    acumular(d.tomar ? gTomar : gNoTomar, d.oportunidad.resultado);

    if (d.tomar) {
      const clave = d.oportunidad.tipoRacha;
      const g = porTipo.get(clave) ?? grupoVacio();
      acumular(g, d.oportunidad.resultado);
      porTipo.set(clave, g);
    }
  }

  console.log(`\n${'═'.repeat(78)}`);
  console.log(titulo);
  console.log('═'.repeat(78));

  console.log('\nDECISIONES');
  console.log(`  oportunidades evaluadas      ${decisiones.length}`);
  console.log(
    `  TOMAR                        ${tomadas.length}  (${((100 * tomadas.length) / decisiones.length).toFixed(2)}%)`,
  );
  console.log(
    `  NO TOMAR                     ${descartadas.length}  (${((100 * descartadas.length) / decisiones.length).toFixed(2)}%)`,
  );
  console.log(`    · por muestra insuficiente ${porMuestra.length}  (gate MUESTRA_INSUFICIENTE, muestra < ${MUESTRA_MINIMA})`);
  console.log(`    · por score bajo umbral    ${porScore.length}  (gate SCORE_BAJO_UMBRAL, score < ${UMBRAL})`);
  console.log(`  errores de Analytics         0  (backtest offline: no aplica, ver nota)`);
  console.log(
    `  score promedio               ${promedio === null ? 'n/d' : promedio.toFixed(2)}` +
      `  (sobre ${conScore.length} evaluaciones con evidencia)`,
  );

  console.log('\nDISTRIBUCIÓN DEL SCORE');
  for (const fila of distribucionScore(decisiones)) console.log(fila);

  console.log('\nRESULTADO HISTÓRICO');
  console.log(lineaGrupo('TOMAR', gTomar));
  console.log(lineaGrupo('NO TOMAR', gNoTomar));
  console.log(lineaGrupo('todas', gTodas));

  if (porTipo.size > 0) {
    console.log('\nTOMAR, por tipo de racha');
    for (const clave of [...porTipo.keys()].sort()) {
      console.log(lineaGrupo(clave, porTipo.get(clave)!));
    }
  }

  // Lo único que decide si el filtro sirvió: ¿la tasa de las tomadas es
  // mejor que la de todas, y la diferencia sobrevive a su propio error?
  if (gTomar.n > 0 && gNoTomar.n > 0) {
    const a = intervaloWilson(gTomar.n - gTomar.loss, gTomar.n);
    const b = intervaloWilson(gNoTomar.n - gNoTomar.loss, gNoTomar.n);
    const delta = 100 * (a.proporcion - b.proporcion);
    const se = Math.sqrt(
      (a.proporcion * (1 - a.proporcion)) / gTomar.n +
        (b.proporcion * (1 - b.proporcion)) / gNoTomar.n,
    );
    const z = se === 0 ? 0 : (a.proporcion - b.proporcion) / se;

    console.log('\nSEPARACIÓN TOMAR vs NO TOMAR');
    console.log(
      `  diferencia de tasa           ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pp   z=${z.toFixed(2)}` +
        `   ${Math.abs(z) >= 1.96 ? '(distinguible del ruido al 95%)' : '(NO distinguible del ruido al 95%)'}`,
    );
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const t0 = Date.now();

  try {
    // Mismos filtros que `Racha3TestEvidenceProvider`: se excluyen las
    // bloqueadas (el motor real no habría podido emitir ahí) y se INCLUYEN
    // las de integridad dudosa (se reportan aparte, no se esconden).
    const filas = await prisma.$queryRaw<
      {
        id: number;
        tipo_racha: 'PLAYER' | 'BANKER';
        confirmacion_en: Date;
        resuelta_en: Date;
        resultado_final: Resultado;
        integridad_ok: boolean;
      }[]
    >`
      SELECT o.id::int              AS id,
             o.tipo_racha,
             o.confirmacion_en,
             o.resuelta_en,
             o.resultado_final,
             o.integridad_ok
        FROM racha3_operaciones o
       WHERE o.estado = 'RESUELTA'
         AND o.resuelta_en IS NOT NULL
         AND o.bloqueada_por_operacion_previa = false
       ORDER BY o.confirmacion_en, o.id
    `;

    const oportunidades: Oportunidad[] = filas.map((f) => ({
      id: f.id,
      tipoRacha: f.tipo_racha,
      confirmacionEn: f.confirmacion_en,
      resueltaEn: f.resuelta_en,
      resultado: f.resultado_final,
      integridadOk: f.integridad_ok,
    }));

    if (oportunidades.length === 0) {
      console.log('No hay oportunidades resueltas en las tablas derivadas.');
      return;
    }

    console.log('BACKTEST — Racha 3 Test');
    console.log(
      `umbral=${UMBRAL}  muestraMinima=${MUESTRA_MINIMA}  ` +
        `condición del score = tipo_racha`,
    );
    console.log(
      `oportunidades resueltas y no bloqueadas: ${oportunidades.length}  ` +
        `(${oportunidades.filter((o) => !o.integridadOk).length} con integridad dudosa, incluidas)`,
    );
    console.log(
      `ventana: ${oportunidades[0].confirmacionEn.toISOString()} .. ` +
        `${oportunidades[oportunidades.length - 1].confirmacionEn.toISOString()}`,
    );

    // ── 1. Retrospectiva (CON fuga de información) ────────────────────────
    const totales = new Contadores();
    for (const o of oportunidades) {
      totales.sumar(o.tipoRacha, esAcierto(o.resultado));
    }

    const retrospectivas = oportunidades.map((o) => {
      const { aciertos, resueltas } = totales.de(o.tipoRacha);
      return decidir(o, aciertos, resueltas);
    });

    informe(
      'ANÁLISIS RETROSPECTIVO — CON FUGA DE INFORMACIÓN, NO ES UNA EXPECTATIVA',
      retrospectivas,
    );

    // ── 2. Walk-forward (sin fuga) ────────────────────────────────────────
    // Se recorren las oportunidades en orden de confirmación y, antes de
    // decidir sobre cada una, se incorporan a los conteos únicamente las que
    // ya estaban RESUELTAS en ese instante.
    const porResolucion = [...oportunidades].sort(
      (a, b) => a.resueltaEn.getTime() - b.resueltaEn.getTime() || a.id - b.id,
    );

    const acumulado = new Contadores();
    let siguiente = 0;
    const walkForward: Decision[] = [];

    for (const o of oportunidades) {
      const corte = o.confirmacionEn.getTime();
      while (
        siguiente < porResolucion.length &&
        porResolucion[siguiente].resueltaEn.getTime() < corte
      ) {
        const ya = porResolucion[siguiente];
        acumulado.sumar(ya.tipoRacha, esAcierto(ya.resultado));
        siguiente += 1;
      }

      const { aciertos, resueltas } = acumulado.de(o.tipoRacha);
      walkForward.push(decidir(o, aciertos, resueltas));
    }

    informe(
      'SIMULACIÓN TEMPORAL WALK-FORWARD — SIN FUGA DE INFORMACIÓN',
      walkForward,
    );

    // ── Comparación de las dos ────────────────────────────────────────────
    const tomarR = retrospectivas.filter((d) => d.tomar).length;
    const tomarW = walkForward.filter((d) => d.tomar).length;

    console.log(`\n${'═'.repeat(78)}`);
    console.log('POR QUÉ LAS DOS NO COINCIDEN');
    console.log('═'.repeat(78));
    console.log(
      `  TOMAR retrospectivo ${tomarR}  vs  TOMAR walk-forward ${tomarW}` +
        `  (diferencia ${tomarW - tomarR})`,
    );
    console.log(
      '  La retrospectiva conoce el resultado de oportunidades futuras; la',
    );
    console.log(
      '  walk-forward arranca sin evidencia y tarda en superar la muestra',
    );
    console.log(
      `  mínima (${MUESTRA_MINIMA}), así que descarta todo el tramo inicial del histórico.`,
    );
    console.log(
      '  Solo la segunda dice algo sobre lo que el sistema podía decidir en vivo.',
    );

    console.log('\nNOTAS');
    console.log(
      '  · "errores de Analytics = 0" es una propiedad del backtest, no del',
    );
    console.log(
      '    sistema en vivo: acá se lee la base una vez. En vivo, un fallo de',
    );
    console.log(
      '    Analytics produce NO TOMAR (gate ANALYTICS_SIN_EVIDENCIA).',
    );
    console.log(
      '  · El umbral se derivó de este mismo histórico. Ninguna de las dos',
    );
    console.log('    evaluaciones corrige esa fuga de diseño.');
    console.log(
      `  · Se excluyen las oportunidades con bloqueada_por_operacion_previa;`,
    );
    console.log(
      '    al filtrar, algunas dejarían de estar bloqueadas y este backtest no',
    );
    console.log('    las recupera (sesgo conocido, ver cabecera del script).');

    console.log(`\ntiempo total: ${Date.now() - t0} ms`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
