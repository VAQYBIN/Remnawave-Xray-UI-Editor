import { describe, expect, it } from 'vitest'
import {
  addInbound, addOutbound, addRule, applyNodeJson, attachInboundToRule, connectRule, moveRule,
  disconnectEdge, getNodeJson, removeNode, setRuleOutbound,
} from '../src/entities/graph/mutations'

const base = () => ({
  unknownRoot: { keep: 1 },
  inbounds: [{ tag: 'vless-in', port: 443, protocol: 'vless', custom: 'x' }],
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [{ type: 'field', inboundTag: ['vless-in'], outboundTag: 'direct' }] },
  dns: { servers: ['1.1.1.1'] },
})

describe('graph mutations', () => {
  it('getNodeJson достаёт элемент по id', () => {
    expect((getNodeJson(base(), 'in:vless-in') as { port: number }).port).toBe(443)
    expect((getNodeJson(base(), 'rule:0') as { outboundTag: string }).outboundTag).toBe('direct')
    expect((getNodeJson(base(), 'dns') as { servers: string[] }).servers).toEqual(['1.1.1.1'])
    expect(getNodeJson(base(), 'in:missing')).toBeUndefined()
  })

  it('applyNodeJson заменяет элемент и не трогает остальное (passthrough)', () => {
    const cfg = base()
    const next = applyNodeJson(cfg, 'in:vless-in', { tag: 'vless-in', port: 8443, protocol: 'vless' })
    expect((next.inbounds![0] as { port: number }).port).toBe(8443)
    expect((next as { unknownRoot: unknown }).unknownRoot).toEqual({ keep: 1 })
    expect((cfg.inbounds![0] as { port: number }).port).toBe(443) // вход не мутирован
  })

  it('removeNode удаляет inbound, правило и dns', () => {
    expect(removeNode(base(), 'in:vless-in').inbounds).toHaveLength(0)
    expect(removeNode(base(), 'rule:0').routing!.rules).toHaveLength(0)
    expect(removeNode(base(), 'dns').dns).toBeUndefined()
  })

  it('addInbound/addOutbound дают уникальные теги', () => {
    let cfg = addInbound(base())
    cfg = addInbound(cfg)
    const tags = cfg.inbounds!.map((i) => i.tag)
    expect(new Set(tags).size).toBe(tags.length)
    expect(tags.some((t) => t.startsWith('vless-in-'))).toBe(true)
    const cfg2 = addOutbound(base())
    expect(cfg2.outbounds!.some((o) => o.tag === 'direct-2')).toBe(true)
  })

  it('connectRule добавляет правило в конец', () => {
    const next = connectRule(base(), 'vless-in', 'direct')
    const rules = next.routing!.rules!
    expect(rules).toHaveLength(2)
    expect(rules[1]).toEqual({ inboundTag: ['vless-in'], outboundTag: 'direct' })
  })

  it('connectRule создаёт routing, если его нет', () => {
    const { routing: _r, ...noRouting } = base()
    const next = connectRule(noRouting, 'vless-in', 'direct')
    expect(next.routing!.rules).toHaveLength(1)
  })

  it('disconnectEdge: in->rule убирает тег, rule->out удаляет правило', () => {
    const afterIn = disconnectEdge(base(), 'e:in:vless-in->rule:0')
    expect(afterIn.routing!.rules![0]!.inboundTag).toEqual([])
    const afterOut = disconnectEdge(base(), 'e:rule:0->out:direct')
    expect(afterOut.routing!.rules).toHaveLength(0)
  })

  it('addRule добавляет пустое правило без поля type', () => {
    const next = addRule(base())
    const rules = next.routing!.rules!
    expect(rules).toHaveLength(2)
    expect(rules[1]).toEqual({})
  })

  it('мутации не изменяют входной конфиг', () => {
    const cfg = base()
    const snapshot = structuredClone(cfg)
    removeNode(cfg, 'in:vless-in')
    addInbound(cfg)
    addOutbound(cfg)
    addRule(cfg)
    connectRule(cfg, 'vless-in', 'direct')
    disconnectEdge(cfg, 'e:rule:0->out:direct')
    expect(cfg).toEqual(snapshot)
  })
})

describe('attachInboundToRule — ребро inbound → правило', () => {
  it('добавляет тег в inboundTag правила', () => {
    const cfg = { routing: { rules: [{ inboundTag: ['a-in'], outboundTag: 'direct' }] } }
    const next = attachInboundToRule(cfg, 'b-in', 0)
    expect(next.routing!.rules![0]!.inboundTag).toEqual(['a-in', 'b-in'])
  })

  it('правилу «для всех inbound» проставляет первый тег', () => {
    const cfg = { routing: { rules: [{ outboundTag: 'block' }] } }
    expect(attachInboundToRule(cfg, 'a-in', 0).routing!.rules![0]!.inboundTag).toEqual(['a-in'])
  })

  it('повтор и несуществующее правило возвращают тот же config', () => {
    const cfg = { routing: { rules: [{ inboundTag: ['a-in'] }] } }
    expect(attachInboundToRule(cfg, 'a-in', 0)).toBe(cfg)
    expect(attachInboundToRule(cfg, 'b-in', 5)).toBe(cfg)
  })

  it('не мутирует исходный конфиг', () => {
    const cfg = { routing: { rules: [{ inboundTag: ['a-in'] }] } }
    attachInboundToRule(cfg, 'b-in', 0)
    expect(cfg.routing.rules[0]!.inboundTag).toEqual(['a-in'])
  })
})

