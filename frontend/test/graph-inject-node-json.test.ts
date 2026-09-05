import { describe, expect, it } from 'vitest'
import { applyNodeJson, getNodeJson, removeNode } from '../src/entities/graph/mutations'
import type { XrayConfig } from '../src/entities/xray'

const config = (): XrayConfig =>
  ({
    remnawave: {
      injectHosts: [
        { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy', selectFrom: 'HIDDEN' },
        { selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true },
      ],
    },
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [] },
  }) as unknown as XrayConfig

describe('узел группы подстановки в инспекторе', () => {
  it('читается целиком', () => {
    expect(getNodeJson(config(), 'inj:0')).toEqual({
      selector: { type: 'tagRegex', pattern: '^RU-' },
      tagPrefix: 'proxy',
      selectFrom: 'HIDDEN',
    })
  })

  it('несуществующий индекс даёт undefined, а не падение', () => {
    expect(getNodeJson(config(), 'inj:9')).toBeUndefined()
  })

  it('применение заменяет группу и не трогает соседнюю', () => {
    const next = applyNodeJson(config(), 'inj:0', { selector: { type: 'uuids', values: ['a'] } })
    expect(next.remnawave!.injectHosts![0]).toEqual({ selector: { type: 'uuids', values: ['a'] } })
    expect(next.remnawave!.injectHosts![1]!.useHostTagAsTag).toBe(true)
  })

  it('применение к несуществующему индексу возвращает конфиг без изменений', () => {
    const next = applyNodeJson(config(), 'inj:9', { selector: { type: 'uuids' } })
    expect(next.remnawave!.injectHosts).toHaveLength(2)
  })

  it('удаление вырезает группу и сдвигает индексы', () => {
    const next = removeNode(config(), 'inj:0')
    expect(next.remnawave!.injectHosts).toHaveLength(1)
    expect(next.remnawave!.injectHosts![0]!.useHostTagAsTag).toBe(true)
  })

  it('исходный конфиг не мутируется', () => {
    const before = config()
    applyNodeJson(before, 'inj:0', { selector: { type: 'uuids' } })
    removeNode(before, 'inj:0')
    expect(before.remnawave!.injectHosts).toHaveLength(2)
    expect(before.remnawave!.injectHosts![0]!.tagPrefix).toBe('proxy')
  })
})
