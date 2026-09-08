import { WinnerType } from '../enums/winner-type.enum';
import {
  calcularEquilibrio,
  evPorOperacion,
  tasaDeEscalera,
  ventajaPorUnidad,
  type TiesEnNivel,
} from './equilibrio';
import {
  TresAlTresContexto,
  TresAlTresEstadoAnalytics,
  TresAlTresEvidencia,
  TresAlTresGateEvaluado,
  TresAlTresLados,
  TresAlTresNivel,
  TresAlTresParametros,
  TresAlTresScore,
} from './types/tres-al-tres.type';
import { intervaloWilson, Z_95 } from './wilson';

/**
 * Calcula el score de una oportunidad de Racha 3 Test.
 *
 * FUNCIÓN PURA. Mismos inputs → mismo output, siempre. Sin reloj, sin
 * aleatoriedad, sin estado oculto, sin I/O. Es lo que permite reproducir
 * cualquier decisión del histórico con sólo los datos que quedaron en el log.
 *
 * ─────────────────────────────────────────────────────────────────────
 * QUÉ PREGUNTA RESPONDE
 *
 *   "¿Tiene esta apuesta expectativa positiva, siendo pesimista con la
 *    incertidumbre de la evidencia?"
 *
 * Es una pregunta distinta —y mucho más útil— que la del diseño anterior,
 * que preguntaba "¿está esta condición por encima del promedio histórico?".
 * Esa comparación era incoherente (el subgrupo contra el grupo que lo
 * contiene) y con dos categorías degeneraba en tautología: siempre tomaba
 * un lado y siempre rechazaba el otro. Ver `equilibrio.ts`.
 *
 * Sigue sin ser una probabilidad: el score es el límite inferior de un
 * intervalo de confianza sobre una tasa histórica. Por eso no se llama
 * `probabilidad`, `prediccion` ni `confianza`.
 *
 * ─────────────────────────────────────────────────────────────────────
 * DOS ESTIMACIONES, Y SE EXIGEN LAS DOS
 *
 *   DIRECTA   límite inferior IC95 de aciertos/resueltas sobre las
 *             oportunidades ya resueltas de este lado. No supone nada del
 *             proceso. Muestra: ~2.100 por lado.
 *
 *   MODELO    se estima ω = ventaja del lado apostado sobre `jugadas`
 *             (~39.000 rondas no-empate, 9× más muestra) y se propaga por
 *             `1 − (1−ω)^intentos`. Como esa función es monótona creciente
 *             en ω, transformar los extremos del IC de ω da el IC de la
 *             tasa sin aproximaciones. Supone rondas independientes.
 *
 * El score que decide es el MENOR de los dos, que es lo mismo que exigir
 * que ambos superen el umbral, y deja un único número comparable.
 *
 * Por qué no uno solo: la directa es la que no supone nada, pero con 2.100
 * casos su intervalo es ancho y llega a estar 2,2 errores estándar por
 * encima de lo que predice el modelo — es decir, puede venir con suerte. La
 * del modelo es mucho más precisa pero apoyada en independencia. Exigir las
 * dos evita confiar en la suerte de una y en el supuesto de la otra.
 *
 * ─────────────────────────────────────────────────────────────────────
 * EL UMBRAL
 *
 *   umbral = max(umbralMinimo, punto de equilibrio)
 *   punto de equilibrio = (pérdida + peaje_empates) / (pérdida + ganancia)
 *
 * Con la escalera 1-2-4 y el peaje medido, 87,983 %. Se calcula, no se
 * escribe a mano, y se mueve con los datos de COSTE — nunca con los de
 * acierto. Detalle completo en `equilibrio.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────
 * QUÉ NO ENTRA, Y POR QUÉ
 *
 * Se midió la capacidad discriminante de cada rasgo observable en el
 * instante de la confirmación, con test de dos proporciones contra el
 * complemento y corrección por comparaciones múltiples (41 comparaciones,
 * umbral de Bonferroni |z| > 3,23):
 *
 *   distancia en jugadas   (7 buckets)  mejor |z| = 1,62
 *   distancia en columnas  (6 buckets)  mejor |z| = 2,06
 *   bloque horario         (4 bloques)  mejor |z| = 1,10
 *   día de la semana       (7 días)     mejor |z| = 1,68
 *   resultado anterior                  |z| = 0,08
 *   oportunidades desde la última pérdida            todos |z| < 0,5
 *
 * No sobrevive NINGUNA. Y hay un argumento práctico además del
 * estadístico: condicionar cuesta muestra, y la muestra es lo que compra el
 * límite inferior. Partir por hora deja ~175 casos y hunde el score varios
 * puntos con la misma tasa. Añadirlos haría tomar MENOS apuestas, por
 * ruido.
 *
 * Estos rasgos entran al DEBUG como `contexto` con peso 0 declarado.
 *
 * ─────────────────────────────────────────────────────────────────────
 * PENALIZACIONES: NINGUNA, Y ES DELIBERADO
 *
 * Todo lo que degrada la decisión está modelado como gate (bloquea) o
 * advertencia (informa). El peaje de los empates, que antes se ignoraba, no
 * es una penalización al score: es un coste de la apuesta y por eso entra
 * en el umbral, donde se puede auditar contra la estructura de pago.
 *
 * ─────────────────────────────────────────────────────────────────────
 * GATES (bloquean con independencia del score)
 *
 *   ANALYTICS_SIN_EVIDENCIA      Analytics falló o no devolvió datos.
 *                                score = null. Nunca un score favorable
 *                                por defecto.
 *   MODELO_SIN_EVIDENCIA         faltan los conteos de `jugadas`.
 *   ANALYTICS_REZAGADO           jugadas sin procesar > máximo permitido.
 *   MUESTRA_INSUFICIENTE         muestra_n < mínimo. No se compensa.
 *   OPERACION_VIRTUAL_ABIERTA    ya hay una simulación en curso.
 *   SCORE_BAJO_UMBRAL            el menor de los dos scores < umbral.
 *
 * `tomar = true` exige que NINGÚN gate haya disparado.
 */
