import { OperationState } from '../enums/operation-state.enum';
import {
  formatBogotaDateHourLabel,
  fromBogotaWallClock,
  getBogotaHourBucketKey,
} from './report-clock';
import { calculateReportMetrics, rate } from './report-metrics.calculator';
import { ONE_HOUR_MS } from './reporting.constants';
import { OperationClosedRecord } from './types/operation-closed-record.type';
import { OperationOpenedRecord } from './types/operation-opened-record.type';
import {
  HourHighlight,
  SummaryMetricsSnapshot,
} from './types/summary-metrics-snapshot.type';

type HourBucket = {
  alertsSent: number;
  won: number;
  lost: number;
};

/**
 * Calcula el análisis completo del historial en memoria (sin ventana de
 * tiempo, a diferencia de calculateReportMetrics): rachas, martingalas,
 * porcentajes sobre victorias, ratio ganadas/perdidas y destacados por hora
 * de Bogotá. Función pura, sin estado — mismo criterio que el resto de
 * `reporting/`: recalcula todo desde cero a partir de los registros crudos.
 */
export function calculateSummaryMetrics(
  opened: ReadonlyArray<OperationOpenedRecord>,
  closed: ReadonlyArray<OperationClosedRecord>,
  processStartedAt: Date,
  now: Date,
): SummaryMetricsSnapshot {
  const base = calculateReportMetrics(opened, closed);
  const uptimeMs = now.getTime() - processStartedAt.getTime();
  const uptimeHours = Math.max(uptimeMs / ONE_HOUR_MS, 1);

  const sortedClosed = [...closed].sort(
    (a, b) => a.closedAt.getTime() - b.closedAt.getTime(),
  );

  let totalMartingalesUsed = 0;
  let bestWinStreak = 0;
  let worstLossStreak = 0;
  let runningWinStreak = 0;
  let runningLossStreak = 0;

  for (const record of sortedClosed) {
    totalMartingalesUsed += record.martingalesUsed;

    if (record.result === OperationState.WON) {
      runningWinStreak += 1;
      runningLossStreak = 0;
      bestWinStreak = Math.max(bestWinStreak, runningWinStreak);
    } else {
      runningLossStreak += 1;
      runningWinStreak = 0;
      worstLossStreak = Math.max(worstLossStreak, runningLossStreak);
    }
  }

  const currentStreak = deriveCurrentStreak(sortedClosed);

  const avgMartingalesPerWin =
    base.won > 0
      ? (base.martingaleOneWins * 1 + base.martingaleTwoWins * 2) / base.won
      : 0;

  const winLossRatio =
    base.lost === 0 ? (base.won > 0 ? Infinity : 0) : base.won / base.lost;

  const hourHighlights = calculateHourHighlights(opened, closed);

  return Object.freeze({
    ...base,
    uptimeMs,
    bestWinStreak,
    worstLossStreak,
    currentStreak,
    totalMartingalesUsed,
    avgMartingalesPerWin,
    directWinPctOfWins: rate(base.directWins, base.won),
    martingaleOneWinPctOfWins: rate(base.martingaleOneWins, base.won),
    martingaleTwoWinPctOfWins: rate(base.martingaleTwoWins, base.won),
    winLossRatio,
    alertsPerHourAvg: base.alertsSent / uptimeHours,
    avgEffectivenessPerHour: hourHighlights.avgEffectivenessPerHour,
    bestAlertsHour: hourHighlights.bestAlertsHour,
    bestEffectivenessHour: hourHighlights.bestEffectivenessHour,
    worstEffectivenessHour: hourHighlights.worstEffectivenessHour,
  });
}

function deriveCurrentStreak(
  sortedClosed: ReadonlyArray<OperationClosedRecord>,
): SummaryMetricsSnapshot['currentStreak'] {
  if (sortedClosed.length === 0) {
    return { result: 'NONE', length: 0 };
  }

  const lastResult = sortedClosed[sortedClosed.length - 1].result;
  let length = 0;

  for (let i = sortedClosed.length - 1; i >= 0; i--) {
    if (sortedClosed[i].result !== lastResult) {
      break;
    }
    length += 1;
  }

  return {
    result: lastResult === OperationState.WON ? 'WON' : 'LOST',
    length,
  };
}

function calculateHourHighlights(
  opened: ReadonlyArray<OperationOpenedRecord>,
  closed: ReadonlyArray<OperationClosedRecord>,
): {
  avgEffectivenessPerHour: number;
  bestAlertsHour?: HourHighlight;
  bestEffectivenessHour?: HourHighlight;
  worstEffectivenessHour?: HourHighlight;
} {
  const buckets = new Map<string, HourBucket>();

  for (const record of opened) {
    const key = getBogotaHourBucketKey(record.openedAt);
    const bucket = getOrCreateBucket(buckets, key);
    bucket.alertsSent += 1;
  }

  for (const record of closed) {
    const key = getBogotaHourBucketKey(record.closedAt);
    const bucket = getOrCreateBucket(buckets, key);
    if (record.result === OperationState.WON) {
      bucket.won += 1;
    } else {
      bucket.lost += 1;
    }
  }

  let bestAlertsHour: HourHighlight | undefined;
  let bestEffectivenessHour: HourHighlight | undefined;
  let worstEffectivenessHour: HourHighlight | undefined;
  let effectivenessSum = 0;
  let effectivenessCount = 0;

  for (const [key, bucket] of buckets) {
    if (!bestAlertsHour || bucket.alertsSent > bestAlertsHour.value) {
      bestAlertsHour = {
        label: formatBogotaDateHourLabel(bucketKeyToDate(key)),
        value: bucket.alertsSent,
      };
    }

    const closedInBucket = bucket.won + bucket.lost;
    if (closedInBucket > 0) {
      const effectivenessPct = rate(bucket.won, closedInBucket);
      effectivenessSum += effectivenessPct;
      effectivenessCount += 1;

      if (
        !bestEffectivenessHour ||
        effectivenessPct > bestEffectivenessHour.value
      ) {
        bestEffectivenessHour = {
          label: formatBogotaDateHourLabel(bucketKeyToDate(key)),
          value: effectivenessPct,
        };
      }
      if (
        !worstEffectivenessHour ||
        effectivenessPct < worstEffectivenessHour.value
      ) {
        worstEffectivenessHour = {
          label: formatBogotaDateHourLabel(bucketKeyToDate(key)),
          value: effectivenessPct,
        };
      }
    }
  }

  return {
    avgEffectivenessPerHour:
      effectivenessCount > 0 ? effectivenessSum / effectivenessCount : 0,
    bestAlertsHour,
    bestEffectivenessHour,
    worstEffectivenessHour,
  };
}

function getOrCreateBucket(
  buckets: Map<string, HourBucket>,
  key: string,
): HourBucket {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { alertsSent: 0, won: 0, lost: 0 };
    buckets.set(key, bucket);
  }
  return bucket;
}

/**
 * `getBogotaHourBucketKey` codifica año-mes-día+hora ya en el reloj de
 * Bogotá (no un instante UTC). `formatBogotaDateHourLabel` espera un
 * instante real y vuelve a aplicarle el offset de Bogotá internamente, así
 * que hay que revertirlo una vez aquí (`fromBogotaWallClock`) para no
 * desplazarlo dos veces.
 */
function bucketKeyToDate(key: string): Date {
  const [datePart, hourPart] = key.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const hour = Number(hourPart);
  return fromBogotaWallClock(new Date(Date.UTC(year, month - 1, day, hour)));
}
