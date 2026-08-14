import { Injectable } from '@nestjs/common';

import { Operation } from '../../core/operation/operation.entity';
import type { StrategyExecutionGuard } from '../../core/strategy/interfaces/strategy-execution-guard.interface';

/**
 * Única fuente de verdad sobre qué Operation siguen activas, en memoria.
 *
 * OperationCoordinator la usa para registrar, recorrer y eliminar
 * operaciones; StrategyCoordinator la usa (a través de la interfaz
 * StrategyExecutionGuard, sin conocer esta clase) para preguntar si una
 * estrategia puede emitir señal. Mantiene un índice por strategyId además
 * del mapa por operationId para que `canExecute` sea O(1) y nunca dependa
 * de cuántas operaciones haya activas en total.
 */
@Injectable()
export class ActiveOperationRegistry implements StrategyExecutionGuard {
  private readonly operations = new Map<string, Operation>();
  private readonly operationIdsByStrategy = new Map<string, Set<string>>();

  register(operation: Operation): void {
    this.operations.set(operation.operationId, operation);

    const ids =
      this.operationIdsByStrategy.get(operation.strategyId) ??
      new Set<string>();
    ids.add(operation.operationId);
    this.operationIdsByStrategy.set(operation.strategyId, ids);
  }

  unregister(operationId: string): void {
    const operation = this.operations.get(operationId);
    if (!operation) {
      return;
    }

    this.operations.delete(operationId);

    const ids = this.operationIdsByStrategy.get(operation.strategyId);
    if (!ids) {
      return;
    }

    ids.delete(operationId);
    if (ids.size === 0) {
      this.operationIdsByStrategy.delete(operation.strategyId);
    }
  }

  canExecute(strategyId: string): boolean {
    return !this.operationIdsByStrategy.has(strategyId);
  }

  /** Todas las operaciones activas, sin importar la estrategia. */
  getAll(): ReadonlyArray<Operation> {
    return Array.from(this.operations.values());
  }

  /** Localiza una operación activa puntual (p. ej. para cancelarla, Anexo D §4). */
  getById(operationId: string): Operation | undefined {
    return this.operations.get(operationId);
  }

  size(): number {
    return this.operations.size;
  }
}
