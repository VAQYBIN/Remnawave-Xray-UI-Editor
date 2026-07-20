import bcrypt from 'bcryptjs'
import { timingSafeEqual } from 'node:crypto'

export async function verifyPassword(candidate: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$2')) {
    return bcrypt.compare(candidate, stored)
  }
  const a = Buffer.from(candidate)
  const b = Buffer.from(stored)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
