import {
  Racha3TestContexto,
  Racha3TestEstadoAnalytics,
  Racha3TestEvidencia,
  Racha3TestGateEvaluado,
  Racha3TestNivel,
  Racha3TestParametros,
  Racha3TestScore,
} from './types/racha3-test.type';
import { intervaloWilson, Z_95 } from './wilson';

/**
 * Calcula el score de una oportunidad de Racha 3 Test.
 *
 * FUNCIÓN PURA. Mismos inputs → mismo output, siempre. Sin reloj, sin
 * aleatoriedad, sin estado oculto, sin I/O. Es lo que permite reproducir
 * cualquier decisión del histórico con sólo los datos que quedaron en el log.
 *
 * ─────────────────────────────────────────────────────────────────────
 * QUÉ PREGUNTA RESPONDE EL SCORE
 *
 *   "¿Qué tan respaldada está esta oportunidad por la evidencia histórica
 *    disponible?"
 *
 * NO responde "¿cuál es la probabilidad de que gane?". La diferencia no es
 * retórica: convertir una frecuencia histórica en una probabilidad
 * predictiva exige supuestos (independencia entre rondas, estacionariedad)
 * que estos datos no contienen. Por eso el score no se llama
 * `probabilidad`, `prediccion` ni `confianza`.
 *
 * ─────────────────────────────────────────────────────────────────────
 * FÓRMULA
 *
 *   p̂     = aciertos / resueltas                     (de CONTEOS crudos)
 *   IC95  = Wilson(aciertos, resueltas, z=1,959964)
 *   score = 100 × IC95.limiteInferior
 *
 * Y nada más. El score ES la tasa de acierto que sobrevive a la
 * incertidumbre de su propia muestra, expresada en porcentaje.
 *
 * Por qué un solo término y no una suma ponderada: el límite inferior ya
 * combina tasa y muestra sin pesos que justificar. Una tasa alta con
 * muestra chica produce un límite bajo por construcción. Agregar
 * "+ evidencia de muestra" sería contar la muestra dos veces.
 *
 * ─────────────────────────────────────────────────────────────────────
 * QUÉ NO ENTRA, Y POR QUÉ
 *
 * Se midió la capacidad discriminante de cada rasgo observable en el
 * instante de la confirmación (ver `ANALYTICS.md`):
 *
 *   tipo_racha            PLAYER 0,8925 vs BANKER 0,8659 · z=2,61 → ENTRA
 *   hora Colombia         2/24 horas fuera de 2σ = lo esperado por azar
 *   bloques horarios      0 celdas fuera de 2σ en 4h/6h/8h/12h
 *   distancia (7 buckets) todos |z| < 1,25 — completamente plano
 *   día de la semana      0/7 fuera de 2σ
 *   resultado anterior    tras LOSS 0,8780 vs tras acierto 0,8795 · z=−0,09
 *
 * Todos menos el primero son ruido. Entran al DEBUG como `contexto` con
 * peso 0 declarado, nunca al score.
 *
 * ─────────────────────────────────────────────────────────────────────
 * PENALIZACIONES: NINGUNA, Y ES DELIBERADO
 *
 * Las tres degradaciones candidatas no tienen magnitud justificable:
 *
 *   advertencia_muestra   redundante con el gate de muestra mínima (que es
 *                         más exigente). Se reporta como advertencia.
 *   distancia inexacta    sólo afecta campos de contexto (peso 0). Es
 *                         advertencia, no castigo al score.
 *   Analytics rezagado    el problema no es de grado sino de validez: si la
 *                         evidencia está vieja no se descuenta, se BLOQUEA.
 *
 * Restar puntos inventados por ellas habría producido un número más
 * "sofisticado" y menos defendible. Todo lo que degrada la decisión está
 * modelado como gate (bloquea) o advertencia (informa).
 *
 * ─────────────────────────────────────────────────────────────────────
 * GATES (bloquean con independencia del score)
 *
 *   ANALYTICS_SIN_EVIDENCIA      Analytics falló o no devolvió datos.
 *                                score = null. NUNCA un score favorable
 *                                por defecto.
 *   ANALYTICS_REZAGADO           jugadas sin procesar > máximo permitido.
 *   MUESTRA_INSUFICIENTE         muestra_n < mínimo. No se compensa con score.
 *   OPERACION_VIRTUAL_ABIERTA    ya hay una simulación en curso; el motor
 *                                real tampoco habría podido operar acá.
 *   SCORE_BAJO_UMBRAL            score < umbral.
 *
 * `tomar = true` exige que NINGÚN gate haya disparado.
 */
