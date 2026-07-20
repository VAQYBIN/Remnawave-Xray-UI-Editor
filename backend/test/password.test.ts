import { describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import { verifyPassword } from '../src/auth/password.js'

describe('verifyPassword', () => {
  it('сравнивает открытый пароль', async () => {
    expect(await verifyPassword('secret-123', 'secret-123')).toBe(true)
    expect(await verifyPassword('wrong', 'secret-123')).toBe(false)
  })

  it('поддерживает bcrypt-хэш', async () => {
    const hash = await bcrypt.hash('secret-123', 8)
    expect(await verifyPassword('secret-123', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})
