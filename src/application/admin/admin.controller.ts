import { timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SummaryReportService } from '../reporting/summary-report.service';
import { hashPassword } from './admin-password';
import { AdminCommand, AdminNotificationChannel } from './admin-command.type';
import type { AdminCommandRequest } from './admin-command.type';

const SUPPORTED_CHANNELS: ReadonlySet<string> = new Set(
  Object.values(AdminNotificationChannel),
);

/**
 * Único punto HTTP administrativo del sistema: pensado para uso interno,
 * protegido por una contraseña fija (ADMIN_PASSWORD). Completamente
 * desacoplado del resto de la aplicación — solo depende de
 * SummaryReportService (ReportingModule) para el comando RESUMEN, nunca al
 * revés, y no toca ReportScheduler ni ReportNotificationCoordinator.
 */
@Controller('admin')
export class AdminController {
  private readonly expectedPasswordHash: Buffer | undefined;

  constructor(
    configService: ConfigService,
    private readonly summaryReportService: SummaryReportService,
  ) {
    const password = configService.get<string>('admin.password');
    this.expectedPasswordHash = password ? hashPassword(password) : undefined;
  }

  @Post('commands')
  @HttpCode(200)
  handleCommand(@Body() body: AdminCommandRequest) {
    if (!this.isValidPassword(body?.password)) {
      throw new UnauthorizedException();
    }

    if (body?.command !== AdminCommand.RESUMEN) {
      throw new BadRequestException('Comando no soportado.');
    }

    const channel = this.parseChannel(body?.channel);
    const metrics = this.summaryReportService.generateAndDispatch(channel);

    return {
      ok: true,
      command: AdminCommand.RESUMEN,
      channel,
      dispatchedAt: new Date().toISOString(),
      metrics,
    };
  }

  /** Default "todos" si el cliente no manda `channel`, para no romper a quien ya integró el endpoint. */
  private parseChannel(
    candidate: string | undefined,
  ): AdminNotificationChannel {
    if (candidate === undefined) {
      return AdminNotificationChannel.TODOS;
    }

    if (!SUPPORTED_CHANNELS.has(candidate)) {
      throw new BadRequestException(
        `Canal no soportado. Usa "${AdminNotificationChannel.OFICIAL}", "${AdminNotificationChannel.PRUEBAS}" o "${AdminNotificationChannel.TODOS}".`,
      );
    }

    return candidate as AdminNotificationChannel;
  }

  /**
   * Nunca compara contraseñas en texto plano: tanto la configurada (hasheada
   * una sola vez, al construir este controller) como cada intento entrante
   * se hashean (SHA-256) antes de compararlas con `timingSafeEqual`, para no
   * filtrar por tiempo de respuesta cuánto de la contraseña coincidió.
   */
  private isValidPassword(candidate: string | undefined): boolean {
    if (!this.expectedPasswordHash || !candidate) {
      return false;
    }

    const candidateHash = hashPassword(candidate);
    return (
      candidateHash.length === this.expectedPasswordHash.length &&
      timingSafeEqual(candidateHash, this.expectedPasswordHash)
    );
  }
}
