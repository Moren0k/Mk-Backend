import { Logger } from '@nestjs/common';

import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { MessageType } from '../../core/notification/types/message-type.enum';
import { MessageTracker } from './message-tracker';

describe('MessageTracker', () => {
  let tracker: MessageTracker;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    tracker = new MessageTracker();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers and retrieves messages for an operation', () => {
    tracker.register(
      'op-1',
      NotificationChannelType.TELEGRAM,
      MessageType.ENTRY,
      100,
    );
    tracker.register(
      'op-1',
      NotificationChannelType.TELEGRAM,
      MessageType.MG1,
      200,
    );

    const messages = tracker.getAndClear('op-1');

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      operationId: 'op-1',
      channel: NotificationChannelType.TELEGRAM,
      type: MessageType.ENTRY,
      messageId: 100,
    });
    expect(messages[1].messageId).toBe(200);
  });

  it('returns empty array for unknown operation', () => {
    const messages = tracker.getAndClear('nonexistent');

    expect(messages).toEqual([]);
  });

  it('clears messages after retrieval', () => {
    tracker.register(
      'op-1',
      NotificationChannelType.TELEGRAM,
      MessageType.MG1,
      100,
    );

    tracker.getAndClear('op-1');
    const second = tracker.getAndClear('op-1');

    expect(second).toEqual([]);
  });

  it('isolates messages between different operations', () => {
    tracker.register(
      'op-1',
      NotificationChannelType.TELEGRAM,
      MessageType.MG1,
      100,
    );
    tracker.register(
      'op-2',
      NotificationChannelType.TELEGRAM,
      MessageType.MG1,
      200,
    );

    const op1 = tracker.getAndClear('op-1');
    const op2 = tracker.getAndClear('op-2');

    expect(op1).toHaveLength(1);
    expect(op1[0].messageId).toBe(100);
    expect(op2).toHaveLength(1);
    expect(op2[0].messageId).toBe(200);
  });

  it('evicts oldest operation when capacity is exceeded', () => {
    for (let i = 0; i < 101; i++) {
      tracker.register(
        `op-${i}`,
        NotificationChannelType.TELEGRAM,
        MessageType.ENTRY,
        i,
      );
    }

    expect(tracker.size()).toBe(100);
    expect(tracker.getAndClear('op-0')).toEqual([]);

    const latest = tracker.getAndClear('op-100');
    expect(latest).toHaveLength(1);
    expect(latest[0].messageId).toBe(100);
  });

  it('logs a warning when evicting entries', () => {
    for (let i = 0; i < 101; i++) {
      tracker.register(
        `op-${i}`,
        NotificationChannelType.TELEGRAM,
        MessageType.ENTRY,
        i,
      );
    }

    expect(Logger.prototype.warn).toHaveBeenCalled();
  });
});
