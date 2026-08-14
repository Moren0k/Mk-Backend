import {
  BadRequestException,
  Body,
  ConflictException,
  Get,
  Param,
  Patch,
} from '@nestjs/common';

import { StrategyChannelRegistry } from '../../../application/strategy/strategy-channel-registry';
import type { StrategyGroup } from '../../../core/strategy/strategy-group';
import { ApiResource } from '../../common/decorators/api-resource.decorator';
import { toChannelVm } from '../../contracts/mappers/channel.mapper';
import type { ChannelVm } from '../../contracts/view-models/channel.vm';

const VALID_CHANNELS: ReadonlySet<string> = new Set(['oficial', 'pruebas']);

type PatchChannelBody = {
  readonly strategyId?: unknown;
  readonly active?: unknown;
  readonly maxMartingales?: unknown;
};

/**
 * `GET`/`PATCH /api/v1/channels/:channel` — Mk-Api.md Anexo A: asignación
 * estrategia↔canal, activar/desactivar el canal y `maxMartingales`, los
 * tres en un mismo recurso. El `GET` no está pedido palabra por palabra
 * en el documento, pero es el complemento obvio del `PATCH` — sin él, el
 * frontend no tendría forma de pintar el estado actual antes de editarlo.
 *
 * **Por default (2026-08-11):** ninguna de las 3 estrategias registradas
 * en código está asignada a ningún canal, y ningún canal está activo. Una
 * estrategia solo evalúa/opera si está asignada a un canal Y ese canal
 * está activo — ambas cosas se configuran acá, nunca en el código de la
 * estrategia.
 *
 * Body 100% opcional campo a campo: el cliente solo manda lo que quiere
 * cambiar. Validación manual (sin `class-validator`, ADR-6 sigue
 * pendiente de adopción formal — mismo estilo que `AdminController`).
 */
@ApiResource('channels')
export class ChannelsController {
  constructor(private readonly registry: StrategyChannelRegistry) {}

  @Get(':channel')
  getChannel(@Param('channel') channelParam: string): ChannelVm {
    const channel = this.validateChannel(channelParam);
    return toChannelVm(channel, this.registry);
  }

  @Patch(':channel')
  patchChannel(
    @Param('channel') channelParam: string,
    @Body() body: PatchChannelBody,
  ): ChannelVm {
    const channel = this.validateChannel(channelParam);

    if (body.strategyId !== undefined) {
      this.applyStrategyAssignment(channel, body.strategyId);
    }

    if (body.active !== undefined) {
      this.applyActiveToggle(channel, body.active);
    }

    if (body.maxMartingales !== undefined) {
      this.applyMaxMartingales(channel, body.maxMartingales);
    }

    return toChannelVm(channel, this.registry);
  }

  private applyStrategyAssignment(
    channel: StrategyGroup,
    strategyId: unknown,
  ): void {
    if (typeof strategyId !== 'string' || strategyId.length === 0) {
      throw new BadRequestException(
        '"strategyId" debe ser un string no vacío.',
      );
    }

    const applied = this.registry.assignStrategyToChannel(strategyId, channel);

    if (!applied) {
      throw new ConflictException(
        `No se pudo asignar "${strategyId}" al canal "${channel}": ` +
          'esa estrategia, o la que ocupa hoy el canal, tiene una ' +
          'operación activa; no se puede reasignar hasta que se cierre o se cancele.',
      );
    }
  }

  private applyActiveToggle(channel: StrategyGroup, active: unknown): void {
    if (typeof active !== 'boolean') {
      throw new BadRequestException('"active" debe ser booleano.');
    }

    this.registry.setActive(channel, active);
  }

  private applyMaxMartingales(
    channel: StrategyGroup,
    maxMartingales: unknown,
  ): void {
    if (
      typeof maxMartingales !== 'number' ||
      !Number.isFinite(maxMartingales) ||
      maxMartingales < 0
    ) {
      throw new BadRequestException(
        '"maxMartingales" debe ser un número mayor o igual a 0.',
      );
    }

    const strategyId = this.registry.getStrategyIdForChannel(channel);

    if (!strategyId) {
      throw new BadRequestException(
        `No hay ninguna estrategia asignada al canal "${channel}" todavía; asigna una antes de fijar "maxMartingales".`,
      );
    }

    this.registry.setMaxMartingales(strategyId, maxMartingales);
  }

  private validateChannel(candidate: string): StrategyGroup {
    if (!VALID_CHANNELS.has(candidate)) {
      throw new BadRequestException(
        'El parámetro "channel" debe ser "oficial" o "pruebas".',
      );
    }

    return candidate as StrategyGroup;
  }
}
