import { describe, expect, it } from 'vitest'
import { randomBase64, randomShortId, randomUuid, ssPassword } from '../src/entities/xray/generate'

describe('generate', () => {
  it('randomUuid — валидный UUID v4', () => {
    expect(randomUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('randomShortId — hex чётной длины, по умолчанию 8 символов', () => {
    expect(randomShortId()).toMatch(/^[0-9a-f]{8}$/)
    expect(randomShortId(8)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('randomShortId — значения не повторяются', () => {
    expect(randomShortId()).not.toBe(randomShortId())
  })

  it('ssPassword — длина ключа зависит от метода', () => {
    expect(atob(ssPassword('2022-blake3-aes-128-gcm'))).toHaveLength(16)
    expect(atob(ssPassword('2022-blake3-aes-256-gcm'))).toHaveLength(32)
    expect(atob(ssPassword('chacha20-ietf-poly1305'))).toHaveLength(16)
  })

  it('randomBase64 декодируется в исходную длину', () => {
    expect(atob(randomBase64(24))).toHaveLength(24)
  })
})
