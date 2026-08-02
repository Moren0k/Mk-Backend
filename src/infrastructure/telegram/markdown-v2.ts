/**
 * Caracteres que MarkdownV2 de Telegram exige escapar con "\" para poder
 * enviarlos como texto literal.
 * https://core.telegram.org/bots/api#markdownv2-style
 */
const MARKDOWN_V2_SPECIAL_CHARS = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2_SPECIAL_CHARS, (char) => `\\${char}`);
}