export function calcularTresAlTresScore(entrada: {
  readonly evidencia: TresAlTresEvidencia | null;
  readonly lados: TresAlTresLados | null;
  readonly tiesPorNivel: readonly TiesEnNivel[];
  readonly operacionesMedidas: number;
  readonly apuesta: WinnerType;
  readonly contexto: TresAlTresContexto;
  readonly estadoAnalytics: TresAlTresEstadoAnalytics;
  readonly operacionVirtualAbierta: boolean;
  readonly parametros: TresAlTresParametros;
}): TresAlTresScore {
  const { evidencia, lados, contexto, estadoAnalytics, apuesta, parametros } =
    entrada;
  const {
    umbralMinimo,
    muestraMinima,
    maxRezagoJugadas,
    escalera,
    devolucionTie,
    pagoAcierto,
  } = parametros;

  const razones: string[] = [];
  const advertencias: string[] = [];
  const traza: string[] = [];
  const gates: TresAlTresGateEvaluado[] = [];

  const contextoConPeso = { ...contexto, peso: 0 as const };
  const intentos = escalera.length;

  // ---------- Umbral: se calcula ANTES de mirar un solo acierto ----------
  const equilibrio = calcularEquilibrio(
    { escalera, devolucionTie, pagoAcierto },
    entrada.tiesPorNivel,
    entrada.operacionesMedidas,
  );
  const umbral = redondear2(
    100 * Math.max(umbralMinimo / 100, equilibrio.umbral),
  );

  traza.push(`1. Umbral (estructura de pago, no del historial de aciertos):`);
  for (const linea of equilibrio.traza) traza.push(`   ${linea}`);
  traza.push(
    `   umbral efectivo = max(mínimo ${umbralMinimo}, equilibrio ` +
      `${(100 * equilibrio.umbral).toFixed(3)}) = ${umbral}`,
  );

  if (equilibrio.operaciones === 0) {
    advertencias.push(
      'No hay operaciones medidas para calcular el peaje de los empates: el ' +
        'umbral cayó al equilibrio sin empates, que es el MENOS exigente.',
    );
  }

  const economiaBase = {
    perdidaPorFallo: equilibrio.perdidaPorFallo,
    gananciaPorAcierto: equilibrio.gananciaPorAcierto,
    devolucionTie,
    peajeTiePorOperacion: equilibrio.peajeTiePorOperacion,
    umbralSinTie: equilibrio.umbralSinTie,
    traza: equilibrio.traza,
  };

  // ---------- Gate: ¿hay evidencia directa? ----------
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

  // ---------- Gate: ¿hay evidencia para el modelo? ----------
  const sinModelo = lados === null || lados.noTie <= 0;
  gates.push({
    gate: 'MODELO_SIN_EVIDENCIA',
    // Solo bloquea si el modelo es exigido. Con `exigirModelo: false` la
    // ausencia de conteos de jugadas se reporta pero no descarta: decide la
    // estimación directa por su cuenta.
    disparado: sinModelo && parametros.exigirModelo,
    motivo: sinModelo
      ? 'Faltan los conteos de jugadas para estimar la ventaja del lado.'
      : `${lados.noTie} rondas no-empate disponibles.`,
  });

  if (sinEvidencia || (sinModelo && parametros.exigirModelo)) {
    razones.push(
      sinEvidencia
        ? estadoAnalytics.error
          ? `Sin evidencia directa: ${estadoAnalytics.error}`
          : 'Sin evidencia histórica para esta condición.'
        : 'Sin conteos de jugadas para la estimación por modelo.',
    );
    traza.push('2. Falta al menos una de las dos evidencias → score = null');
    traza.push(
      '3. Decisión: NO TOMAR (un fallo de evidencia nunca produce score favorable)',
    );

    return {
      score: null,
      scoreDirecto: null,
      scoreModelo: null,
      umbral,
      nivel: 'SIN_EVIDENCIA',
      tomar: false,
      economia: { ...economiaBase, evEstimado: null, ventajaPorUnidad: null },
      componentes: {
        historico: {
          aciertos: evidencia?.aciertos ?? 0,
          resueltas: evidencia?.resueltas ?? 0,
          tasaObservada: null,
        },
        muestra: {
          muestraN: evidencia?.muestraN ?? 0,
          minimoRequerido: muestraMinima,
          suficiente: false,
        },
        intervalo: null,
        modelo: null,
        contexto: contextoConPeso,
      },
      penalizaciones: [],
      gates,
      razones,
      advertencias,
      traza,
    };
  }

  // ---------- Estimación DIRECTA ----------
  const ic = intervaloWilson(evidencia.aciertos, evidencia.resueltas, Z_95);
  const scoreDirecto = redondear2(100 * ic.limiteInferior);

  traza.push(
    `2. DIRECTA — Analytics (condición "${evidencia.condicion}"): ` +
      `aciertos=${evidencia.aciertos} de resueltas=${evidencia.resueltas} ` +
      `(directa=${evidencia.directa} + mg1=${evidencia.mg1} + mg2=${evidencia.mg2}), ` +
      `perdidas=${evidencia.perdidas}`,
  );
  traza.push(
    `   p = ${evidencia.aciertos}/${evidencia.resueltas} = ${ic.proporcion.toFixed(8)}`,
  );
  traza.push(
    `   IC95 Wilson (z=${ic.z.toFixed(6)}) = [${ic.limiteInferior.toFixed(8)}, ` +
      `${ic.limiteSuperior.toFixed(8)}] → score directo = ${scoreDirecto}`,
  );

  // ---------- Estimación por MODELO ----------
  // Puede faltar: con `exigirModelo: false` la ausencia de conteos de
  // jugadas no descarta la oportunidad, solo deja esta estimación en null.
  const modelo =
    lados === null
      ? null
      : (() => {
          const gana =
            apuesta === WinnerType.BANKER ? lados.banker : lados.player;
          const pierde =
            apuesta === WinnerType.BANKER ? lados.player : lados.banker;
          const icOmega = intervaloWilson(gana, lados.noTie, Z_95);

          return {
            lado: apuesta,
            gana,
            pierde,
            empata: lados.tie,
            corteId: lados.corteId,
            noTie: lados.noTie,
            omega: icOmega.proporcion,
            intervaloOmega: icOmega,
            intentos,
            tasaEsperada: tasaDeEscalera(icOmega.proporcion, intentos),
            tasaLimiteInferior: tasaDeEscalera(
              icOmega.limiteInferior,
              intentos,
            ),
          };
        })();

  const scoreModelo =
    modelo === null ? null : redondear2(100 * modelo.tasaLimiteInferior);

  const ventaja =
    modelo === null
      ? null
      : ventajaPorUnidad({
          gana: modelo.gana,
          pierde: modelo.pierde,
          empata: modelo.empata,
          devolucionTie,
        });

  if (modelo === null) {
    traza.push(
      '3. MODELO — sin conteos de jugadas disponibles. No bloquea porque ' +
        'exigirModelo=false; decide la estimación directa.',
    );
  } else {
    traza.push(
      `3. MODELO — ventaja del lado ${apuesta} sobre jugadas (corte ${modelo.corteId}): ` +
        `gana=${modelo.gana} pierde=${modelo.pierde} empata=${modelo.empata}`,
    );
    traza.push(
      `   ω = ${modelo.gana}/${modelo.noTie} = ${modelo.omega.toFixed(8)} · ` +
        `IC95 = [${modelo.intervaloOmega.limiteInferior.toFixed(8)}, ${modelo.intervaloOmega.limiteSuperior.toFixed(8)}]`,
    );
    traza.push(
      `   tasa = 1 − (1−ω)^${intentos} → esperada ${(100 * modelo.tasaEsperada).toFixed(3)}%, ` +
        `límite inferior ${(100 * modelo.tasaLimiteInferior).toFixed(3)}% → score modelo = ${scoreModelo}`,
    );
    traza.push(
      `   ventaja por unidad apostada = ${ventaja!.toFixed(5)} ` +
        `(${(100 * ventaja!).toFixed(3)}%) — ninguna escalera la cambia`,
    );
  }

  // ---------- El score que decide ----------
  // Con `exigirModelo` decide el MENOR de los dos (equivale a exigir que
  // ambos superen el umbral); si no, decide la DIRECTA y la del modelo queda
  // como dato auditable en la traza y en el log.
  const score =
    parametros.exigirModelo && scoreModelo !== null
      ? Math.min(scoreDirecto, scoreModelo)
      : scoreDirecto;
  const evEstimado = evPorOperacion(score / 100, equilibrio);

  traza.push(
    parametros.exigirModelo
      ? `4. score = min(directa ${scoreDirecto}, modelo ${scoreModelo ?? 'n/d'}) = ${score} ` +
          '(exigir las dos ≡ exigirlo del mínimo)'
      : `4. score = directa ${scoreDirecto} (exigirModelo=false; la del modelo ` +
          `da ${scoreModelo ?? 'n/d'} y queda solo como referencia)`,
  );
  traza.push(
    `5. EV estimado = ${(score / 100).toFixed(6)}×${equilibrio.gananciaPorAcierto} − ` +
      `${(1 - score / 100).toFixed(6)}×${equilibrio.perdidaPorFallo} − ` +
      `${equilibrio.peajeTiePorOperacion.toFixed(5)} = ${evEstimado.toFixed(5)} unidades/operación`,
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

  const superaUmbral = score >= umbral;
  gates.push({
    gate: 'SCORE_BAJO_UMBRAL',
    disparado: !superaUmbral,
    motivo:
      `score = ${score} (directa ${scoreDirecto}, modelo ${scoreModelo}), ` +
      `umbral = ${umbral}`,
  });

  traza.push(
    `6. Gates: ${gates.map((g) => `${g.gate}=${g.disparado ? 'BLOQUEA' : 'ok'}`).join(' · ')}`,
  );

  // ---------- Razones ----------
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
      `Las dos estimaciones superan el equilibrio ${umbral}: la apuesta tiene ` +
        `expectativa positiva (${evEstimado.toFixed(4)} unidades/operación) incluso ` +
        `siendo pesimista con la incertidumbre.`,
    );
  } else {
    const cual =
      scoreModelo !== null && scoreDirecto < umbral && scoreModelo < umbral
        ? 'ninguna de las dos estimaciones'
        : scoreDirecto < umbral
          ? 'la estimación directa'
          : 'la estimación por modelo';
    razones.push(
      `${cual.charAt(0).toUpperCase()}${cual.slice(1)} alcanza el equilibrio ` +
        `${umbral} (directa ${scoreDirecto}, modelo ${scoreModelo}): la apuesta ` +
        `pierde ${Math.abs(evEstimado).toFixed(4)} unidades por operación.`,
    );
  }

  if (ventaja !== null && ventaja < 0) {
    razones.push(
      `La ventaja por unidad apostada del lado ${apuesta} es ${(100 * ventaja).toFixed(3)}%: ` +
        `negativa, y ninguna escalera de martingala la corrige.`,
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

  // ---------- Advertencias ----------
  if (evidencia.advertenciaMuestra !== null) {
    advertencias.push(
      `Analytics advierte sobre el tamaño de muestra: ${evidencia.advertenciaMuestra}.`,
    );
  }
  if (scoreModelo !== null && Math.abs(scoreDirecto - scoreModelo) > 1) {
    advertencias.push(
      `Las dos estimaciones difieren en ${Math.abs(scoreDirecto - scoreModelo).toFixed(2)} ` +
        `puntos (directa ${scoreDirecto}, modelo ${scoreModelo}). La directa tiene ~9× menos ` +
        `muestra, así que una diferencia grande suele significar que viene con suerte.`,
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

  const tomar = !gates.some((g) => g.disparado);
  traza.push(`7. Decisión: ${tomar ? 'TOMAR' : 'NO TOMAR'}`);

  return {
    score,
    scoreDirecto,
    scoreModelo,
    umbral,
    nivel: nivelDe(score, umbral),
    tomar,
    economia: {
      ...economiaBase,
      evEstimado,
      ventajaPorUnidad: ventaja,
    },
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
      modelo:
        modelo === null
          ? null
          : {
              lado: modelo.lado,
              gana: modelo.gana,
              pierde: modelo.pierde,
              empata: modelo.empata,
              omega: modelo.omega,
              intervaloOmega: modelo.intervaloOmega,
              intentos: modelo.intentos,
              tasaEsperada: modelo.tasaEsperada,
              tasaLimiteInferior: modelo.tasaLimiteInferior,
            },
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
function nivelDe(score: number, umbral: number): TresAlTresNivel {
  if (score < umbral) return 'BAJO_UMBRAL';
  if (score === umbral) return 'EN_UMBRAL';
  return 'SOBRE_UMBRAL';
}