export function calcularRacha3TestScore(entrada: {
  readonly evidencia: Racha3TestEvidencia | null;
  readonly contexto: Racha3TestContexto;
  readonly estadoAnalytics: Racha3TestEstadoAnalytics;
  readonly operacionVirtualAbierta: boolean;
  readonly parametros: Racha3TestParametros;
}): Racha3TestScore {
  const { evidencia, contexto, estadoAnalytics, parametros } = entrada;
  const { umbralScore, muestraMinima, maxRezagoJugadas } = parametros;

  const razones: string[] = [];
  const advertencias: string[] = [];
  const traza: string[] = [];
  const gates: Racha3TestGateEvaluado[] = [];

  const contextoConPeso = { ...contexto, peso: 0 as const };

  // ---------- Gate 1: ¿hay evidencia? ----------
  const sinEvidencia =
    !estadoAnalytics.disponible ||
    evidencia === null ||
    evidencia.resueltas <= 0;

  gates.push({
    gate: 'ANALYTICS_SIN_EVIDENCIA',
    disparado: sinEvidencia,
    motivo: sinEvidencia
      ? (estadoAnalytics.error ??
        'Analytics no devolvió oportunidades resueltas para esta condición.')
      : 'Analytics devolvió evidencia utilizable.',
  });

  if (sinEvidencia) {
    razones.push(
      estadoAnalytics.error
        ? `Sin evidencia: ${estadoAnalytics.error}`
        : 'Sin evidencia histórica para esta condición.',
    );
    traza.push('1. Analytics: sin evidencia utilizable → score = null');
    traza.push(
      '2. Decisión: NO TOMAR (un fallo de evidencia nunca produce score favorable)',
    );

    return {
      score: null,
      umbral: umbralScore,
      nivel: 'SIN_EVIDENCIA',
      tomar: false,
      componentes: {
        historico: { aciertos: 0, resueltas: 0, tasaObservada: null },
        muestra: {
          muestraN: 0,
          minimoRequerido: muestraMinima,
          suficiente: false,
        },
        intervalo: null,
        contexto: contextoConPeso,
      },
      penalizaciones: [],
      gates,
      razones,
      advertencias,
      traza,
    };
  }

  // ---------- Fórmula ----------
  const ic = intervaloWilson(evidencia.aciertos, evidencia.resueltas, Z_95);
  // Un único redondeo, al final y a 2 decimales: hace el score legible sin
  // introducir deriva en pasos intermedios.
  const score = redondear2(100 * ic.limiteInferior);

  traza.push(
    `1. Analytics (condición "${evidencia.condicion}"): ` +
      `aciertos=${evidencia.aciertos} de resueltas=${evidencia.resueltas} ` +
      `(directa=${evidencia.directa} + mg1=${evidencia.mg1} + mg2=${evidencia.mg2}), ` +
      `perdidas=${evidencia.perdidas}`,
  );
  traza.push(
    `2. Tasa observada: p = ${evidencia.aciertos}/${evidencia.resueltas} = ${ic.proporcion.toFixed(8)}`,
  );
  traza.push(
    `3. IC95 Wilson (z=${ic.z.toFixed(6)}): centro=${ic.centro.toFixed(8)} ` +
      `margen=${ic.margen.toFixed(8)} → [${ic.limiteInferior.toFixed(8)}, ${ic.limiteSuperior.toFixed(8)}]`,
  );
  traza.push(
    `4. score = 100 × límite_inferior = 100 × ${ic.limiteInferior.toFixed(8)} = ${score}`,
  );
  traza.push(
    '5. Penalizaciones: ninguna (por diseño; ver el comentario de la calculadora)',
  );

  // ---------- Gates restantes ----------
  const rezagado = estadoAnalytics.jugadasSinProcesar > maxRezagoJugadas;
  gates.push({
    gate: 'ANALYTICS_REZAGADO',
    disparado: rezagado,
    motivo: `jugadas sin procesar = ${estadoAnalytics.jugadasSinProcesar}, máximo permitido = ${maxRezagoJugadas}`,
  });

  const muestraSuficiente = evidencia.muestraN >= muestraMinima;
  gates.push({
    gate: 'MUESTRA_INSUFICIENTE',
    disparado: !muestraSuficiente,
    motivo: `muestra_n = ${evidencia.muestraN}, mínimo requerido = ${muestraMinima}`,
  });

  gates.push({
    gate: 'OPERACION_VIRTUAL_ABIERTA',
    disparado: entrada.operacionVirtualAbierta,
    motivo: entrada.operacionVirtualAbierta
      ? 'Ya hay una operación virtual en curso: el motor real tampoco habría podido operar aquí.'
      : 'Sin operación virtual en curso.',
  });

  const superaUmbral = score >= umbralScore;
  gates.push({
    gate: 'SCORE_BAJO_UMBRAL',
    disparado: !superaUmbral,
    motivo: `score = ${score}, umbral = ${umbralScore}`,
  });

  traza.push(
    `6. Gates: ${gates.map((g) => `${g.gate}=${g.disparado ? 'BLOQUEA' : 'ok'}`).join(' · ')}`,
  );

  // ---------- Razones y advertencias ----------
  if (muestraSuficiente) {
    razones.push(
      `Muestra suficiente: ${evidencia.muestraN} oportunidades resueltas (mínimo ${muestraMinima}).`,
    );
  } else {
    razones.push(
      `Muestra insuficiente: ${evidencia.muestraN} < ${muestraMinima} oportunidades resueltas.`,
    );
  }

  if (superaUmbral) {
    razones.push(
      `Tasa defendible ${score} ≥ umbral ${umbralScore}: la evidencia respalda la oportunidad.`,
    );
  } else {
    razones.push(
      `Tasa defendible ${score} < umbral ${umbralScore}: la evidencia no alcanza para respaldarla.`,
    );
  }

  if (rezagado) {
    razones.push(
      `Analytics rezagado en ${estadoAnalytics.jugadasSinProcesar} jugadas: la evidencia no está al día.`,
    );
  }
  if (entrada.operacionVirtualAbierta) {
    razones.push('Hay una operación virtual abierta de esta misma estrategia.');
  }

  if (evidencia.advertenciaMuestra !== null) {
    advertencias.push(
      `Analytics advierte sobre el tamaño de muestra: ${evidencia.advertenciaMuestra}.`,
    );
  }
  if (!contexto.distanciaExacta) {
    advertencias.push(
      'La distancia desde la Racha 3 anterior no es exacta (hay jugadas sin procesar): ' +
        'es un dato de contexto con peso 0, no afecta al score.',
    );
  }
  if (contexto.columnaConCortePorGap === true) {
    advertencias.push(
      'La corrida empieza justo después de una discontinuidad del historial: su tercera ' +
        'jugada puede no ser la tercera real. No afecta al score (no hay muestra para medirlo).',
    );
  }
  if (evidencia.muestraIntegridadDudosa > 0) {
    advertencias.push(
      `La evidencia incluye ${evidencia.muestraIntegridadDudosa} oportunidad(es) con integridad dudosa ` +
        `sobre ${evidencia.resueltas}.`,
    );
  }

  const algunGate = gates.some((g) => g.disparado);
  const tomar = !algunGate;
  traza.push(`7. Decisión: ${tomar ? 'TOMAR' : 'NO TOMAR'}`);

  return {
    score,
    umbral: umbralScore,
    nivel: nivelDe(score, umbralScore),
    tomar,
    componentes: {
      historico: {
        aciertos: evidencia.aciertos,
        resueltas: evidencia.resueltas,
        tasaObservada: ic.proporcion,
      },
      muestra: {
        muestraN: evidencia.muestraN,
        minimoRequerido: muestraMinima,
        suficiente: muestraSuficiente,
      },
      intervalo: ic,
      contexto: contextoConPeso,
    },
    penalizaciones: [],
    gates,
    razones,
    advertencias,
    traza,
  };
}

/** Dos decimales, sin acumular error: un único redondeo al final. */
function redondear2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * `EN_UMBRAL` cubre el empate exacto (score === umbral), que por la regla
 * `score >= umbral` es TOMAR. Se distingue de `SOBRE_UMBRAL` para que un
 * caso al filo sea visible en el DEBUG en vez de parecer holgado.
 */
function nivelDe(score: number, umbral: number): Racha3TestNivel {
  if (score < umbral) return 'BAJO_UMBRAL';
  if (score === umbral) return 'EN_UMBRAL';
  return 'SOBRE_UMBRAL';
}
