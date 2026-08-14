import { WinnerType } from '../../../core/enums/winner-type.enum';
import type { Game } from '../../../core/history/game.type';
import { toHistoryVm } from './history.mapper';

describe('toHistoryVm', () => {
  it('renames uuid to roundId and serializes playedAt as ISO-8601', () => {
    const game: Game = {
      uuid: 'game-uuid-1',
      winner: WinnerType.BANKER,
      score: 7,
      playedAt: new Date('2026-08-10T12:33:01.000Z'),
    };

    expect(toHistoryVm(game)).toEqual({
      roundId: 'game-uuid-1',
      winner: 'BANKER',
      score: 7,
      playedAt: '2026-08-10T12:33:01.000Z',
    });
  });
});
