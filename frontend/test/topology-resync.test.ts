import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { resyncEdges } from '../src/features/topology/TopologyView'

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
