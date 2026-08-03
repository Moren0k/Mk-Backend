import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SummaryReportService } from '../reporting/summary-report.service';
import { AdminController } from './admin.controller';

function buildConfigService(password: string | undefined): ConfigService {
  return {
    get: jest.fn().mockReturnValue(password),
  } as unknown as ConfigService;
}

function buildSummaryReportService(): jest.Mocked<SummaryReportService> {
  return {
    generateAndDispatch: jest.fn().mockReturnValue({ alertsSent: 42 }),
  } as unknown as jest.Mocked<SummaryReportService>;
}

describe('AdminController', () => {
  const REAL_PASSWORD = 'super-secret';
  let summaryReportService: jest.Mocked<SummaryReportService>;
  let controller: AdminController;

  beforeEach(() => {
    summaryReportService = buildSummaryReportService();
    controller = new AdminController(
      buildConfigService(REAL_PASSWORD),
      summaryReportService,
    );
  });

  it('throws Unauthorized when the password is wrong', () => {
    expect(() =>
      controller.handleCommand({ password: 'wrong', command: 'RESUMEN' }),
    ).toThrow(UnauthorizedException);
    expect(summaryReportService.generateAndDispatch).not.toHaveBeenCalled();
  });

  it('throws Unauthorized when the password is missing', () => {
    expect(() => controller.handleCommand({ command: 'RESUMEN' })).toThrow(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized for any password when ADMIN_PASSWORD is not configured', () => {
    const withoutPassword = new AdminController(
      buildConfigService(undefined),
      summaryReportService,
    );

    expect(() =>
      withoutPassword.handleCommand({
        password: REAL_PASSWORD,
        command: 'RESUMEN',
      }),
    ).toThrow(UnauthorizedException);
  });

  it('throws BadRequest for an unsupported command, even with the correct password', () => {
    expect(() =>
      controller.handleCommand({
        password: REAL_PASSWORD,
        command: 'OTRO',
      }),
    ).toThrow(BadRequestException);
    expect(summaryReportService.generateAndDispatch).not.toHaveBeenCalled();
  });

  it('generates and dispatches the summary for the RESUMEN command with the correct password', () => {
    const result = controller.handleCommand({
      password: REAL_PASSWORD,
      command: 'RESUMEN',
    });

    expect(summaryReportService.generateAndDispatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        command: 'RESUMEN',
        metrics: { alertsSent: 42 },
      }),
    );
  });
});
