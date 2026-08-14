/**
 * Forma cruda de una ronda tal como la entrega la API de Tipminer, tanto en
 * el endpoint de historial como en el stream SSE (ver API.md).
 *
 * El stream SSE no incluye `version` ni `externalId`. Todos los campos se
 * tipan de forma laxa a propósito: es responsabilidad de GameMapper validar
 * que el contenido real cumpla lo esperado antes de convertirlo en Game.
 */
export type GameDto = {
  readonly uuid?: unknown;
  readonly type?: unknown;
  readonly result?: unknown;
  readonly instant?: unknown;
  readonly version?: unknown;
  readonly externalId?: unknown;
};
