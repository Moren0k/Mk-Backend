import {
  BOGOTA_UTC_OFFSET_HOURS,
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
export function fromBogotaWallClock(wallClock: Date): Date {
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

/** Etiqueta "HH:MM" en hora de Bogotá, para mostrar en los reportes. */
export function formatBogotaHourLabel(instant: Date): string {
  const bogota = toBogotaWallClock(instant);
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${pad(bogota.getUTCHours())}:${pad(bogota.getUTCMinutes())}`;
}

/**
 * Clave estable que identifica el bloque horario de Bogotá (día + hora) al
 * que pertenece `instant`. Pensada para agrupar registros de un historial
 * que puede abarcar varios días (a diferencia de `getBogotaHour`, que solo
 * da la hora 0-23 y mezclaría el mismo "14:00" de días distintos).
 */
export function getBogotaHourBucketKey(instant: Date): string {
  const bogota = toBogotaWallClock(instant);
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return (
    `${bogota.getUTCFullYear()}-${pad(bogota.getUTCMonth() + 1)}-` +
    `${pad(bogota.getUTCDate())}T${pad(bogota.getUTCHours())}`
  );
}

/** Etiqueta legible "DD/MM HH:00" (hora de Bogotá) para un bucket horario. */
export function formatBogotaDateHourLabel(instant: Date): string {
  const bogota = toBogotaWallClock(instant);
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${pad(bogota.getUTCDate())}/${pad(bogota.getUTCMonth() + 1)} ${pad(bogota.getUTCHours())}:00`;
}
