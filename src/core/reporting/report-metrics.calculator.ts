import { OperationState } from '../enums/operation-state.enum';
import { OperationClosedRecord } from './types/operation-closed-record.type';
import { OperationOpenedRecord } from './types/operation-opened-record.type';
import { ReportMetricsSnapshot } from './types/report-metrics-snapshot.type';

const PERCENTAGE_PRECISION = 100;

/**
 * Calcula las métricas de un reporte a partir de los registros crudos de
 * una ventana de tiempo. Función pura, sin estado: mismo patrón que
 * DistributionMetric (pull-based, recalcula desde cero cada vez) en vez de
 * acumular incrementalmente, porque acá el conjunto de entrada cambia con
 * cada ventana (horaria o diaria), no es un contador de toda la vida del
 * proceso.
 */
export function calculateReportMetrics(
  opened: ReadonlyArray<OperationOpenedRecord>,
  closed: ReadonlyArray<OperationClosedRecord>,
): ReportMetricsSnapshot {
  const alertsSent = opened.length;
  const closedOperations = closed.length;

  let won = 0;
  let lost = 0;
  let directWins = 0;
  let martingaleOneWins = 0;
  let martingaleTwoWins = 0;
  let martingalesExhausted = 0;

  for (const record of closed) {
    if (record.result === OperationState.WON) {
      won += 1;

      if (record.martingalesUsed === 0) {
        directWins += 1;
      } else if (record.martingalesUsed === 1) {
        martingaleOneWins += 1;
      } else if (record.martingalesUsed === 2) {
        martingaleTwoWins += 1;
      }
    } else {
      lost += 1;

      if (record.martingalesUsed >= record.maxMartingales) {
        martingalesExhausted += 1;
      }
    }
  }

  return Object.freeze({
    alertsSent,
    closedOperations,
    won,
    lost,
    effectivenessPct: rate(won, closedOperations),
    directWins,
    martingaleOneWins,
    martingaleTwoWins,
    martingalesExhausted,
    distribution: Object.freeze({
      directPct: rate(directWins, closedOperations),
      martingaleOnePct: rate(martingaleOneWins, closedOperations),
      martingaleTwoPct: rate(martingaleTwoWins, closedOperations),
      lostPct: rate(lost, closedOperations),
    }),
  });
}

function rate(count: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  const value = (count / total) * PERCENTAGE_PRECISION;
  return Math.round(value * PERCENTAGE_PRECISION) / PERCENTAGE_PRECISION;
}
