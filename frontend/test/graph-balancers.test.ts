import { describe, expect, it } from 'vitest'
import {
  addBalancer, applyNodeJson, attachOutboundToBalancer, disconnectEdge, getNodeJson, removeNode,
  setRuleBalancer, setRuleOutbound,
} from '../src/entities/graph/mutations'
import type { XrayConfig } from '../src/entities/xray'

const base = () =>
  ({
    outbounds: [
      { tag: 'proxy-de', protocol: 'vless' },
      { tag: 'proxy-nl', protocol: 'vless' },
      { tag: 'direct', protocol: 'freedom' },
    ],
    routing: {
      rules: [{ inboundTag: ['in'], balancerTag: 'bal-eu' }],
      balancers: [{ tag: 'bal-eu', selector: ['proxy-'], strategy: { type: 'leastPing' } }],
    },
    observatory: { subjectSelector: ['proxy-'] },
  }) as XrayConfig

describe('мутации балансеров', () => {
  it('addBalancer добавляет балансер с уникальным тегом', () => {
    const once = addBalancer(base())
    const twice = addBalancer(once)
    expect(twice.routing!.balancers!.map((b) => b.tag)).toEqual(['bal-eu', 'balancer', 'balancer-2'])
    expect(twice.routing!.balancers![1]).toEqual({
      tag: 'balancer',
      selector: [],
      strategy: { type: 'roundRobin' },
    })
  })

  it('setRuleBalancer ставит balancerTag и снимает outboundTag', () => {
    const cfg = { ...base(), routing: { ...base().routing, rules: [{ outboundTag: 'direct' }] } }
    const next = setRuleBalancer(cfg, 0, 'bal-eu')
    expect(next.routing!.rules![0]).toEqual({ balancerTag: 'bal-eu' })
  })

  it('setRuleOutbound снимает balancerTag', () => {
    const next = setRuleOutbound(base(), 0, 'direct')
    expect(next.routing!.rules![0]).toEqual({ inboundTag: ['in'], outboundTag: 'direct' })
  })

  it('attachOutboundToBalancer дописывает точный тег, а покрытого префиксом не трогает', () => {
    const added = attachOutboundToBalancer(base(), 'bal-eu', 'direct')
    expect(added.routing!.balancers![0]!.selector).toEqual(['proxy-', 'direct'])
    const cfg = base()
    expect(attachOutboundToBalancer(cfg, 'bal-eu', 'proxy-de')).toBe(cfg) // уже кандидат
    expect(attachOutboundToBalancer(cfg, 'нет', 'direct')).toBe(cfg)
  })

  it('getNodeJson и applyNodeJson работают с балансером', () => {
    expect((getNodeJson(base(), 'bal:bal-eu') as { selector: string[] }).selector).toEqual(['proxy-'])
    const next = applyNodeJson(base(), 'bal:bal-eu', { tag: 'bal-new', selector: ['proxy-de'] })
    expect(next.routing!.balancers![0]!.tag).toBe('bal-new')
    // переименование тащится в правила
    expect(next.routing!.rules![0]!.balancerTag).toBe('bal-new')
  })

  it('узел obs отдаёт обе секции и пишет их обратно', () => {
    expect(getNodeJson(base(), 'obs')).toEqual({ observatory: { subjectSelector: ['proxy-'] } })
    const next = applyNodeJson(base(), 'obs', {
      burstObservatory: { subjectSelector: ['proxy-'], pingConfig: { interval: '1m' } },
    })
    expect(next.observatory).toBeUndefined()
    expect(next.burstObservatory).toEqual({
      subjectSelector: ['proxy-'],
      pingConfig: { interval: '1m' },
    })
  })

  it('removeNode удаляет балансер и обе секции обсерватории', () => {
    expect(removeNode(base(), 'bal:bal-eu').routing!.balancers).toHaveLength(0)
    const cleared = removeNode(
      { ...base(), burstObservatory: { subjectSelector: ['x'] } },
      'obs',
    )
    expect(cleared.observatory).toBeUndefined()
    expect(cleared.burstObservatory).toBeUndefined()
  })

  it('disconnectEdge: правило → балансер удаляет правило', () => {
    expect(disconnectEdge(base(), 'e:rule:0->bal:bal-eu').routing!.rules).toHaveLength(0)
  })

  it('disconnectEdge: точный тег уходит из selector', () => {
    const cfg = {
      ...base(),
      routing: {
        ...base().routing,
        balancers: [{ tag: 'bal-eu', selector: ['proxy-de', 'proxy-nl'] }],
      },
    } as XrayConfig
    const next = disconnectEdge(cfg, 'e:bal:bal-eu->out:proxy-nl')
    expect(next.routing!.balancers![0]!.selector).toEqual(['proxy-de'])
  })

  it('disconnectEdge: префиксного кандидата не трогает (UI спросит про разворот)', () => {
    const cfg = base()
    expect(disconnectEdge(cfg, 'e:bal:bal-eu->out:proxy-nl')).toBe(cfg)
  })

  it('disconnectEdge: fallback-ребро снимает fallbackTag', () => {
    const cfg = {
      ...base(),
      routing: {
        ...base().routing,
        balancers: [{ tag: 'bal-eu', selector: ['proxy-'], fallbackTag: 'direct' }],
      },
    } as XrayConfig
    const next = disconnectEdge(cfg, 'e:bal:bal-eu->fb:direct')
    expect(next.routing!.balancers![0]!.fallbackTag).toBeUndefined()
  })
})
