import { describe, expect, it } from 'vitest'
import { blockingGroupPrefix, disconnectEdge } from '../src/entities/graph/mutations'
import type { XrayConfig } from '../src/entities/xray'

const base = (selector: string[], outbounds: string[]): XrayConfig =>
  ({
    remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
    outbounds: outbounds.map((tag) => ({ tag, protocol: 'freedom' })),
    routing: {
      balancers: [{ tag: 'bal', selector }],
      rules: [
        { type: 'field', domain: ['a.test'], outboundTag: 'proxy' },
        { type: 'field', domain: ['b.test'], outboundTag: 'direct' },
      ],
    },
  }) as unknown as XrayConfig

describe('разрыв ребра «правило → группа»', () => {
  it('удаляет правило целиком, как и ребро правило → выход', () => {
    const next = disconnectEdge(base(['proxy'], ['direct']), 'e:rule:0->inj:0')
    expect(next.routing!.rules).toHaveLength(1)
    expect(next.routing!.rules![0]!.domain).toEqual(['b.test'])
  })

  it('несуществующее правило не роняет и ничего не портит', () => {
    const config = base(['proxy'], ['direct'])
    const next = disconnectEdge(config, 'e:rule:9->inj:0')
    expect(next.routing!.rules).toHaveLength(2)
  })
})

describe('разрыв ребра «балансер → группа»', () => {
  it('убирает из селектора префикс, ловящий группу', () => {
    const next = disconnectEdge(base(['proxy', 'eu-'], ['eu-1']), 'e:bal:bal->inj:0')
    expect(next.routing!.balancers![0]!.selector).toEqual(['eu-'])
  })

  it('убирает все префиксы, ловящие эту группу', () => {
    const next = disconnectEdge(base(['proxy', 'proxy-', 'eu-'], ['eu-1']), 'e:bal:bal->inj:0')
    expect(next.routing!.balancers![0]!.selector).toEqual(['eu-'])
  })

  // Тот же тупик, что у blockingInjectPrefix, только с другой стороны
  it('префикс, ловящий заодно статический выход, убрать нельзя — тот же конфиг', () => {
    const config = base(['proxy'], ['proxy-eu'])
    expect(blockingGroupPrefix(config, 'bal', 0)).toBe('proxy')
    expect(disconnectEdge(config, 'e:bal:bal->inj:0')).toBe(config)
  })

  it('обычный разрыв блокировкой не считается', () => {
    expect(blockingGroupPrefix(base(['proxy', 'eu-'], ['eu-1']), 'bal', 0)).toBeUndefined()
  })

  it('неизвестный балансер возвращает тот же конфиг', () => {
    const config = base(['proxy'], ['direct'])
    expect(disconnectEdge(config, 'e:bal:нет-такого->inj:0')).toBe(config)
  })

  it('группа с тегами от панели префиксов не имеет — ребра к ней не бывает', () => {
    const config = {
      remnawave: { injectHosts: [{ selector: { type: 'tagRegex' }, useHostTagAsTag: true }] },
      outbounds: [{ tag: 'direct' }],
      routing: { balancers: [{ tag: 'bal', selector: ['direct'] }], rules: [] },
    } as unknown as XrayConfig
    expect(disconnectEdge(config, 'e:bal:bal->inj:0')).toBe(config)
  })

  it('префикс, ловящий соседнюю группу, убрать нельзя — тот же конфиг', () => {
    const config = {
      remnawave: {
        injectHosts: [
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'pr' },
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'prod' },
        ],
      },
      outbounds: [{ tag: 'direct' }],
      routing: { balancers: [{ tag: 'bal', selector: ['pr'] }], rules: [] },
    } as unknown as XrayConfig
    expect(blockingGroupPrefix(config, 'bal', 0)).toBe('pr')
    expect(disconnectEdge(config, 'e:bal:bal->inj:0')).toBe(config)
  })

  it('у каждой группы свой префикс — разрыв убирает только её', () => {
    const config = {
      remnawave: {
        injectHosts: [
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'ru' },
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'de' },
        ],
      },
      outbounds: [{ tag: 'direct' }],
      routing: { balancers: [{ tag: 'bal', selector: ['ru', 'de'] }], rules: [] },
    } as unknown as XrayConfig
    const next = disconnectEdge(config, 'e:bal:bal->inj:0')
    expect(next.routing!.balancers![0]!.selector).toEqual(['de'])
  })
})
