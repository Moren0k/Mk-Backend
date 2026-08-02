import { Injectable } from '@nestjs/common';

import { Game } from '../../core/history/game.type';
import { WinnerType } from '../../core/enums/winner-type.enum';
import { GameDto } from './game.dto';

const VALID_WINNERS: ReadonlySet<string> = new Set(Object.values(WinnerType));

/**
 * Convierte un GameDto (infraestructura, no confiable) en un Game (dominio).
 *
 * Toda la validación vive aquí. Si el DTO no es válido, devuelve `null` en
 * vez de lanzar una excepción: el llamador decide cómo registrar el evento
 * inválido y continúa funcionando sin insertar datos corruptos.
 */
@Injectable()
export class GameMapper {
  toDomain(dto: GameDto): Game | null {
    const uuid = this.parseUuid(dto.uuid);
    const winner = this.parseWinner(dto.type);
    const score = this.parseScore(dto.result);
    const playedAt = this.parseInstant(dto.instant);

    if (
      uuid === null ||
      winner === null ||
      score === null ||
      playedAt === null
    ) {
      return null;
    }

    return Object.freeze({ uuid, winner, score, playedAt });
  }

  private parseUuid(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  private parseWinner(value: unknown): WinnerType | null {
    return typeof value === 'string' && VALID_WINNERS.has(value)
      ? (value as WinnerType)
      : null;
  }

  private parseScore(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private parseInstant(value: unknown): Date | null {
    if (typeof value !== 'string') {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
