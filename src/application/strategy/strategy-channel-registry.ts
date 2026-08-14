import { Inject, Injectable } from '@nestjs/common';

import { STRATEGY_EXECUTION_GUARD } from '../../core/constants/injection-tokens.constants';
import type { StrategyConfigProvider } from '../../core/strategy/interfaces/strategy-config-provider.interface';
import type { StrategyExecutionGuard } from '../../core/strategy/interfaces/strategy-execution-guard.interface';
import { StrategyGroup } from '../../core/strategy/strategy-group';

/**
 * Estado mutable en runtime de a qué canal pertenece cada estrategia, si
 * ese canal está activo, y el `maxMartingales` efectivo por estrategia
 * (Mk-Api.md Anexo D §3/§5, Anexo E.2/E.3 — revisado a pedido explícito
 * del dueño del sistema, 2026-08-11).
 *
 * **Todo arranca vacío/apagado a propósito**: ninguna estrategia viene
 * asignada a ningún canal, y ningún canal viene activo. Una estrategia
 * registrada en `StrategyModule` (existe en código, corre en el proceso)
 * nunca se evalúa mientras no esté asignada a un canal activo —
 * `StrategyCoordinator` consulta `isActiveFor()` antes de evaluar. El
 * único "encendido/apagado" real del sistema es esta asignación
 * configurada vía `PATCH /api/v1/channels/:channel`, nunca una constante
 * en el código de la estrategia (`Strategy.enabled()` ya no decide nada
 * por sí solo, ver `strategy.coordinator.ts`).
 *
 * Reemplaza, para quien la consulte, el criterio estático de
 * `resolveStrategyGroup` — pero esa función pura sigue existiendo y
 * usándose tal cual para agrupar reportes **históricos**
 * (`core/reporting/report-group-filter.ts`): reclasificar retroactivamente
 * operaciones ya cerradas cuando cambia una asignación no es parte de esta
 * decisión (esto cubre notificaciones en vivo, evaluación de estrategias y
 * el panel de operaciones activas, no el historial de reportes).
 *
 * Implementa `StrategyConfigProvider` para que `StrategyCoordinator` la
 * pase como `config` en cada `StrategyContext`, sin que ninguna Strategy
 * conozca esta clase — solo el contrato de `core/`.
 *
 * **Nota operativa:** este estado vive solo en memoria del proceso — un
 * reinicio lo resetea a "todo apagado" y hay que reconfigurar los canales
 * de nuevo vía API. No hay persistencia (fuera de alcance hoy).
 */
@Injectable()
export class StrategyChannelRegistry implements StrategyConfigProvider {
  private readonly channelByStrategy = new Map<string, StrategyGroup>();
  private readonly activeByChannel = new Map<StrategyGroup, boolean>([
    ['oficial', false],
    ['pruebas', false],
  ]);
  private readonly maxMartingalesOverrides = new Map<string, number>();

  constructor(
    @Inject(STRATEGY_EXECUTION_GUARD)
    private readonly executionGuard: StrategyExecutionGuard,
  ) {}

  /**
   * `undefined` se trata como "sin estrategia" (p. ej. un reporte, ver
   * `telegram-strategy-routing.spec.ts`): siempre pertenece a "oficial",
   * igual que hacía `resolveStrategyGroup(undefined)`. No aplica a las 3
   * estrategias reales, que arrancan sin ningún canal asignado.
   */
  isAssignedTo(
    strategyId: string | undefined,
    channel: StrategyGroup,
  ): boolean {
    if (strategyId === undefined) {
      return channel === 'oficial';
    }

    return this.channelByStrategy.get(strategyId) === channel;
  }

  isActive(channel: StrategyGroup): boolean {
    return this.activeByChannel.get(channel) ?? false;
  }

  /**
   * Único punto de verdad de si una estrategia debe evaluarse ahora mismo:
   * asignada a un canal Y ese canal activo. `StrategyCoordinator` lo
   * consulta antes de llamar a `strategy.evaluate()` — si no está
   * asignada a ningún canal, o el canal existe pero está inactivo, la
   * estrategia no corre en absoluto (ni siquiera actualiza su
   * `runtimeState` interno).
   */
  isActiveFor(strategyId: string): boolean {
    const channel = this.channelByStrategy.get(strategyId);
    return channel !== undefined && this.isActive(channel);
  }

  getMaxMartingales(strategyId: string, defaultValue: number): number {
    return this.maxMartingalesOverrides.get(strategyId) ?? defaultValue;
  }

  /**
   * A diferencia de `getMaxMartingales`, no recibe (ni asume) el default de
   * la Strategy: pensado para exponer el estado en `GET`/`PATCH
   * /api/v1/channels/:channel`, donde "sin override" debe reportarse tal
   * cual (`undefined`), no como un número inventado.
   */
  getMaxMartingalesOverride(strategyId: string): number | undefined {
    return this.maxMartingalesOverrides.get(strategyId);
  }

  /**
   * Estrategia actualmente asignada a `channel`, si alguna. Invariante
   * garantizado por `assignStrategyToChannel`: nunca hay más de una
   * estrategia por canal, así que esta búsqueda siempre es unívoca.
   */
  getStrategyIdForChannel(channel: StrategyGroup): string | undefined {
    for (const [strategyId, assigned] of this.channelByStrategy) {
      if (assigned === channel) {
        return strategyId;
      }
    }

    return undefined;
  }

  /**
   * Asigna (o reasigna) una estrategia a un canal, garantizando que nunca
   * quede más de una estrategia por canal: si `channel` ya tenía otra
   * estrategia distinta asignada, esa estrategia queda sin canal (deja de
   * evaluar) como parte de esta misma llamada.
   *
   * Bloqueada por completo (devuelve `false`, sin aplicar ningún cambio) si
   * la estrategia entrante tiene una operación activa ahora mismo — decisión
   * confirmada del dueño del sistema (Anexo E.2): la reasignación falla en
   * vez de cancelar la operación o dejarla huérfana en el canal viejo. La
   * misma protección aplica a la estrategia que sería desplazada: si esa
   * tiene una operación activa, tampoco se le puede quitar el canal por
   * debajo, así que la reasignación completa se bloquea.
   */
  assignStrategyToChannel(strategyId: string, channel: StrategyGroup): boolean {
    if (!this.executionGuard.canExecute(strategyId)) {
      return false;
    }

    const previousOccupant = this.getStrategyIdForChannel(channel);

    if (previousOccupant !== undefined && previousOccupant !== strategyId) {
      if (!this.executionGuard.canExecute(previousOccupant)) {
        return false;
      }
      this.channelByStrategy.delete(previousOccupant);
    }

    this.channelByStrategy.set(strategyId, channel);
    return true;
  }

  setActive(channel: StrategyGroup, active: boolean): void {
    this.activeByChannel.set(channel, active);
  }

  setMaxMartingales(strategyId: string, value: number): void {
    this.maxMartingalesOverrides.set(strategyId, value);
  }
}
