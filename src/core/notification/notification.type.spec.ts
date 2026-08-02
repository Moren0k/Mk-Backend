import { NotificationChannelType } from '../enums/notification-channel-type.enum';
import { NotificationSeverity } from '../enums/notification-severity.enum';
import { createNotification } from './notification.type';

describe('createNotification', () => {
  it('auto-generates notificationId and createdAt', () => {
    const before = Date.now();
    const notification = createNotification({
      title: 'title',
      message: 'message',
      severity: NotificationSeverity.INFO,
      channel: NotificationChannelType.TELEGRAM,
    });
    const after = Date.now();

    expect(notification.notificationId).toEqual(expect.any(String));
    expect(notification.createdAt).toBeInstanceOf(Date);
    expect(notification.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(notification.createdAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('generates a different notificationId for each call', () => {
    const params = {
      title: 'title',
      message: 'message',
      severity: NotificationSeverity.INFO,
      channel: NotificationChannelType.TELEGRAM,
    };

    const first = createNotification(params);
    const second = createNotification(params);

    expect(first.notificationId).not.toBe(second.notificationId);
  });

  it('defaults metadata to an empty object', () => {
    const notification = createNotification({
      title: 'title',
      message: 'message',
      severity: NotificationSeverity.INFO,
      channel: NotificationChannelType.TELEGRAM,
    });

    expect(notification.metadata).toEqual({});
  });

  it('is frozen, including metadata', () => {
    const notification = createNotification({
      title: 'title',
      message: 'message',
      severity: NotificationSeverity.INFO,
      channel: NotificationChannelType.TELEGRAM,
      metadata: { operationId: 'abc' },
    });

    expect(Object.isFrozen(notification)).toBe(true);
    expect(Object.isFrozen(notification.metadata)).toBe(true);
  });
});
