import { describe, expect, it } from 'vitest'
import { issueBadgeOf } from '../src/features/topology/TopologyView'

describe('issueBadgeOf', () => {
  it('ошибка перевешивает предупреждение', () => {
    expect(issueBadgeOf({ 'in:a': { errors: 1, warnings: 3 } }, 'in:a')).toEqual({
      level: 'error',
      total: 4,
    })
  })

  it('только предупреждения — уровень warn', () => {
    expect(issueBadgeOf({ 'in:a': { errors: 0, warnings: 2 } }, 'in:a')).toEqual({
      level: 'warn',
      total: 2,
    })
  })

  it('узла нет в счётчиках — значка нет', () => {
    expect(issueBadgeOf({ 'in:a': { errors: 1, warnings: 0 } }, 'in:b')).toBeUndefined()
  })

  it('счётчиков нет вовсе — значка нет', () => {
    expect(issueBadgeOf(undefined, 'in:a')).toBeUndefined()
  })

  it('нулевые счётчики значка не дают', () => {
    expect(issueBadgeOf({ 'in:a': { errors: 0, warnings: 0 } }, 'in:a')).toBeUndefined()
  })
})
