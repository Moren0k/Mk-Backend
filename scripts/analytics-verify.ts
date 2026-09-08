/**
 * Verificación cruzada del dominio Analytics "Racha 3": TypeScript <-> SQL.
 *
 *   pnpm analytics:verify
 *
 * Reconstruye el histórico COMPLETO con el reconstructor de referencia en
 * TypeScript (`src/core/analytics/racha3-reference.ts`, que conduce la clase
 * `Operation` real del motor) y lo compara campo a campo contra lo que
 * dejaron en la base las funciones plpgsql. Después ejecuta las invariantes
 * V0..V11 del propio SQL.
 *
 * Criterio de aceptación: CERO diferencias y todas las invariantes en verde.
 *
 * Dos implementaciones independientes que llegan al mismo resultado es una
 * evidencia mucho más fuerte que una sola verificada contra sí misma. Y como
 * la referencia usa la `Operation` de producción, un cambio futuro en la
 * regla de martingala o en la neutralidad del TIE rompe esta verificación en
 * vez de dejar que Analytics y el motor diverjan en silencio.
 *
 * Solo LEE de la base. No ejecuta rebuild ni incremental: verifica el estado
 * que ya está persistido.
 */
import { PrismaClient } from '@prisma/client';

import { reconstruirRacha3 } from '../src/core/analytics/racha3-reference';
import { AnalyticsGame } from '../src/core/analytics/types/analytics-game.type';
import { WinnerType } from '../src/core/enums/winner-type.enum';

type Diferencia = { fila: string; campo: string; ts: unknown; sql: unknown };

const MAX_DIFERENCIAS_MOSTRADAS = 15;

/** Normaliza para comparar: BigInt/Date/number acaban en una cadena estable. */
function norm(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  // Cualquier otra cosa (un objeto inesperado) se serializa en vez de caer
  // en "[object Object]", que haría que dos valores distintos comparasen
  // iguales y la verificación diera un falso OK.
  return JSON.stringify(v) ?? '?';
}

function comparar(
  fila: string,
  esperado: Record<string, unknown>,
  real: Record<string, unknown>,
  diffs: Diferencia[],
): void {
  for (const campo of Object.keys(esperado)) {
    const a = norm(esperado[campo]);
    const b = norm(real[campo]);
    if (a !== b) diffs.push({ fila, campo, ts: a, sql: b });
  }
}

type Comprobacion = { nombre: string; ok: boolean; detalle?: string };

const n = (v: unknown): number => Number(v ?? 0);

/**
 * Comprueba que la capa de agregación de F6 sigue describiendo exactamente
 * lo que hay en `racha3_operaciones`, y que respeta las reglas que la hacen
 * interpretable: bloqueadas fuera por defecto, integridad dudosa visible,
 * toda tasa con su muestra, y frecuencia y hazard como magnitudes separadas.
 */
