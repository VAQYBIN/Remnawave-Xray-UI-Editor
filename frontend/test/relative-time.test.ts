import { describe, expect, it } from 'vitest'
import { relativeTime } from '../src/shared/lib/relativeTime'

const now = new Date('2026-07-20T12:00:00Z')

describe('relativeTime', () => {
  it('форматирует по-русски', () => {
    expect(relativeTime('2026-07-20T11:59:30Z', now)).toBe('только что')
    expect(relativeTime('2026-07-20T11:55:00Z', now)).toBe('5 мин назад')
    expect(relativeTime('2026-07-20T09:00:00Z', now)).toBe('3 ч назад')
    expect(relativeTime('2026-07-18T12:00:00Z', now)).toBe('2 дн назад')
    expect(relativeTime('2026-01-01T00:00:00Z', now)).toBe(new Date('2026-01-01T00:00:00Z').toLocaleDateString('ru-RU'))
  })
})
