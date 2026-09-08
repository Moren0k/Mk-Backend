import { NotificationChannelType } from '../enums/notification-channel-type.enum';
import { NotificationSeverity } from '../enums/notification-severity.enum';
import {
  createNotification,
  Notification,
} from '../notification/notification.type';
import {
  Racha3TestEvaluacion,
  Racha3TestResolucion,
  RACHA3_TEST_ID,
} from './types/racha3-test.type';

/**
 * Construye los mensajes DEBUG de Racha 3 Test.
 *
 * Formato deliberadamente distinto al de las alertas reales: el prefijo 🧪 y
 * la palabra EXPERIMENTAL van primero para que nadie confunda uno de estos
 * mensajes con una señal operable, ni siquiera leyendo la notificación por
 * encima en el teléfono.
 *
 * `TelegramChannel` escapa el texto a MarkdownV2 por su cuenta
 * (`escapeMarkdownV2`), así que acá se escribe texto plano: cualquier
 * sintaxis de markdown terminaría escapada y visible.
 *
 * SOBRE DOS NOMBRES QUE SE PARECEN Y NO SON LO MISMO:
 *
 *   `tasa_acierto_condicionada`      aciertos/resueltas para la condición.
 *                                    ES la evidencia que alimenta el score.
 *   `tasa_empirica_condicionada`     el hazard del bucket de distancia, en
 *                                    el sentido que le da Analytics:
 *                                    "¿cuándo aparece la próxima Racha 3?".
 *                                    NO habla del resultado de esta apuesta
 *                                    y tiene peso 0.
 *
 * Aparecen las dos, con nombres distintos y en secciones distintas, porque
 * mezclarlas es el error más fácil de cometer con estos datos.
 */

const TITULO_TOMAR = '🧪 RACHA 3 TEST — TOMAR';
const TITULO_NO_TOMAR = '🧪 RACHA 3 TEST — NO TOMAR';
const TITULO_RESOLUCION = '🧪 RACHA 3 TEST — simulación resuelta';

const DIAS = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];

export function crearNotificacionRacha3Test(
  evaluacion: Racha3TestEvaluacion,
  channel: NotificationChannelType,
): Notification {
  const tomar = evaluacion.decision === 'TOMAR';

  return createNotification({
    title: tomar ? TITULO_TOMAR : TITULO_NO_TOMAR,
    message: cuerpo(evaluacion),
    severity: tomar ? NotificationSeverity.INFO : NotificationSeverity.WARNING,
    channel,
    metadata: {
      strategyId: RACHA3_TEST_ID,
      experimental: true,
      evaluacionId: evaluacion.evaluacionId,
      decision: evaluacion.decision,
      score: evaluacion.score.score,
    },
  });
}

export function crearNotificacionResolucionRacha3Test(
  resolucion: Racha3TestResolucion,
  channel: NotificationChannelType,
): Notification {
  const lineas = [
    'EXPERIMENTAL — operación VIRTUAL, no fue una apuesta real.',
    '',
    `Evaluación: ${resolucion.evaluacionId}`,
    `Racha: ${resolucion.tipoRacha} → apuesta ${resolucion.apuesta}`,
    `Score con el que se tomó: ${resolucion.score ?? 'n/d'}`,
    '',
    `Resultado simulado: ${resolucion.resultado}`,
    `Jugadas evaluadas: ${resolucion.jugadasEvaluadas} (empates neutrales: ${resolucion.ties})`,
    `Resuelta: ${resolucion.resueltaEn.toISOString()}`,
  ];

  return createNotification({
    title: TITULO_RESOLUCION,
    message: lineas.join('\n'),
    severity: NotificationSeverity.INFO,
    channel,
    metadata: {
      strategyId: RACHA3_TEST_ID,
      experimental: true,
      evaluacionId: resolucion.evaluacionId,
      resultadoSimulado: resolucion.resultado,
    },
  });
}

