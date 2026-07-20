import bcrypt from 'bcryptjs'
import { createHash, timingSafeEqual } from 'node:crypto'

export async function verifyPassword(candidate: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$2')) {
    return bcrypt.compare(candidate, stored)
  }
  const a = createHash('sha256').update(candidate).digest()
  const b = createHash('sha256').update(stored).digest()
  return timingSafeEqual(a, b)
}
