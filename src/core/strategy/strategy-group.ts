/**
 * A qué contexto de negocio pertenece un dato: "oficial" (producción) o
 * "pruebas" (corre en paralelo, sus resultados nunca deben mezclarse con
 * los de producción, ni en Telegram, ni en reportes, ni en la API).
 *
 * Este tipo ya no lleva asociada ninguna función de resolución estática:
 * el contexto de una `Operation` se decide una única vez, en el instante en
 * que se dispara su señal (ver `StrategyTrigger` en
 * `core/strategy/types/strategy-signal.type.ts` y `StrategyCoordinator`),
 * a partir del canal vigente en `StrategyChannelRegistry` en ese momento —
 * y queda grabado como propiedad propia e inmutable de la operación. Nunca
 * se vuelve a derivar de `strategyId` después de ese instante: la
 * estrategia puede cambiar de canal, o incluso desaparecer, sin que eso
 * altere el contexto de una operación ya abierta o ya cerrada.
 */
export type StrategyGroup = 'oficial' | 'pruebas';