describe('setRuleOutbound — ребро правило → outbound', () => {
  it('назначает outboundTag правилу без него', () => {
    const cfg = { routing: { rules: [{ inboundTag: ['a-in'] }] } }
    expect(setRuleOutbound(cfg, 0, 'warp').routing!.rules![0]!.outboundTag).toBe('warp')
  })

  it('перезаписывает прежний outbound — у правила он один', () => {
    const cfg = { routing: { rules: [{ outboundTag: 'direct' }] } }
    expect(setRuleOutbound(cfg, 0, 'warp').routing!.rules![0]!.outboundTag).toBe('warp')
  })

  it('тот же outbound и несуществующее правило возвращают тот же config', () => {
    const cfg = { routing: { rules: [{ outboundTag: 'direct' }] } }
    expect(setRuleOutbound(cfg, 0, 'direct')).toBe(cfg)
    expect(setRuleOutbound(cfg, 9, 'warp')).toBe(cfg)
  })
})

describe('moveRule', () => {
  const rulesCfg = () => ({
    routing: {
      rules: [
        { type: 'field', outboundTag: 'a' },
        { type: 'field', outboundTag: 'b' },
        { type: 'field', outboundTag: 'c' },
      ],
    },
  })

  it('переставляет правило вниз и вверх', () => {
    const down = moveRule(rulesCfg(), 0, 1)
    expect(down.routing!.rules!.map((r) => r.outboundTag)).toEqual(['b', 'a', 'c'])
    const up = moveRule(rulesCfg(), 2, -1)
    expect(up.routing!.rules!.map((r) => r.outboundTag)).toEqual(['a', 'c', 'b'])
  })

  it('на границах возвращает исходный config (тот же объект)', () => {
    const cfg = rulesCfg()
    expect(moveRule(cfg, 0, -1)).toBe(cfg)
    expect(moveRule(cfg, 2, 1)).toBe(cfg)
  })

  it('без routing/rules и с несуществующим индексом возвращает исходный config', () => {
    const empty = {}
    expect(moveRule(empty, 0, 1)).toBe(empty)
    const cfg = rulesCfg()
    expect(moveRule(cfg, 5, -1)).toBe(cfg)
  })

  it('не мутирует входной конфиг', () => {
    const cfg = rulesCfg()
    const snapshot = structuredClone(cfg)
    moveRule(cfg, 0, 1)
    expect(cfg).toEqual(snapshot)
  })
})

// Тег узла — это ссылка: на него смотрят правила, dialerProxy, proxySettings и балансеры.
// Переименование обязано протащить новый тег по всем ссылкам, иначе правило молча
// остаётся привязанным к несуществующему выходу.
const linkedCfg = () => ({
  inbounds: [
    { tag: 'vless-in', port: 443, protocol: 'vless' },
    { tag: 'ss-in', port: 8388, protocol: 'shadowsocks' },
  ],
  outbounds: [
    { tag: 'direct', protocol: 'freedom' },
    {
      tag: 'chain',
      protocol: 'vless',
      streamSettings: { sockopt: { dialerProxy: 'direct' } },
      proxySettings: { tag: 'direct' },
    },
  ],
  routing: {
    rules: [
      { inboundTag: ['vless-in', 'ss-in'], outboundTag: 'direct' },
      { inboundTag: ['ss-in'], outboundTag: 'chain' },
    ],
    balancers: [{ tag: 'lb', selector: ['direct', 'dir'], fallbackTag: 'direct' }],
  },
})

describe('переименование узла тянет за собой ссылки', () => {
  it('outbound: правила, dialerProxy, proxySettings и балансер', () => {
    const next = applyNodeJson(linkedCfg(), 'out:direct', { tag: 'wg', protocol: 'freedom' })

    expect(next.routing!.rules![0]!.outboundTag).toBe('wg')
    expect(next.routing!.rules![1]!.outboundTag).toBe('chain')
    const chain = next.outbounds![1] as unknown as {
      streamSettings: { sockopt: { dialerProxy: string } }
      proxySettings: { tag: string }
    }
    expect(chain.streamSettings.sockopt.dialerProxy).toBe('wg')
    expect(chain.proxySettings.tag).toBe('wg')
    const balancer = next.routing!.balancers![0] as { selector: string[]; fallbackTag: string }
    // selector хранит префиксы тегов: обновляем только точное совпадение
    expect(balancer.selector).toEqual(['wg', 'dir'])
    expect(balancer.fallbackTag).toBe('wg')
  })

  it('inbound: обновляется inboundTag во всех правилах, чужие теги не трогаются', () => {
    const next = applyNodeJson(linkedCfg(), 'in:ss-in', { tag: 'ss-new', port: 8388, protocol: 'shadowsocks' })

    expect(next.routing!.rules![0]!.inboundTag).toEqual(['vless-in', 'ss-new'])
    expect(next.routing!.rules![1]!.inboundTag).toEqual(['ss-new'])
  })

  it('без смены тега ссылки остаются как были', () => {
    const next = applyNodeJson(linkedCfg(), 'out:direct', { tag: 'direct', protocol: 'freedom', settings: {} })
    expect(next.routing!.rules![0]!.outboundTag).toBe('direct')
  })

  it('новый тег, совпавший с существующим, ссылки не склеивает вслепую', () => {
    // Переименование direct → chain: правило direct теперь ведёт в chain,
    // но правило, уже смотревшее на chain, остаётся нетронутым
    const next = applyNodeJson(linkedCfg(), 'out:direct', { tag: 'chain', protocol: 'freedom' })
    expect(next.routing!.rules![0]!.outboundTag).toBe('chain')
    expect(next.routing!.rules![1]!.outboundTag).toBe('chain')
  })

  it('вход не мутируется', () => {
    const cfg = linkedCfg()
    const snapshot = structuredClone(cfg)
    applyNodeJson(cfg, 'out:direct', { tag: 'wg', protocol: 'freedom' })
    expect(cfg).toEqual(snapshot)
  })
})
