import { WinnerType } from '../../core/enums/winner-type.enum';
import { GameDto } from './game.dto';
import { GameMapper } from './game.mapper';

function validDto(overrides: Partial<GameDto> = {}): GameDto {
  return {
    uuid: '019fbf2b-4ab7-72b9-bf19-5b949035a6e7',
    type: 'PLAYER',
    result: 8,
    instant: '2026-08-01T21:11:53.111Z',
    ...overrides,
  };
}

describe('GameMapper', () => {
  let mapper: GameMapper;

  beforeEach(() => {
    mapper = new GameMapper();
  });

  it('maps a valid DTO to a Game', () => {
    const game = mapper.toDomain(validDto());

    expect(game).toEqual({
      uuid: '019fbf2b-4ab7-72b9-bf19-5b949035a6e7',
      winner: WinnerType.PLAYER,
      score: 8,
      playedAt: new Date('2026-08-01T21:11:53.111Z'),
    });
  });

  it('accepts BANKER and TIE as valid winners', () => {
    expect(mapper.toDomain(validDto({ type: 'BANKER' }))?.winner).toBe(
      WinnerType.BANKER,
    );
    expect(mapper.toDomain(validDto({ type: 'TIE' }))?.winner).toBe(
      WinnerType.TIE,
    );
  });

  it('freezes the resulting Game so it cannot be mutated', () => {
    const game = mapper.toDomain(validDto())!;

    expect(Object.isFrozen(game)).toBe(true);
  });

  it.each([
    ['missing uuid', { uuid: undefined }],
    ['empty uuid', { uuid: '' }],
    ['blank uuid', { uuid: '   ' }],
    ['non-string uuid', { uuid: 12345 }],
  ])('rejects a DTO with %s', (_case, overrides) => {
    expect(mapper.toDomain(validDto(overrides))).toBeNull();
  });

  it.each([
    ['missing type', { type: undefined }],
    ['unknown type', { type: 'DRAGON' }],
    ['lowercase type', { type: 'player' }],
    ['non-string type', { type: 1 }],
  ])('rejects a DTO with %s', (_case, overrides) => {
    expect(mapper.toDomain(validDto(overrides))).toBeNull();
  });

  it.each([
    ['missing result', { result: undefined }],
    ['non-numeric result', { result: '8' }],
    ['NaN result', { result: Number.NaN }],
  ])('rejects a DTO with %s', (_case, overrides) => {
    expect(mapper.toDomain(validDto(overrides))).toBeNull();
  });

  it.each([
    ['missing instant', { instant: undefined }],
    ['invalid date string', { instant: 'not-a-date' }],
    ['non-string instant', { instant: 1690000000000 }],
  ])('rejects a DTO with %s', (_case, overrides) => {
    expect(mapper.toDomain(validDto(overrides))).toBeNull();
  });
});
