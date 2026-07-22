import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { applyConnection, isValidConnection, resyncEdges } from '../src/features/topology/TopologyView'
import { edgeHues, gradientId } from '../src/features/topology/edges'

describe('resyncEdges', () => {
  it('сохраняет выделение существующих рёбер при пересборке', () => {
    const prev: Edge[] = [
      { id: 'e:a', source: 'a', target: 'b', selected: true },
      { id: 'e:b', source: 'b', target: 'c' },
    ]
    const next: Edge[] = [
      { id: 'e:a', source: 'a', target: 'b' },
      { id: 'e:c', source: 'c', target: 'd' },
    ]
    const out = resyncEdges(prev, next)
    expect(out.find((e) => e.id === 'e:a')?.selected).toBe(true)
    expect(out.find((e) => e.id === 'e:c')?.selected).toBeUndefined()
  })
})

describe('isValidConnection — что можно коммутировать', () => {
  const ok = (source: string, target: string) => isValidConnection({ source, target })

  it('inbound соединяется с правилом и с outbound', () => {
    expect(ok('in:vless-in', 'rule:0')).toBe(true)
    expect(ok('in:vless-in', 'out:direct')).toBe(true)
  })

  it('правило соединяется только с outbound', () => {
    expect(ok('rule:0', 'out:direct')).toBe(true)
    expect(ok('rule:0', 'rule:1')).toBe(false)
    expect(ok('rule:0', 'in:vless-in')).toBe(false)
  })

  it('сквады и обратные направления запрещены', () => {
    expect(ok('squad:uuid-1', 'in:vless-in')).toBe(false)
    expect(ok('out:direct', 'in:vless-in')).toBe(false)
    expect(ok('rule:0', 'rule:0')).toBe(false)
  })
})

describe('applyConnection — кабель меняет конфиг', () => {
  it('inbound → outbound создаёт правило', () => {
    const next = applyConnection({ routing: { rules: [] } }, { source: 'in:vless-in', target: 'out:direct' })
    expect(next.routing!.rules).toEqual([{ inboundTag: ['vless-in'], outboundTag: 'direct' }])
  })

  it('inbound → правило дописывает тег в существующее правило', () => {
    const cfg = { routing: { rules: [{ outboundTag: 'block' }] } }
    const next = applyConnection(cfg, { source: 'in:ss-in', target: 'rule:0' })
    expect(next.routing!.rules![0]).toEqual({ outboundTag: 'block', inboundTag: ['ss-in'] })
  })

  it('правило → outbound назначает точку выхода', () => {
    const cfg = { routing: { rules: [{ inboundTag: ['ss-in'] }] } }
    const next = applyConnection(cfg, { source: 'rule:0', target: 'out:warp' })
    expect(next.routing!.rules![0]!.outboundTag).toBe('warp')
  })

  it('недопустимая пара возвращает тот же config', () => {
    const cfg = { routing: { rules: [] } }
    expect(applyConnection(cfg, { source: 'out:direct', target: 'in:vless-in' })).toBe(cfg)
    expect(applyConnection(cfg, { source: null, target: null })).toBe(cfg)
  })
})

describe('edgeHues — кабель окрашен от источника к приёмнику', () => {
  it('сквад → inbound: индиго с обеих сторон', () => {
    expect(edgeHues('e:squad:uuid-1->in:vless-in')).toEqual(['var(--flux)', 'var(--flux)'])
  })

  it('inbound → правило: индиго переходит в сталь', () => {
    expect(edgeHues('e:in:vless-in->rule:0')).toEqual(['var(--flux)', 'var(--rail-hi)'])
  })

  it('правило → outbound: сталь переходит в янтарь', () => {
    expect(edgeHues('e:rule:0->out:direct')).toEqual(['var(--rail-hi)', 'var(--ember)'])
  })

  it('id градиента очищен от символов, недопустимых в id', () => {
    expect(gradientId('e:rule:0->out:direct')).toBe('sig-e_rule_0-_out_direct')
  })
})
