import { WinnerType } from '../enums/winner-type.enum';
import { Game } from '../history/game.type';
import { OperationState } from '../enums/operation-state.enum';
import { Operation } from '../operation/operation.entity';
import { AnalyticsGame } from './types/analytics-game.type';
import {
  ColumnaRef,
  OportunidadRef,
  Racha3Estado,
  Racha3Reconstruccion,
  Racha3Resultado,
} from './types/racha3-reference.type';

/**
 * Reconstructor de referencia de Analytics "Racha 3", en TypeScript puro.
 *
 * NO es la implementación de producción: el procesamiento real vive en las
 * funciones plpgsql `analytics_racha3_rebuild()` / `_incremental()`. Esta
 * existe para VALIDARLAS: `pnpm analytics:verify` reconstruye el histórico
 * completo con este código y exige coincidencia campo a campo con lo que
 * produjo el SQL. Dos implementaciones independientes que llegan al mismo
 * resultado es una evidencia mucho más fuerte que una sola verificada
 * contra sí misma.
 *
 * La parte crítica no está duplicada a propósito: la máquina de estados de
 * la operación (martingalas, TIE neutral, victoria/derrota) NO se
 * reimplementa aquí — se conduce la clase `Operation` REAL del motor. Si
 * alguien cambia la regla de martingala o la neutralidad del TIE, este
 * reconstructor cambia con ella y la comparación contra el SQL falla en CI.
 * Esa es exactamente la señal que se quiere: Analytics y el motor no pueden
 * divergir en silencio.
 *
 * Lo que sí está reimplementado (columnas, cortes por gap, derivados) es
 * lógica que el motor no tiene, porque el motor solo mira las últimas 200
 * jugadas en memoria y nunca construyó el concepto de columna.
 */

/** Umbral de discontinuidad temporal por defecto: 120 s. */
export const UMBRAL_GAP_MS_DEFECTO = 120_000;

/** Zona horaria única para toda la analítica horaria. */
export const ZONA_HORARIA = 'America/Bogota';

const OPUESTO: Readonly<Record<string, WinnerType>> = {
  [WinnerType.PLAYER]: WinnerType.BANKER,
  [WinnerType.BANKER]: WinnerType.PLAYER,
};

/**
 * Hora del día (0-23) en `America/Bogota`.
 *
 * Se resuelve con `Intl` y el NOMBRE de la zona, nunca sumando o restando
 * horas: es el equivalente exacto de `EXTRACT(hour FROM ts AT TIME ZONE
 * 'America/Bogota')` en PostgreSQL, y no depende de la zona horaria de la
 * máquina que corre el proceso.
 */
const FORMATO_HORA = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_HORARIA,
  hour: 'numeric',
  hourCycle: 'h23',
});

export function horaColombia(instante: Date): number {
  return Number.parseInt(FORMATO_HORA.format(instante), 10);
}

function esPlayerOBanker(winner: WinnerType): boolean {
  // Filtro POSITIVO, igual que el SQL. Nunca `!== TIE`: si apareciera un
  // valor desconocido, tratarlo como PLAYER/BANKER fabricaría oportunidades
  // que nunca existieron. La invariante V0 del SQL lo detecta aparte.
  return winner === WinnerType.PLAYER || winner === WinnerType.BANKER;
}

/** `AnalyticsGame` -> `Game`, la forma que consume `Operation.update()`. */
function aGame(j: AnalyticsGame): Game {
  return { uuid: j.uuid, winner: j.winner, score: 0, playedAt: j.playedAt };
}

/**
 * Corta el historial en columnas. Además del cambio de ganador, corta ante
 * una discontinuidad temporal mayor al umbral: a través de un hueco no hay
 * evidencia de qué pasó, así que fusionar sería inventar una corrida.
 * Consecuencia deliberada: pueden quedar dos columnas adyacentes del mismo
 * tipo, y es válido si y solo si la segunda tiene `cortePorGap`.
 */