async function verificarAgregaciones(
  prisma: PrismaClient,
): Promise<Comprobacion[]> {
  const uno = async <T>(sql: string): Promise<T> =>
    (await prisma.$queryRawUnsafe<T[]>(sql))[0];
  const todas = async <T>(sql: string): Promise<T[]> =>
    prisma.$queryRawUnsafe<T[]>(sql);

  const base = await uno<Record<string, bigint>>(`
    SELECT count(*) total,
           count(*) FILTER (WHERE NOT bloqueada_por_operacion_previa) sin_bloq,
           count(*) FILTER (WHERE bloqueada_por_operacion_previa)     bloq,
           count(*) FILTER (WHERE NOT integridad_ok)                  integ,
           count(*) FILTER (WHERE resultado_final = 'LOSS')           loss
      FROM racha3_operaciones`);

  const def = await uno<Record<string, unknown>>(
    'SELECT * FROM racha3_resumen()',
  );
  const todo = await uno<Record<string, unknown>>(
    'SELECT * FROM racha3_resumen(NULL,NULL,NULL,true)',
  );
  const horas = await todas<Record<string, unknown>>(
    'SELECT * FROM racha3_por_hora(NULL,NULL,NULL,true)',
  );
  const dist = await todas<Record<string, unknown>>(
    "SELECT * FROM racha3_distribucion('jugadas')",
  );
  const hz = await todas<Record<string, unknown>>(
    'SELECT * FROM racha3_hazard_distancia()',
  );
  const perdidas = await todas<Record<string, unknown>>(
    "SELECT * FROM racha3_intervalos('PERDIDAS',NULL,NULL,NULL,true)",
  );

  // El conjunto en riesgo POR DISTANCIA, reconstruido con la misma
  // definición que usa `racha3_hazard_distancia`: cada intervalo de largo k
  // está en riesgo en cada d de 1..k, más la cola abierta desde la última
  // confirmación hasta el checkpoint.
  //
  // Se calcula por distancia y no por bucket a propósito. La versión
  // anterior de esta comprobación exigía que `casos_observados` decreciera
  // entre buckets, y eso NO es una invariante: los buckets tienen anchos
  // distintos (5, 5, 5, 5, 10, 20 y el último abierto), así que la suma de
  // un bucket ancho puede superar legítimamente la de uno estrecho. Se
  // cumplía por casualidad de los datos y ocultaba el defecto real. Lo que
  // la teoría del hazard sí obliga es que el conjunto en riesgo decrezca
  // con la distancia, y eso solo se ve por distancia.
  const riesgo = await todas<Record<string, unknown>>(`
    WITH s AS (
      SELECT jugadas AS k
        FROM racha3_serie_distancias('RACHA3', NULL, NULL, NULL, false, true)
    ),
    corte AS (
      SELECT COALESCE(
        (SELECT ultima_jugada_id FROM analytics_checkpoints WHERE proceso = 'racha3'),
        (SELECT max(id) FROM jugadas)) AS id
    ),
    cola AS (
      SELECT COALESCE((SELECT count(*) FROM jugadas j
                        WHERE j.id > (SELECT max(jugada_confirmacion_id) FROM racha3_operaciones)
                          AND j.id <= (SELECT id FROM corte)), 0)::integer AS m
    )
    SELECT d::int AS d,
           ((SELECT count(*) FROM s WHERE s.k >= d)
            + (CASE WHEN (SELECT m FROM cola) >= d THEN 1 ELSE 0 END)) AS en_riesgo
      FROM generate_series(1, GREATEST(
             COALESCE((SELECT max(k) FROM s), 0), (SELECT m FROM cola), 1)) d
     ORDER BY d`);

  // Capa de economía: los dos insumos que convierten una tasa histórica en
  // una decisión (`20260909010000_analytics_racha3_economia`).
  const lados = await uno<Record<string, unknown>>(
    'SELECT * FROM racha3_lados_jugadas()',
  );
  const economia = await uno<Record<string, unknown>>(`
    SELECT (SELECT sum(ties) FROM racha3_ties_por_nivel())      AS ties_por_nivel,
           (SELECT sum(ties_en_operacion) FROM racha3_operaciones
             WHERE estado = 'RESUELTA'
               AND NOT bloqueada_por_operacion_previa)          AS ties_declarados`);

  // Total de tiempo en riesgo observado, y de dónde puede salir: la suma de
  // los largos de los intervalos más la cola acotada. Es una identidad
  // exacta, y es la que delata si el hazard vuelve a contar jugadas que
  // Analytics todavía no procesó.
  const horizonte = await uno<Record<string, unknown>>(`
    WITH corte AS (
      SELECT COALESCE(
        (SELECT ultima_jugada_id FROM analytics_checkpoints WHERE proceso = 'racha3'),
        (SELECT max(id) FROM jugadas)) AS id
    )
    SELECT (SELECT COALESCE(sum(jugadas), 0)
              FROM racha3_serie_distancias('RACHA3', NULL, NULL, NULL, false, true))
             AS suma_intervalos,
           COALESCE((SELECT count(*) FROM jugadas j
                      WHERE j.id > (SELECT max(jugada_confirmacion_id) FROM racha3_operaciones)
                        AND j.id <= (SELECT id FROM corte)), 0) AS cola_acotada,
           COALESCE((SELECT count(*) FROM jugadas j
                      WHERE j.id > (SELECT id FROM corte)), 0)  AS sin_procesar`);

  const suma = (filas: Record<string, unknown>[], campo: string) =>
    filas.reduce((acc, f) => acc + Number(f[campo] ?? 0), 0);

  return [
    {
      nombre: 'las bloqueadas quedan fuera por defecto y se reportan',
      ok:
        n(def.total) === n(base.sin_bloq) &&
        n(def.muestra_bloqueadas_excluidas) === n(base.bloq),
      detalle: `default=${n(def.total)} excluidas=${n(def.muestra_bloqueadas_excluidas)}`,
    },
    {
      nombre: 'incluirlas explícitamente reproduce el total de la tabla',
      ok: n(todo.total) === n(base.total),
      detalle: `${n(todo.total)} de ${n(base.total)}`,
    },
    {
      nombre: 'la integridad dudosa se incluye pero queda visible',
      ok: n(todo.muestra_integridad_dudosa) === n(base.integ),
      detalle: `${n(todo.muestra_integridad_dudosa)} filas afectadas por huecos`,
    },
    {
      nombre: 'las cuatro tasas de resultado suman 1',
      ok:
        Math.abs(
          n(todo.tasa_directa) +
            n(todo.tasa_mg1) +
            n(todo.tasa_mg2) +
            n(todo.tasa_perdida) -
            1,
        ) < 0.0002,
    },
    {
      nombre: 'el denominador de las tasas son las resueltas, no el total',
      ok: n(todo.muestra_n) === n(todo.resueltas),
    },
    {
      nombre: 'las 24 horas presentes y su suma reproduce el total',
      ok: horas.length === 24 && suma(horas, 'total') === n(todo.total),
    },
    {
      nombre: 'toda hora trae muestra_n, y advertencia_muestra cuando toca',
      ok: horas.every(
        (h) =>
          h.muestra_n !== null &&
          n(h.muestra_n) < 100 === (h.advertencia_muestra !== null),
      ),
    },
    {
      nombre: 'la frecuencia histórica suma 1 (por hora y por bucket)',
      ok:
        Math.abs(suma(horas, 'frecuencia_historica') - 1) < 0.002 &&
        Math.abs(suma(dist, 'frecuencia_historica') - 1) < 0.002,
    },
    {
      nombre: 'el hazard es una magnitud distinta de la frecuencia',
      ok:
        Math.abs(suma(hz, 'tasa_empirica_condicionada') - 1) > 0.05 &&
        hz.every(
          (h) =>
            Number(h.tasa_empirica_condicionada) !==
            Number(h.frecuencia_historica),
        ),
      detalle: `suma hazard=${suma(hz, 'tasa_empirica_condicionada').toFixed(4)} vs frecuencia=1`,
    },
    {
      nombre:
        'los eventos del hazard son exactamente los intervalos observados',
      ok: suma(hz, 'eventos') === n(hz[0]?.muestra_n),
      detalle: `${suma(hz, 'eventos')}`,
    },
    {
      nombre: 'el conjunto en riesgo decrece con la distancia',
      ok: riesgo.every(
        (r, i) => i === 0 || n(r.en_riesgo) <= n(riesgo[i - 1].en_riesgo),
      ),
      detalle: `d=1..${riesgo.length}, riesgo(1)=${n(riesgo[0]?.en_riesgo)} → riesgo(${riesgo.length})=${n(riesgo[riesgo.length - 1]?.en_riesgo)}`,
    },
    {
      // Regresión del defecto corregido en
      // `20260908050000_analytics_racha3_hazard_corte`: la cola en riesgo se
      // contaba contra `jugadas` sin cota, así que cada jugada aún sin
      // procesar inflaba el bucket más lejano. Esta identidad lo detecta
      // aunque el rezago sea de una sola jugada.
      nombre: 'el hazard no cuenta jugadas posteriores al checkpoint',
      ok:
        suma(hz, 'casos_observados') ===
        n(horizonte.suma_intervalos) + n(horizonte.cola_acotada),
      detalle:
        `casos=${suma(hz, 'casos_observados')} = intervalos=${n(horizonte.suma_intervalos)}` +
        ` + cola=${n(horizonte.cola_acotada)}; ${n(horizonte.sin_procesar)} jugadas sin procesar quedan fuera`,
    },
    {
      // La descomposición de empates por nivel es la base del peaje que
      // mueve el punto de equilibrio, así que tiene que reproducir
      // exactamente el total que ya declara la tabla. Un COALESCE de más en
      // la cota superior contaría los empates de todo el historial: es el
      // mismo error que infló el hazard (ver 20260908050000).
      nombre: 'los empates por nivel de la escalera suman ties_en_operacion',
      ok:
        n(economia.ties_por_nivel) === n(economia.ties_declarados) &&
        n(economia.ties_por_nivel) > 0,
      detalle: `por nivel=${n(economia.ties_por_nivel)} declarado=${n(economia.ties_declarados)}`,
    },
    {
      nombre: 'la distribución de lados cuadra y se acota al checkpoint',
      ok:
        n(lados.banker) + n(lados.player) + n(lados.tie) === n(lados.total) &&
        n(lados.banker) + n(lados.player) === n(lados.no_tie) &&
        n(lados.corte_id) >= n(lados.total),
      detalle: `total=${n(lados.total)} no_tie=${n(lados.no_tie)} corte=${n(lados.corte_id)}`,
    },
    {
      nombre: 'los intervalos entre pérdidas son (#LOSS - 1)',
      ok: n(perdidas[0]?.muestra_n) === n(base.loss) - 1,
      detalle: `${n(perdidas[0]?.muestra_n)}`,
    },
  ];
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const t0 = Date.now();

  try {
    // ---------- 0. corte de comparación ----------
    // La ingesta sigue insertando jugadas mientras esto corre, así que
    // reconstruir desde TODAS las jugadas vivas y compararlo contra tablas
    // derivadas que llegan hasta el último incremental produce diferencias
    // que no son defectos, solo rezago. El corte correcto es el checkpoint:
    // exactamente el conjunto que el SQL declara haber procesado.
    const [checkpoint] = await prisma.$queryRawUnsafe<
      Array<{ ultima_jugada_id: bigint }>
    >(
      "SELECT ultima_jugada_id FROM analytics_checkpoints WHERE proceso = 'racha3'",
    );

    if (checkpoint === undefined) {
      console.error(
        '\nABORTA: no hay checkpoint para "racha3". Ejecutá `pnpm analytics:rebuild` primero.',
      );
      process.exitCode = 1;
      return;
    }
    const corte = checkpoint.ultima_jugada_id;

    // ---------- 1. entrada ----------
    const jugadas = await prisma.jugada.findMany({
      where: { id: { lte: corte } },
      orderBy: { id: 'asc' },
      select: { id: true, uuid: true, ganador: true, jugadaEn: true },
    });
    const posteriores = await prisma.jugada.count({
      where: { id: { gt: corte } },
    });
    console.log(
      `jugadas leídas: ${jugadas.length} (corte en la jugada ${corte})` +
        (posteriores > 0
          ? `; ${posteriores} posteriores al checkpoint quedan fuera de la comparación`
          : ''),
    );

    const desconocidos = jugadas.filter(
      (j) => !Object.values(WinnerType).includes(j.ganador as WinnerType),
    );
    if (desconocidos.length > 0) {
      console.error(
        `\nABORTA: ${desconocidos.length} jugada(s) con un \`ganador\` fuera de ` +
          `PLAYER/BANKER/TIE (ej. "${desconocidos[0].ganador}"). El filtro positivo de ` +
          `columnas las ignoraría en silencio; hay que decidir su semántica antes de confiar ` +
          `en ninguna estadística.`,
      );
      process.exitCode = 1;
      return;
    }

    const entrada: AnalyticsGame[] = jugadas.map((j) => ({
      id: j.id,
      uuid: j.uuid,
      winner: j.ganador as WinnerType,
      playedAt: j.jugadaEn,
    }));

    // ---------- 2. referencia TypeScript ----------
    const tRef = Date.now();
    const ref = reconstruirRacha3(entrada);
    console.log(
      `referencia TS: ${ref.columnas.length} columnas, ` +
        `${ref.oportunidades.length} oportunidades (${Date.now() - tRef} ms)`,
    );

    // ---------- 3. estado en la base ----------
    const colsSql = await prisma.columna.findMany({
      orderBy: { inicioJugadaId: 'asc' },
    });
    const opsSql = await prisma.racha3Operacion.findMany({
      orderBy: { jugadaConfirmacionId: 'asc' },
      include: { columna: { select: { inicioJugadaId: true } } },
    });
    console.log(
      `SQL:           ${colsSql.length} columnas, ${opsSql.length} oportunidades`,
    );

    const diffs: Diferencia[] = [];

    // ---------- 4. columnas ----------
    if (colsSql.length !== ref.columnas.length) {
      diffs.push({
        fila: 'columnas',
        campo: 'cantidad',
        ts: ref.columnas.length,
        sql: colsSql.length,
      });
    }
    const n = Math.min(colsSql.length, ref.columnas.length);
    for (let i = 0; i < n; i++) {
      const t = ref.columnas[i];
      const s = colsSql[i];
      comparar(
        `columna@${t.inicioJugadaId}`,
        {
          tipo: t.tipo,
          longitud: t.longitud,
          inicioJugadaId: t.inicioJugadaId,
          finJugadaId: t.finJugadaId,
          inicioEn: t.inicioEn,
          finEn: t.finEn,
          cortePorGap: t.cortePorGap,
          cerradaPorGap: t.cerradaPorGap,
        },
        s,
        diffs,
      );
    }

    // ---------- 5. oportunidades ----------
    if (opsSql.length !== ref.oportunidades.length) {
      diffs.push({
        fila: 'oportunidades',
        campo: 'cantidad',
        ts: ref.oportunidades.length,
        sql: opsSql.length,
      });
    }
    const m = Math.min(opsSql.length, ref.oportunidades.length);
    for (let i = 0; i < m; i++) {
      const t = ref.oportunidades[i];
      const s = opsSql[i];
      // El ancla hacia `columnas` se compara por su clave natural, nunca por
      // `columna_id`: ese id es efímero y cambia en cada reconstrucción.
      comparar(
        `oportunidad@${t.jugadaConfirmacionId}`,
        {
          tipoRacha: t.tipoRacha,
          apuesta: t.apuesta,
          jugadaInicioId: t.jugadaInicioId,
          jugadaConfirmacionId: t.jugadaConfirmacionId,
          jugadaDirectaId: t.jugadaDirectaId,
          jugadaMg1Id: t.jugadaMg1Id,
          jugadaMg2Id: t.jugadaMg2Id,
          jugadaResolucionId: t.jugadaResolucionId,
          inicioEn: t.inicioEn,
          confirmacionEn: t.confirmacionEn,
          resueltaEn: t.resueltaEn,
          estado: t.estado,
          resultadoFinal: t.resultadoFinal,
          maxMartingalas: t.maxMartingalas,
          duracionMs: t.duracionMs,
          jugadasEvaluadas: t.jugadasEvaluadas,
          tiesEnOperacion: t.tiesEnOperacion,
          jugadasDesdeAnterior: t.jugadasDesdeAnterior,
          columnasDesdeAnterior: t.columnasDesdeAnterior,
          segundosDesdeAnterior: t.segundosDesdeAnterior,
          horaColInicio: t.horaColInicio,
          horaColConfirmacion: t.horaColConfirmacion,
          horaColResolucion: t.horaColResolucion,
          bloqueadaPorOperacionPrevia: t.bloqueadaPorOperacionPrevia,
          integridadOk: t.integridadOk,
        },
        s,
        diffs,
      );
      comparar(
        `oportunidad@${t.jugadaConfirmacionId}`,
        { columnaInicioJugadaId: ref.columnas[t.columnaIndice].inicioJugadaId },
        { columnaInicioJugadaId: s.columna.inicioJugadaId },
        diffs,
      );
    }

    // ---------- 6. invariantes del propio SQL ----------
    const invariantes = await prisma.$queryRawUnsafe<
      Array<{
        invariante: string;
        descripcion: string;
        ok: boolean;
        fallos: bigint;
        ejemplo: string | null;
      }>
    >('SELECT * FROM analytics_racha3_validar()');

    console.log('\n--- INVARIANTES SQL ---');
    for (const v of invariantes) {
      console.log(
        `${v.ok ? '  ok  ' : ' FALLA'} ${v.invariante.padEnd(4)} ${v.descripcion}` +
          (v.ok ? '' : `\n         fallos=${v.fallos} ${v.ejemplo ?? ''}`),
      );
    }

    // ---------- 7. capa de agregación (F6) ----------
    // No basta con que las agregaciones "corran": tienen que seguir
    // describiendo exactamente lo que hay en las tablas. Estas comprobaciones
    // son las que detectarían que una vista empezó a contar otra cosa —
    // un filtro que se cuela, un denominador equivocado, una tasa que dejó
    // de acompañarse de su muestra.
    const agregaciones = await verificarAgregaciones(prisma);
    console.log('\n--- CAPA DE AGREGACIÓN (F6) ---');
    for (const a of agregaciones) {
      console.log(
        `${a.ok ? '  ok  ' : ' FALLA'} ${a.nombre}${a.detalle ? ' — ' + a.detalle : ''}`,
      );
    }

    // ---------- 8. resumen ----------
    const invariantesOk =
      invariantes.every((v) => v.ok) && agregaciones.every((a) => a.ok);
    console.log('\n--- COMPARACIÓN TS <-> SQL ---');
    if (diffs.length === 0) {
      console.log(
        '  ok   0 diferencias sobre ' +
          `${ref.columnas.length} columnas y ${ref.oportunidades.length} oportunidades`,
      );
    } else {
      console.log(` FALLA ${diffs.length} diferencia(s):`);
      for (const d of diffs.slice(0, MAX_DIFERENCIAS_MOSTRADAS)) {
        console.log(
          `         ${d.fila}.${d.campo}: ts=${String(d.ts)} sql=${String(d.sql)}`,
        );
      }
      if (diffs.length > MAX_DIFERENCIAS_MOSTRADAS) {
        console.log(
          `         ... y ${diffs.length - MAX_DIFERENCIAS_MOSTRADAS} más`,
        );
      }
    }

    console.log(`\ntiempo total: ${Date.now() - t0} ms`);
    if (diffs.length > 0 || !invariantesOk) {
      console.log('RESULTADO: FALLA');
      process.exitCode = 1;
    } else {
      console.log('RESULTADO: OK');
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
