import { createHash } from 'node:crypto';

/**
 * Hashea la contraseña administrativa (SHA-256): tanto la configurada (una
 * sola vez, al construir AdminController) como cada intento entrante se
 * comparan siempre como hashes (`timingSafeEqual` en AdminController),
 * nunca como texto plano.
 */
export function hashPassword(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
