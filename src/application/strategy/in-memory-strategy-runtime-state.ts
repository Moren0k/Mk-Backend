import { Injectable } from '@nestjs/common';

import type { StrategyRuntimeState } from '../../core/strategy/interfaces/strategy-runtime-state.interface';

/**
 * Implementación en memoria de StrategyRuntimeState: un simple mapa por
 * strategyId, sin persistencia. Una sola instancia (singleton NestJS) se
 * comparte entre todas las estrategias a través de StrategyContext; cada
 * una solo puede leer/escribir bajo su propio strategyId.
 */
@Injectable()
export class InMemoryStrategyRuntimeState implements StrategyRuntimeState {
  private readonly state = new Map<string, unknown>();

  get<T>(strategyId: string): T | undefined {
    return this.state.get(strategyId) as T | undefined;
  }

  set<T>(strategyId: string, value: T): void {
    this.state.set(strategyId, value);
  }
}