function cuerpo(e: Racha3TestEvaluacion): string {
  const s = e.score;
  const ev = e.evidencia;
  const ctx = s.componentes.contexto;
  const ic = s.componentes.intervalo;

  const L: string[] = [];

  L.push('EXPERIMENTAL — no operar. Esta estrategia no crea apuestas reales.');
  L.push('');
  L.push(
    `Señal: racha ${e.ganadorRacha} de ${e.longitudRacha} → apostar ${e.apuestaSugerida}`,
  );
  L.push(`Estado: ${e.decision === 'TOMAR' ? 'TOMAR' : 'NO TOMAR'}`);
  L.push(
    s.score === null
      ? `Score: sin evidencia (umbral ${s.umbral})`
      : `Score: ${s.score} / 100 · umbral ${s.umbral} · nivel ${s.nivel}`,
  );

  // ---------- EVIDENCIA (lo que sí pesa) ----------
  L.push('');
  L.push('EVIDENCIA (alimenta el score)');
  if (ev === null) {
    L.push('• No se pudo obtener evidencia de Analytics.');
  } else {
    L.push(`• Condición: ${ev.condicion}`);
    L.push(`• Muestra (muestra_n): ${ev.resueltas} oportunidades resueltas`);
    L.push(
      `• Aciertos: ${ev.aciertos} (directa ${ev.directa} + mg1 ${ev.mg1} + mg2 ${ev.mg2}) · pérdidas ${ev.perdidas}`,
    );
    L.push(
      `• tasa_acierto_condicionada: ${s.componentes.historico.tasaObservada?.toFixed(6) ?? 'n/d'}`,
    );
    if (ic !== null) {
      L.push(
        `• IC95 Wilson: [${ic.limiteInferior.toFixed(6)}, ${ic.limiteSuperior.toFixed(6)}]`,
      );
      L.push(
        `• limite_inferior_ic95: ${ic.limiteInferior.toFixed(6)} → score ${s.score}`,
      );
    }
    L.push(`• advertencia_muestra: ${ev.advertenciaMuestra ?? 'no'}`);
    L.push(
      `• Ventana de la evidencia: ${acortarFecha(ev.ventanaDesde)} a ${acortarFecha(ev.ventanaHasta)}`,
    );
    L.push(
      `• Excluidas de la evidencia: ${ev.muestraBloqueadasExcluidas} bloqueadas · ` +
        `${ev.muestraIntegridadDudosa} con integridad dudosa incluidas`,
    );
  }

  // ---------- CONTEXTO (peso 0) ----------
  L.push('');
  L.push('CONTEXTO (observado, peso 0 — no alimenta el score)');
  L.push(
    `• distancia_actual: ${ctx.distanciaActual ?? 'n/d'} jugadas (exacta: ${ctx.distanciaExacta ? 'sí' : 'no'})`,
  );
  L.push(`• bucket_distancia: ${ctx.bucketDistancia ?? 'n/d'}`);
  L.push(
    `• tasa_empirica_condicionada del bucket (hazard, "cuándo aparece la próxima", ` +
      `no "si gana"): ${ctx.hazardBucket?.toFixed(4) ?? 'n/d'}`,
  );
  L.push(
    `• frecuencia_historica del bucket: ${ctx.frecuenciaHistoricaBucket?.toFixed(4) ?? 'n/d'}`,
  );
  L.push(`• hora_colombia: ${String(ctx.horaColombia).padStart(2, '0')}`);
  L.push(`• dia_semana: ${DIAS[ctx.diaSemana] ?? ctx.diaSemana}`);
  L.push(
    `• columna con corte_por_gap: ${ctx.columnaConCortePorGap === null ? 'n/d' : ctx.columnaConCortePorGap ? 'sí' : 'no'}`,
  );
  L.push(
    '  (medidos sobre el histórico: hora, día y distancia no discriminan el resultado)',
  );

  // ---------- COMPONENTES ----------
  L.push('');
  L.push('COMPONENTES DEL SCORE');
  L.push(
    `• histórico: ${s.componentes.historico.aciertos}/${s.componentes.historico.resueltas}` +
      (ic !== null ? ` → IC95 inferior ${ic.limiteInferior.toFixed(6)}` : ''),
  );
  L.push(
    `• muestra: ${s.componentes.muestra.muestraN} / mínimo ${s.componentes.muestra.minimoRequerido}` +
      ` → ${s.componentes.muestra.suficiente ? 'suficiente' : 'INSUFICIENTE'}`,
  );
  L.push('• contexto: peso 0 por diseño');
  L.push(
    s.penalizaciones.length === 0
      ? '• penalizaciones: ninguna (todo lo que degrada la decisión es un gate)'
      : `• penalizaciones: ${s.penalizaciones.map((p) => `${p.concepto} ${p.puntos}`).join(', ')}`,
  );

  // ---------- ESTADO DE ANALYTICS ----------
  L.push('');
  L.push('ESTADO DE ANALYTICS');
  L.push(`• disponible: ${e.estadoAnalytics.disponible ? 'sí' : 'NO'}`);
  L.push(
    `• rezago: ${e.estadoAnalytics.jugadasSinProcesar} jugadas sin procesar`,
  );
  L.push(
    `• oportunidades en el histórico: ${e.estadoAnalytics.totalOportunidades}`,
  );
  if (e.estadoAnalytics.error !== null) {
    L.push(`• error: ${e.estadoAnalytics.error}`);
  }

  // ---------- GATES ----------
  L.push('');
  L.push('GATES');
  for (const g of s.gates) {
    L.push(`${g.disparado ? '✗' : '✓'} ${g.gate}: ${g.motivo}`);
  }

  // ---------- RAZONES ----------
  L.push('');
  L.push('RAZONES');
  for (const r of s.razones) L.push(`• ${r}`);

  if (s.advertencias.length > 0) {
    L.push('');
    L.push('ADVERTENCIAS');
    for (const a of s.advertencias) L.push(`• ${a}`);
  }

  // ---------- TRAZA ----------
  L.push('');
  L.push('TRAZA (verificable a mano)');
  for (const t of s.traza) L.push(t);

  // ---------- CIERRE ----------
  L.push('');
  L.push(
    e.decision === 'TOMAR'
      ? 'Resultado: TOMAR (se abre una operación VIRTUAL; no se apuesta nada)'
      : `Resultado: NO TOMAR (descartada por ${s.gates
          .filter((g) => g.disparado)
          .map((g) => g.gate)
          .join(', ')})`,
  );
  L.push('');
  L.push(`evaluacionId: ${e.evaluacionId}`);
  L.push(`triggerGameUuid: ${e.triggerGameUuid}`);
  L.push(`evaluada: ${e.evaluadaEn.toISOString()}`);

  return L.join('\n');
}

function acortarFecha(iso: string | null): string {
  return iso === null ? 'n/d' : iso.slice(0, 16).replace('T', ' ');
}
