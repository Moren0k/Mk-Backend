import {
  BOGOTA_UTC_OFFSET_HOURS,
  DAILY_REPORT_HOUR,
  ONE_HOUR_MS,
  OPERATING_START_HOUR,
} from './reporting.constants';

/**
 * Desplaza un instante real a un `Date` cuyos campos UTC (`getUTCHours()`,
 * `getUTCDate()`, ...) representan la hora de reloj de Bogotá. Es el truco
 * estándar para hacer aritmética de timezone con offset fijo sin depender
 * de la zona horaria del host: nunca se usan getters/setters locales
 * (`getHours()`), siempre los UTC.
 */
function toBogotaWallClock(instant: Date): Date {
  return new Date(instant.getTime() + BOGOTA_UTC_OFFSET_HOURS * ONE_HOUR_MS);
}

/** Inversa de `toBogotaWallClock`: vuelve del reloj de Bogotá al instante real (UTC). */
function fromBogotaWallClock(wallClock: Date): Date {
  return new Date(wallClock.getTime() - BOGOTA_UTC_OFFSET_HOURS * ONE_HOUR_MS);
}

/**
 * Próximo instante real en el que da una hora en punto. El offset de
 * Bogotá es un número entero de horas, así que toda hora en punto UTC
 * coincide exactamente con una hora en punto de Bogotá: calcular ESTE
 * límite nunca requiere convertir de timezone, solo saber a qué hora local
 * corresponde después (ver `getBogotaHour`).
 */
export function getNextHourBoundary(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(next.getUTCHours() + 1, 0, 0, 0);
  return next;
}

/** Hora de reloj de Bogotá (0-23) del instante dado. */
export function getBogotaHour(instant: Date): number {
  return toBogotaWallClock(instant).getUTCHours();
}

/**
 * ¿El bloque horario que arrancó en `hourStart` cae dentro del horario
 * operativo del bot (10:00 a 24:00 hora de Bogotá)? El bloque que arranca a
 * las 23:00 termina exactamente a medianoche, así que alcanza con el límite
 * inferior: nunca hace falta comprobar un límite superior ni un
 * envolvimiento de medianoche.
 */
export function isOperatingHour(hourStart: Date): boolean {
  return getBogotaHour(hourStart) >= OPERATING_START_HOUR;
}

/** Próximo instante real en el que son las 22:00 hora de Bogotá (hoy o mañana). */
export function getNextDailyReportBoundary(now: Date): Date {
  const nowInBogota = toBogotaWallClock(now);
  const candidate = new Date(nowInBogota);
  candidate.setUTCHours(DAILY_REPORT_HOUR, 0, 0, 0);

  if (candidate.getTime() <= nowInBogota.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return fromBogotaWallClock(candidate);
}

/**
 * Instante real de las 10:00 hora de Bogotá del mismo día de calendario
 * (en Bogotá) que `instant`. Pensado para construir la ventana del reporte
 * diario a partir del instante en que este se dispara (~22:00 Bogotá).
 */
export function getDailyWindowStart(instant: Date): Date {
  const inBogota = toBogotaWallClock(instant);
  const start = new Date(inBogota);
  start.setUTCHours(OPERATING_START_HOUR, 0, 0, 0);
  return fromBogotaWallClock(start);
}

/** Etiqueta "HH:MM" en hora de Bogotá, para mostrar en los reportes. */
export function formatBogotaHourLabel(instant: Date): string {
  const bogota = toBogotaWallClock(instant);
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${pad(bogota.getUTCHours())}:${pad(bogota.getUTCMinutes())}`;
}
