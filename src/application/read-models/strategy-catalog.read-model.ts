import { Inject, Injectable } from '@nestjs/common';

import { STRATEGIES } from '../../core/constants/injection-tokens.constants';
import type { Strategy } from '../../core/strategy/interfaces/strategy.interface';

export type StrategyDescriptor = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
};

/**
 * Proyecta el catálogo de estrategias registradas en `StrategyModule`
 * (mismo arreglo que consume `StrategyCoordinator` vía el token
 * `STRATEGIES`) a solo los tres campos públicos de `Strategy` — pensado
 * para alimentar un selector en el frontend (Mk-Api.md Anexo D §3): qué
 * `strategyId` existen hoy en código, para elegir cuál asignar a un canal
 * vía `PATCH /api/v1/channels/:channel`.
 *
 * No expone `enabled()` ni ningún estado de runtime: eso ya lo cubre
 * `GET /api/v1/channels/:channel` (asignación/activo/maxMartingales), que
 * es la fuente de verdad de "qué está corriendo ahora".
 */
@Injectable()
export class StrategyCatalogReadModel {
  constructor(
    @Inject(STRATEGIES) private readonly strategies: readonly Strategy[],
  ) {}

  list(): readonly StrategyDescriptor[] {
    return this.strategies.map(({ id, name, description }) => ({
      id,
      name,
      description,
    }));
  }
}
