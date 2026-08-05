import { Strategy } from '../interfaces/strategy.interface';
import { StrategyContext } from '../types/strategy-context.type';
import { StrategyResult } from '../types/strategy-result.type';

const NO_SIGNAL: StrategyResult = Object.freeze({ triggered: false });

/**
 * PLANTILLA — Estrategia "alternancia34". Ver ARCHITECTURE.md §12 para la
 * guía completa de cómo crear una estrategia nueva; esto es un resumen
 * aplicado a esta en particular.
 *
 * Ya está completamente cableada al resto del sistema (registrada en
 * StrategyModule, clasificada como grupo "pruebas" en strategy-group.ts):
 * quien la implemente solo necesita escribir la lógica dentro de
 * `evaluate()` y, cuando esté probada, cambiar `enabled()` para que
 * devuelva `true`. No hace falta tocar ningún otro archivo — memoria,
 * guard de ejecución, envío de notificaciones, reportes y estadísticas ya
 * son genéricos por `strategyId` y recogen esta estrategia automáticamente
 * en cuanto empiece a generar señales.
 *
 * TODO(alternancia34): reemplazar esta descripción por la real una vez
 * definida la lógica de detección (p. ej. "recomienda seguir la alternancia
 * tras 3-4 cambios consecutivos de ganador").
 */
export class Alternancia34Strategy implements Strategy {
  readonly id = 'alternancia-34';
  readonly name = 'Alternancia34Strategy';
  readonly description = 'TODO(alternancia34): describir la estrategia.';

  /**
   * TODO(alternancia34): cambiar a `true` únicamente cuando `evaluate()`
   * esté implementado y probado (specs propios + suite completa en verde).
   * Mientras sea `false`, StrategyCoordinator nunca la evalúa: no genera
   * señales, no abre operaciones, no envía notificaciones.
   */
  enabled(): boolean {
    return false;
  }

  /**
   * TODO(alternancia34): implementar la detección real. Guía basada en el
   * mismo patrón que StreakStrategyBase (ver ese archivo para un ejemplo
   * completo):
   *
   * 1. Preguntar primero a `context.execution.canExecute(this.id)` — si es
   *    `false`, devolver NO_SIGNAL de inmediato, sin evaluar nada más.
   * 2. Leer `context.historySnapshot.getAll()` (o `.getLast(n)`) para
   *    reconstruir el patrón de alternancia vigente. Nunca acumular estado
   *    incrementalmente evento a evento: recalcular siempre desde el
   *    historial, así el criterio sobrevive un reinicio del proceso.
   * 3. Si el patrón no califica todavía, devolver NO_SIGNAL.
   * 4. Usar `context.runtimeState.get<T>(this.id)` /
   *    `context.runtimeState.set(this.id, value)` para recordar qué
   *    ocurrencia del patrón ya generó señal (aislado automáticamente por
   *    `this.id`, sin necesidad de ningún registro adicional) — evita
   *    volver a disparar mientras el mismo patrón se sigue extendiendo.
   * 5. Si corresponde disparar, devolver un `StrategySignal` completo:
   *    `triggered: true`, `strategyId: this.id`, `strategyName: this.name`,
   *    `triggeredAt: context.timestamp`, `recommendedWinner` (a qué
   *    apostar), `streakWinner` (qué resultado motivó la recomendación —
   *    ver ARCHITECTURE.md §8.7 para qué significa este campo en los
   *    mensajes de Telegram), `maxMartingales`, `triggerGameUuid:
   *    context.currentGame.uuid`, `reason` (texto humano) y `metadata`
   *    (cualquier dato adicional que quiera mostrarse o auditarse).
   *
   * No hacer: no leer HistoryStore ni DomainEventBus directamente, no
   * conocer NotificationChannel/Telegram, no guardar estado en un campo de
   * instancia propio (usar siempre `context.runtimeState`), no decidir a
   * qué canal se enruta la señal (eso lo decide exclusivamente
   * strategy-group.ts, no la estrategia).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- TODO(alternancia34): usar `context` al implementar la lógica real.
  evaluate(context: StrategyContext): StrategyResult {
    return NO_SIGNAL;
  }
}
