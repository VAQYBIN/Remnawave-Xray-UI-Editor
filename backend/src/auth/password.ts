import bcrypt from 'bcryptjs'

/**
 * `stored` — всегда bcrypt-хэш: открытый пароль из `.env` превращает в хэш
 * `loadConfig` на старте, поэтому здесь один формат и одна ветка сравнения.
 */
export async function verifyPassword(candidate: string, stored: string): Promise<boolean> {
  return bcrypt.compare(candidate, stored)
}
