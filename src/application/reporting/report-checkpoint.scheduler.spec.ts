import { ConfigService } from '@nestjs/config';

import { ReportCheckpointScheduler } from './report-checkpoint.scheduler';
import { SummaryReportService } from './summary-report.service';

describe('ReportCheckpointScheduler', () => {
  let summaryReportService: jest.Mocked<
    Pick<SummaryReportService, 'persistCheckpoint'>
  >;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;

  beforeEach(() => {
    jest.useFakeTimers();
    summaryReportService = {
      persistCheckpoint: jest.fn().mockResolvedValue(undefined),
    };
    configService = { get: jest.fn().mockReturnValue(600000) };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function build(): ReportCheckpointScheduler {
    return new ReportCheckpointScheduler(
      summaryReportService as unknown as SummaryReportService,
      configService as unknown as ConfigService,
    );
  }

  it('calls persistCheckpoint on every tick of the configured interval', () => {
    const scheduler = build();
    scheduler.onModuleInit();

    expect(summaryReportService.persistCheckpoint).not.toHaveBeenCalled();

    jest.advanceTimersByTime(600000);
    expect(summaryReportService.persistCheckpoint).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(600000);
    expect(summaryReportService.persistCheckpoint).toHaveBeenCalledTimes(2);

    scheduler.onModuleDestroy();
  });

  it('reads the interval from report.checkpointIntervalMs, defaulting to 10 minutes', () => {
    const scheduler = build();
    scheduler.onModuleInit();

    expect(configService.get).toHaveBeenCalledWith(
      'report.checkpointIntervalMs',
      600000,
    );

    scheduler.onModuleDestroy();
  });

  it('stops ticking after onModuleDestroy', () => {
    const scheduler = build();
    scheduler.onModuleInit();
    scheduler.onModuleDestroy();

    jest.advanceTimersByTime(600000 * 3);

    expect(summaryReportService.persistCheckpoint).not.toHaveBeenCalled();
  });

  it('never throws even if persistCheckpoint rejects', () => {
    summaryReportService.persistCheckpoint.mockRejectedValue(
      new Error('conexión perdida'),
    );
    const scheduler = build();
    scheduler.onModuleInit();

    expect(() => jest.advanceTimersByTime(600000)).not.toThrow();

    scheduler.onModuleDestroy();
  });
});
