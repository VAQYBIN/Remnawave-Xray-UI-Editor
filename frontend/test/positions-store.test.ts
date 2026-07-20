import { beforeEach, describe, expect, it } from 'vitest'
import { usePositionsStore } from '../src/features/topology/positionsStore'

beforeEach(() => {
  localStorage.clear()
  usePositionsStore.setState({ positions: {} })
})

describe('positionsStore', () => {
  it('сохраняет и сбрасывает позиции по профилю', () => {
    usePositionsStore.getState().setPosition('p1', 'in:vless-in', { x: 10, y: 20 })
    expect(usePositionsStore.getState().positions['p1']!['in:vless-in']).toEqual({ x: 10, y: 20 })
    usePositionsStore.getState().resetPositions('p1')
    expect(usePositionsStore.getState().positions['p1']).toBeUndefined()
  })

  it('персистит под ключом xui-positions', () => {
    usePositionsStore.getState().setPosition('p1', 'dns', { x: 1, y: 2 })
    expect(localStorage.getItem('xui-positions')).toContain('dns')
  })
})
