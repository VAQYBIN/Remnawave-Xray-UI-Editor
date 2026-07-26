import { describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import { verifyPassword } from '../src/auth/password.js'

describe('verifyPassword', () => {
  it('поддерживает bcrypt-хэш', async () => {
    const hash = await bcrypt.hash('secret-123', 8)
    expect(await verifyPassword('secret-123', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })

  it('открытый пароль в stored не пускает внутрь', async () => {
    // loadConfig отдаёт в конфиг только хэш, поэтому сравнение двух открытых
    // строк — это признак ошибки сборки конфига, а не успешный вход.
    expect(await verifyPassword('secret-123', 'secret-123')).toBe(false)
  })
})
