/**
 * Colombia (America/Bogota) mantiene UTC-5 todo el año: no observa horario
 * de verano. Por eso un offset constante alcanza para todo el módulo de
 * reportes, sin necesidad de una librería de timezones (no hay reglas de
 * DST que mantener actualizadas ni un calendario de transiciones que
 * consultar).
 */
export const BOGOTA_UTC_OFFSET_HOURS = -5;

/** Hora de Bogotá en la que el bot empieza a operar (10:00 AM). */
export const OPERATING_START_HOUR = 10;

export const ONE_HOUR_MS = 60 * 60 * 1000;
