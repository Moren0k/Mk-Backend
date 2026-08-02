import { Logger } from '@nestjs/common';

import { DomainEventBus } from '../../core/domain-events/base/domain-event-bus.interface';
import { GameReceivedEvent } from '../../core/domain-events/game/game-received.event';
import { WinnerType } from '../../core/enums/winner-type.enum';
import { Game } from '../../core/history/game.type';
import { HistoryStore } from '../../core/interfaces/history-store.interface';
import { EngineErrorTracker } from '../../core/observability/engine-error-tracker';
import { GameHistoryClient } from './game-history-client.interface';
import { GameDto } from './game.dto';
import { GameMapper } from './game.mapper';
import { GameEventCollector } from './game-event-collector';
import {
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
} from './reconnection.constants';
import { SseClient, SseConnectionHandlers } from './sse-client.interface';

function buildGame(uuid: string): Game {
  return {
    uuid,
    winner: WinnerType.PLAYER,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('GameEventCollector', () => {
  let historyStore: jest.Mocked<HistoryStore>;
  let historyClient: jest.Mocked<GameHistoryClient>;
  let sseClient: jest.Mocked<SseClient>;
  let gameMapper: jest.Mocked<Pick<GameMapper, 'toDomain'>>;
  let domainEventBus: jest.Mocked<DomainEventBus>;
  let errorTracker: EngineErrorTracker;
  let collector: GameEventCollector;
  let handlers: SseConnectionHandlers;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    historyStore = {
      append: jest.fn().mockReturnValue(true),
      exists: jest.fn(),
      findByUuid: jest.fn(),
      getLatest: jest.fn(),
      getLast: jest.fn(),
      getAll: jest.fn(),
      size: jest.fn().mockReturnValue(0),
      clear: jest.fn(),
      createSnapshot: jest.fn(),
    };

    historyClient = {
      fetchInitialHistory: jest.fn().mockResolvedValue([]),
    };

    sseClient = {
      connect: jest.fn((h: SseConnectionHandlers) => {
        handlers = h;
      }),
      close: jest.fn(),
    };

    gameMapper = {
      toDomain: jest.fn(),
    };

    domainEventBus = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      publish: jest.fn(),
      publishMany: jest.fn(),
      clear: jest.fn(),
    };

    errorTracker = new EngineErrorTracker();

    collector = new GameEventCollector(
      historyStore,
      historyClient,
      sseClient,
      gameMapper as unknown as GameMapper,
      domainEventBus,
      errorTracker,
    );
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('loads the initial history in chronological order before connecting the SSE', async () => {
    const dtos: GameDto[] = [
      { uuid: 'newest' },
      { uuid: 'middle' },
      { uuid: 'oldest' },
    ];
    historyClient.fetchInitialHistory.mockResolvedValue(dtos);
    gameMapper.toDomain.mockImplementation((dto: GameDto) =>
      buildGame(dto.uuid as string),
    );

    await collector.start();

    expect(historyStore.append).toHaveBeenNthCalledWith(1, buildGame('oldest'));
    expect(historyStore.append).toHaveBeenNthCalledWith(2, buildGame('middle'));
    expect(historyStore.append).toHaveBeenNthCalledWith(3, buildGame('newest'));
    expect(sseClient.connect).toHaveBeenCalledTimes(1);

    expect(domainEventBus.publish).toHaveBeenCalledTimes(3);
    expect(domainEventBus.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventName: GameReceivedEvent.eventName,
        payload: { game: buildGame('oldest'), isHistorical: true },
      }),
    );
  });

  it('skips invalid DTOs during the initial load without throwing', async () => {
    historyClient.fetchInitialHistory.mockResolvedValue([{ uuid: 'bad' }]);
    gameMapper.toDomain.mockReturnValue(null);

    await expect(collector.start()).resolves.not.toThrow();

    expect(historyStore.append).not.toHaveBeenCalled();
    expect(sseClient.connect).toHaveBeenCalledTimes(1);
  });

  it('still connects the SSE even if the initial history request fails', async () => {
    historyClient.fetchInitialHistory.mockRejectedValue(
      new Error('network down'),
    );

    await expect(collector.start()).resolves.not.toThrow();

    expect(sseClient.connect).toHaveBeenCalledTimes(1);
    expect(errorTracker.getLastError()?.message).toContain('historial inicial');
  });

  it('stores a valid game received over SSE', async () => {
    await collector.start();
    const game = buildGame('live-1');
    gameMapper.toDomain.mockReturnValue(game);

    handlers.onMessage(
      JSON.stringify({
        uuid: 'live-1',
        type: 'PLAYER',
        result: 8,
        instant: '2026-08-01T00:00:00.000Z',
      }),
    );

    expect(historyStore.append).toHaveBeenCalledWith(game);
    expect(domainEventBus.publish).toHaveBeenCalledTimes(1);
    expect(domainEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: GameReceivedEvent.eventName,
        payload: { game, isHistorical: false },
      }),
    );
  });

  it('does not publish GameReceivedEvent when the game is a duplicate', async () => {
    await collector.start();
    domainEventBus.publish.mockClear();
    const game = buildGame('duplicate');
    gameMapper.toDomain.mockReturnValue(game);
    historyStore.append.mockReturnValue(false);

    handlers.onMessage(
      JSON.stringify({
        uuid: 'duplicate',
        type: 'PLAYER',
        result: 8,
        instant: '2026-08-01T00:00:00.000Z',
      }),
    );

    expect(historyStore.append).toHaveBeenCalledWith(game);
    expect(domainEventBus.publish).not.toHaveBeenCalled();
  });

  it('ignores SSE messages with invalid JSON', async () => {
    await collector.start();

    expect(() => handlers.onMessage('not-json')).not.toThrow();
    expect(historyStore.append).not.toHaveBeenCalled();
  });

  it('ignores SSE messages the mapper rejects', async () => {
    await collector.start();
    domainEventBus.publish.mockClear();
    gameMapper.toDomain.mockReturnValue(null);

    handlers.onMessage(JSON.stringify({ uuid: '' }));

    expect(historyStore.append).not.toHaveBeenCalled();
    expect(domainEventBus.publish).not.toHaveBeenCalled();
  });

  it('reconnects with exponential backoff, capped at the maximum delay', async () => {
    await collector.start();
    sseClient.connect.mockClear();

    handlers.onError(new Error('1'));
    jest.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS);
    expect(sseClient.connect).toHaveBeenCalledTimes(1);
    expect(errorTracker.getLastError()?.message).toContain('SSE');

    handlers.onError(new Error('2'));
    jest.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS * 2);
    expect(sseClient.connect).toHaveBeenCalledTimes(2);

    handlers.onError(new Error('3'));
    jest.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS * 4);
    expect(sseClient.connect).toHaveBeenCalledTimes(3);

    handlers.onError(new Error('4'));
    jest.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS * 8);
    expect(sseClient.connect).toHaveBeenCalledTimes(4);

    handlers.onError(new Error('5'));
    jest.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS * 16);
    expect(sseClient.connect).toHaveBeenCalledTimes(5);

    // 1000 * 2^5 = 32000ms would exceed the cap, so it must be clamped to 30s.
    handlers.onError(new Error('6'));
    jest.advanceTimersByTime(MAX_RECONNECT_DELAY_MS - 1);
    expect(sseClient.connect).toHaveBeenCalledTimes(5);
    jest.advanceTimersByTime(1);
    expect(sseClient.connect).toHaveBeenCalledTimes(6);
  });

  it('resets the backoff counter after a successful (re)connection', async () => {
    await collector.start();
    sseClient.connect.mockClear();

    handlers.onError(new Error('boom'));
    jest.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS);
    expect(sseClient.connect).toHaveBeenCalledTimes(1);

    handlers.onError(new Error('boom again'));
    jest.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS * 2);
    expect(sseClient.connect).toHaveBeenCalledTimes(2);

    handlers.onOpen?.();

    handlers.onError(new Error('boom once more'));
    jest.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS - 1);
    expect(sseClient.connect).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1);
    expect(sseClient.connect).toHaveBeenCalledTimes(3);
  });

  it('closes the SSE connection and stops reconnecting on module destroy', async () => {
    await collector.start();
    sseClient.connect.mockClear();

    collector.onModuleDestroy();

    expect(sseClient.close).toHaveBeenCalled();

    handlers.onError(new Error('after destroy'));
    jest.advanceTimersByTime(MAX_RECONNECT_DELAY_MS);
    expect(sseClient.connect).not.toHaveBeenCalled();
  });
});
