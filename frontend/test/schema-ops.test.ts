import { describe, expect, it } from 'vitest'
import { applyOps, type DocOp } from '../src/shared/schema'

const DOC = {
  outbounds: [{ type: 'direct', tag: 'a' }, { type: 'direct', tag: 'b' }],
  route: { final: 'a' },
}

describe('applyOps', () => {
  it('не мутирует вход', () => {
    const before = structuredClone(DOC)
    applyOps(DOC, [{ op: 'set', path: ['route', 'final'], value: 'b' }])
    expect(DOC).toEqual(before)
  })

  it('set пишет по пути и создаёт промежуточные объекты и списки', () => {
    const next = applyOps({}, [{ op: 'set', path: ['dns', 'servers', 0, 'tag'], value: 'x' }])
    expect(next).toEqual({ dns: { servers: [{ tag: 'x' }] } })
  })

  it('remove снимает ключ и вырезает элемент списка; мимо документа — ничего', () => {
    const a = applyOps(DOC, [{ op: 'remove', path: ['route', 'final'] }])
    expect(a.route).toEqual({})
    const b = applyOps(DOC, [{ op: 'remove', path: ['outbounds', 0] }])
    expect(b.outbounds.map((o) => o.tag)).toEqual(['b'])
    expect(applyOps(DOC, [{ op: 'remove', path: ['nope', 'x'] }])).toEqual(DOC)
  })

  it('insert зажимает индекс и заводит список, которого нет', () => {
    const a = applyOps(DOC, [{ op: 'insert', path: ['outbounds'], index: 99, value: { tag: 'c' } }])
    expect(a.outbounds.map((o) => o.tag)).toEqual(['a', 'b', 'c'])
    const b = applyOps(DOC, [{ op: 'insert', path: ['outbounds'], index: -5, value: { tag: 'z' } }])
    expect(b.outbounds[0]!.tag).toBe('z')
    const c = applyOps({}, [{ op: 'insert', path: ['inbounds'], index: 0, value: { tag: 'i' } }])
    expect(c).toEqual({ inbounds: [{ tag: 'i' }] })
  })

  it('move переставляет элемент, за границами не делает ничего', () => {
    const a = applyOps(DOC, [{ op: 'move', path: ['outbounds'], from: 1, to: 0 }])
    expect(a.outbounds.map((o) => o.tag)).toEqual(['b', 'a'])
    expect(applyOps(DOC, [{ op: 'move', path: ['outbounds'], from: 0, to: 5 }])).toEqual(DOC)
    expect(applyOps(DOC, [{ op: 'move', path: ['route'], from: 0, to: 1 }])).toEqual(DOC)
  })

  it('операции применяются по порядку, каждая видит результат предыдущей', () => {
    const ops: DocOp[] = [
      { op: 'insert', path: ['outbounds'], index: 0, value: { tag: 'n' } },
      { op: 'set', path: ['outbounds', 0, 'type'], value: 'vless' },
    ]
    expect(applyOps(DOC, ops).outbounds[0]).toEqual({ tag: 'n', type: 'vless' })
  })
})
