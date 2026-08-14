import { BadRequestException } from '@nestjs/common';

import { SummaryReportService } from '../../../application/reporting/summary-report.service';
import { AdminController } from './admin.controller';

function buildSummaryReportService(): jest.Mocked<SummaryReportService> {
  return {
    generateAndDispatch: jest.fn().mockReturnValue({
      oficial: { alertsSent: 42 },
      pruebas: { alertsSent: 7 },
    }),
  } as unknown as jest.Mocked<SummaryReportService>;
}

describe('AdminController (api/)', () => {
  it('defaults channel to "todos" and returns the dispatched metrics', () => {
    const service = buildSummaryReportService();
    const controller = new AdminController(service);

    const result = controller.generateReport(undefined);

    expect(service.generateAndDispatch).toHaveBeenCalledWith('todos');
    expect(result).toEqual(
      expect.objectContaining({
        channel: 'todos',
        metrics: { oficial: { alertsSent: 42 }, pruebas: { alertsSent: 7 } },
      }),
    );
  });

  it.each(['oficial', 'pruebas', 'todos'])(
    'forwards channel "%s" to generateAndDispatch',
    (channel) => {
      const service = buildSummaryReportService();
      const controller = new AdminController(service);

      const result = controller.generateReport(channel);

      expect(service.generateAndDispatch).toHaveBeenCalledWith(channel);
      expect(result.channel).toBe(channel);
    },
  );

  it('throws BadRequest for an unsupported channel', () => {
    const service = buildSummaryReportService();
    const controller = new AdminController(service);

    expect(() => controller.generateReport('discord')).toThrow(
      BadRequestException,
    );
    expect(service.generateAndDispatch).not.toHaveBeenCalled();
  });
});
