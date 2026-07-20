import { describe, expect, it } from 'vitest'
import {
  addInbound, addOutbound, addRule, applyNodeJson, connectRule,
  disconnectEdge, getNodeJson, removeNode,
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
    expect(rules[1]).toEqual({ type: 'field', inboundTag: ['vless-in'], outboundTag: 'direct' })
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

  it('addRule добавляет пустое правило type:field', () => {
    const next = addRule(base())
    const rules = next.routing!.rules!
    expect(rules).toHaveLength(2)
    expect(rules[1]).toEqual({ type: 'field' })
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
