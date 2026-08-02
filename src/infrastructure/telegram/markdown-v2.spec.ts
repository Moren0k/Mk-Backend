import { escapeMarkdownV2 } from './markdown-v2';

describe('escapeMarkdownV2', () => {
  it('escapes every MarkdownV2 special character', () => {
    const specials = '_*[]()~`>#+-=|{}.!\\';

    const escaped = escapeMarkdownV2(specials);

    for (const char of specials) {
      expect(escaped).toContain(`\\${char}`);
    }
  });

  it('leaves plain alphanumeric text untouched', () => {
    expect(escapeMarkdownV2('Streak 3 BANKER 123')).toBe('Streak 3 BANKER 123');
  });

  it('escapes a realistic message correctly', () => {
    const input = 'Estrategia: Streak 3\nEntrada: BANKER\nHora: 21:15:03';

    const escaped = escapeMarkdownV2(input);

    expect(escaped).toBe(
      'Estrategia: Streak 3\nEntrada: BANKER\nHora: 21:15:03',
    );
  });

  it('escapes a message containing special characters', () => {
    const input = 'Racha de 3 (streak) - 100%!';

    expect(escapeMarkdownV2(input)).toBe('Racha de 3 \\(streak\\) \\- 100%\\!');
  });
});
