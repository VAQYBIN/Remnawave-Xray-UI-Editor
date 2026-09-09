import { describe, expect, it } from 'vitest'
import { map, nameLabel, ports, str, uniqueName, when } from '../src/shared/schema'

describe('строители схемы', () => {
  it('ports — список элементов port; map принимает values', () => {
    expect(ports('ports', 'Порты.')).toEqual({ key: 'ports', doc: 'Порты.', kind: 'list', item: { kind: 'port' } })
    expect(map('hosts', 'Хосты.', { values: 'strings' })).toEqual({ key: 'hosts', doc: 'Хосты.', kind: 'map', values: 'strings' })
    expect(str('a', 'A', { when: when('type', 'x') })).toEqual({ key: 'a', doc: 'A', kind: 'string', when: { key: 'type', in: ['x'] } })
  })

  it('nameLabel — имя записи, иначе номер', () => {
    expect(nameLabel({ name: 'VPN' }, 0)).toBe('VPN')
    expect(nameLabel({}, 2)).toBe('#3')
  })

  it('uniqueName нумерует через дефис, начиная со второго', () => {
    expect(uniqueName([], 'provider')).toBe('provider')
    expect(uniqueName(['provider'], 'provider')).toBe('provider-2')
    expect(uniqueName(['provider', 'provider-2'], 'provider')).toBe('provider-3')
  })
})
