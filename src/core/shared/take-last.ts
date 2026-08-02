/**
 * Devuelve los últimos `count` elementos de `items`, en el mismo orden,
 * como un array de solo lectura e independiente del original.
 */
export function takeLast<T>(
  items: ReadonlyArray<T>,
  count: number,
): ReadonlyArray<T> {
  if (count <= 0 || items.length === 0) {
    return Object.freeze([]);
  }

  const safeCount = Math.min(count, items.length);
  return Object.freeze(items.slice(items.length - safeCount));
}
