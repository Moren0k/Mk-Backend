import { firstValueFrom } from 'rxjs';
import { of } from 'rxjs';

import { EventsReadModel } from '../../../application/read-models/events.read-model';
import { EventsController } from './events.controller';

describe('EventsController', () => {
  it('maps each PublicEvent to a Nest MessageEvent ({ type, data })', async () => {
    const publicEvent = {
      type: 'game.received' as const,
      payload: { roundId: '1' },
      occurredAt: '2026-08-10T12:00:00.000Z',
    };
    const eventsReadModel = {
      stream: jest.fn().mockReturnValue(of(publicEvent)),
    } as unknown as EventsReadModel;

    const controller = new EventsController(eventsReadModel);
    const messageEvent = await firstValueFrom(controller.stream());

    expect(messageEvent).toEqual({
      type: 'game.received',
      data: publicEvent,
    });
  });
});
