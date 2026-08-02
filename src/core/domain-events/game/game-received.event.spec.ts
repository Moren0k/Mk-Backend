import { WinnerType } from '../../enums/winner-type.enum';
import { Game } from '../../history/game.type';
import { GameReceivedEvent } from './game-received.event';

function buildGame(): Game {
  return {
    uuid: 'abc',
    winner: WinnerType.PLAYER,
    score: 8,
    playedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('GameReceivedEvent', () => {
  it('exposes the game and isHistorical as its payload, with the expected event name/version', () => {
    const game = buildGame();
    const event = new GameReceivedEvent({ game, isHistorical: false });

    expect(event.eventName).toBe(GameReceivedEvent.eventName);
    expect(event.eventName).toBe('GameReceivedEvent');
    expect(event.eventVersion).toBe(1);
    expect(event.payload).toEqual({ game, isHistorical: false });
    expect(event.eventId).toEqual(expect.any(String));
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it('carries isHistorical: true for games coming from the initial backfill', () => {
    const event = new GameReceivedEvent({
      game: buildGame(),
      isHistorical: true,
    });

    expect(event.payload.isHistorical).toBe(true);
  });
});