export function construirColumnas(
  jugadas: readonly AnalyticsGame[],
  umbralGapMs: number = UMBRAL_GAP_MS_DEFECTO,
): { columnas: ColumnaRef[]; gapAntes: boolean[] } {
  // `Array.from`, no `new Array(n).fill(false)`: este último devuelve `any[]`
  // y pierde el tipado del arreglo.
  const gapAntes: boolean[] = Array.from(
    { length: jugadas.length },
    () => false,
  );
  const crudas: Array<{
    tipo: WinnerType;
    desde: number;
    hasta: number;
    cortePorGap: boolean;
  }> = [];

  for (let i = 0; i < jugadas.length; i++) {
    const j = jugadas[i];
    const previa = i > 0 ? jugadas[i - 1] : undefined;
    const hayGap =
      previa !== undefined &&
      j.playedAt.getTime() - previa.playedAt.getTime() > umbralGapMs;
    gapAntes[i] = hayGap;

    const actual = crudas[crudas.length - 1];
    if (actual !== undefined && actual.tipo === j.winner && !hayGap) {
      actual.hasta = i;
    } else {
      crudas.push({ tipo: j.winner, desde: i, hasta: i, cortePorGap: hayGap });
    }
  }

  const columnas = crudas.map((c, idx) => ({
    tipo: c.tipo,
    longitud: c.hasta - c.desde + 1,
    inicioJugadaId: jugadas[c.desde].id,
    finJugadaId: jugadas[c.hasta].id,
    inicioEn: jugadas[c.desde].playedAt,
    finEn: jugadas[c.hasta].playedAt,
    cortePorGap: c.cortePorGap,
    // Termina en gap si la SIGUIENTE empieza por gap. La última queda en
    // false: todavía no hay jugada posterior que lo determine.
    cerradaPorGap: crudas[idx + 1]?.cortePorGap ?? false,
  }));

  return { columnas, gapAntes };
}

/**
 * Reconstruye columnas y oportunidades Racha 3 sobre un historial completo
 * ordenado cronológicamente (equivalente a `ORDER BY id`).
 */
