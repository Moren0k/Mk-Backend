import { NotificationChannelType } from '../../core/enums/notification-channel-type.enum';
import { NotificationChannel } from '../../core/interfaces/notification-channel.interface';
import { selectChannelsByGroup } from './notification-channel-selector';

function buildChannel(
  channelType: NotificationChannelType,
): jest.Mocked<NotificationChannel> {
  return {
    getChannelType: jest.fn().mockReturnValue(channelType),
    name: jest.fn(),
    enabled: jest.fn(),
    supports: jest.fn(),
    send: jest.fn(),
    deleteMessage: jest.fn(),
  };
}

describe('selectChannelsByGroup', () => {
  it('selects only TELEGRAM channels for "oficial"', () => {
    const official = buildChannel(NotificationChannelType.TELEGRAM);
    const test = buildChannel(NotificationChannelType.TELEGRAM_PRUEBAS);

    expect(selectChannelsByGroup([official, test], 'oficial')).toEqual([
      official,
    ]);
  });

  it('selects only TELEGRAM_PRUEBAS channels for "pruebas"', () => {
    const official = buildChannel(NotificationChannelType.TELEGRAM);
    const test = buildChannel(NotificationChannelType.TELEGRAM_PRUEBAS);

    expect(selectChannelsByGroup([official, test], 'pruebas')).toEqual([test]);
  });

  it('returns an empty array when no channel matches the group', () => {
    const test = buildChannel(NotificationChannelType.TELEGRAM_PRUEBAS);

    expect(selectChannelsByGroup([test], 'oficial')).toEqual([]);
  });
});
