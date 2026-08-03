const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Formatea una duración en milisegundos como "Xd Yh Zmin" (omitiendo
 * unidades en cero), para mostrar el tiempo activo del sistema en el
 * resumen. No usa una librería de fechas: es la misma aritmética simple de
 * enteros que el resto de `reporting/` (ver report-clock.ts).
 */
export function formatDurationLabel(ms: number): string {
  const totalMinutes = Math.floor(ms / MS_PER_MINUTE);
  const days = Math.floor(ms / MS_PER_DAY);
  const hours = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours}h`);
  }
  parts.push(`${minutes}min`);

  return parts.join(' ');
}