export function reconstruirRacha3(
  jugadas: readonly AnalyticsGame[],
  opciones: { umbralGapMs?: number; maxMartingalas?: number } = {},
): Racha3Reconstruccion {
  const umbralGapMs = opciones.umbralGapMs ?? UMBRAL_GAP_MS_DEFECTO;
  const maxMartingalas = opciones.maxMartingalas ?? 2;

  const { columnas, gapAntes } = construirColumnas(jugadas, umbralGapMs);
  const indicePorId = new Map<string, number>();
  jugadas.forEach((j, i) => indicePorId.set(j.id.toString(), i));

  const oportunidades: OportunidadRef[] = [];
  let anterior: OportunidadRef | undefined;
  let anteriorColumnaIndice: number | undefined;
  let desde = 0; // índice de la primera jugada de la columna en curso

  for (let ci = 0; ci < columnas.length; ci++) {
    const col = columnas[ci];
    const inicioIdx = desde;
    desde += col.longitud;

    if (!esPlayerOBanker(col.tipo) || col.longitud < 3) {
      continue;
    }

    const confIdx = inicioIdx + 2; // la 3.ª jugada confirma la racha
    const confirmacion = jugadas[confIdx];
    const apuesta = OPUESTO[col.tipo];

    // ---- máquina de estados REAL del motor ----
    const operacion = Operation.open({
      triggered: true,
      strategyId: 'streak-3',
      strategyName: 'Streak3Strategy',
      triggeredAt: confirmacion.playedAt,
      recommendedWinner: apuesta,
      streakWinner: col.tipo,
      maxMartingales: maxMartingalas,
      triggerGameUuid: confirmacion.uuid,
      reason: '',
      metadata: {},
      context: 'oficial',
    });

    const escalera: bigint[] = [];
    let ties = 0;
    let evaluadas = 0;
    let resolucionIdx: number | undefined;

    for (let k = confIdx + 1; k < jugadas.length; k++) {
      evaluadas += 1;
      const resultado = operacion.update(aGame(jugadas[k]));

      if (resultado.tieOccurred) {
        ties += 1;
        continue;
      }
      if (resultado.stateChanged) {
        escalera.push(jugadas[k].id);
      }
      if (resultado.completed) {
        resolucionIdx = k;
        break;
      }
    }

    const estadoFinal = operacion.currentState;
    const resuelta = resolucionIdx !== undefined;
    const resultadoFinal: Racha3Resultado | null = !resuelta
      ? null
      : estadoFinal === OperationState.LOST
        ? 'LOSS'
        : (['DIRECTA', 'MG1', 'MG2'][
            operacion.currentMartingale
          ] as Racha3Resultado);
    const estado: Racha3Estado = resuelta ? 'RESUELTA' : 'PENDIENTE';

    const resolucion =
      resolucionIdx !== undefined ? jugadas[resolucionIdx] : undefined;
    const resueltaEn = resolucion?.playedAt ?? null;

    // ---- derivados ----
    const jugadasDesdeAnterior =
      anterior === undefined
        ? null
        : confIdx - indicePorId.get(anterior.jugadaConfirmacionId.toString())!;
    const columnasDesdeAnterior =
      anteriorColumnaIndice === undefined ? null : ci - anteriorColumnaIndice;
    // Truncado, no redondeado: "segundos completos transcurridos". Los
    // instantes tienen precisión de milisegundos, así que redondear haría
    // que 723,6 s se reportara como 724. El SQL usa `trunc(EXTRACT(epoch
    // ...))` por la misma razón — `::integer` a secas redondea en
    // PostgreSQL, y esa asimetría es justo la que detectó la verificación
    // cruzada. La precisión exacta vive en `duracionMs` y en los timestamps.
    const segundosDesdeAnterior =
      anterior === undefined
        ? null
        : Math.trunc(
            (confirmacion.playedAt.getTime() -
              anterior.confirmacionEn.getTime()) /
              1000,
          );

    // El motor no habría podido alertar aquí: seguía abierta la operación
    // anterior. Si la anterior quedó PENDIENTE, por definición sigue abierta.
    const bloqueada =
      anterior !== undefined &&
      (anterior.estado === 'PENDIENTE' ||
        confirmacion.id <= anterior.jugadaResolucionId!);

    // Faltan rondas reales en la ventana: o la corrida arranca justo
    // después de un hueco, o hay un hueco entre su inicio y la resolución.
    const hastaIdx = resolucionIdx ?? jugadas.length - 1;
    let hayGapInterno = false;
    for (let k = inicioIdx + 1; k <= hastaIdx; k++) {
      if (gapAntes[k]) {
        hayGapInterno = true;
        break;
      }
    }

    const oportunidad: OportunidadRef = {
      columnaIndice: ci,
      tipoRacha: col.tipo,
      apuesta,
      jugadaInicioId: col.inicioJugadaId,
      jugadaConfirmacionId: confirmacion.id,
      jugadaDirectaId: escalera[0] ?? null,
      jugadaMg1Id: escalera[1] ?? null,
      jugadaMg2Id: escalera[2] ?? null,
      jugadaResolucionId: resolucion?.id ?? null,
      inicioEn: col.inicioEn,
      confirmacionEn: confirmacion.playedAt,
      resueltaEn,
      estado,
      resultadoFinal,
      maxMartingalas,
      duracionMs:
        resueltaEn === null
          ? null
          : resueltaEn.getTime() - confirmacion.playedAt.getTime(),
      jugadasEvaluadas: evaluadas,
      tiesEnOperacion: ties,
      jugadasDesdeAnterior,
      columnasDesdeAnterior,
      segundosDesdeAnterior,
      horaColInicio: horaColombia(col.inicioEn),
      horaColConfirmacion: horaColombia(confirmacion.playedAt),
      horaColResolucion: resueltaEn === null ? null : horaColombia(resueltaEn),
      bloqueadaPorOperacionPrevia: bloqueada,
      integridadOk: !(col.cortePorGap || hayGapInterno),
    };

    oportunidades.push(oportunidad);
    anterior = oportunidad;
    anteriorColumnaIndice = ci;
  }

  return { columnas, oportunidades };
}
