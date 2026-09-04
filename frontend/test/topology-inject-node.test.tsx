import type { ComponentType } from 'react'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { nodeTypes } from '../src/features/topology/nodes'
import type { InjectNodeData } from '../src/entities/graph/types'

// NodeProps шире, чем нужно карточке: приводим сам компонент к узкому пропсу,
// который он реально читает — так же, как это делают соседние тесты узлов
// (topology-nodes.test.tsx); спред `{...(props as never)}` тут не проходит
// tsc (TS2698 — спред разрешён только от объектных типов).
const Node = nodeTypes.inject as unknown as ComponentType<{ data: InjectNodeData; selected?: boolean }>

function renderNode(data: InjectNodeData) {
  return render(
    <ReactFlowProvider>
      <Node data={data} selected={false} />
    </ReactFlowProvider>,
  )
}

describe('карточка группы подстановки', () => {
  it('в nodeTypes есть тип inject', () => {
    expect(nodeTypes.inject).toBeDefined()
  })

  it('показывает селектор, пул и предсказанные теги', () => {
    renderNode({
      kind: 'inject',
      index: 0,
      selector: 'тег ~ ^RU-',
      selectFrom: 'HIDDEN',
      scheme: 'prefix',
      tags: ['proxy', 'proxy-2', 'proxy-3'],
    })
    expect(screen.getByText('тег ~ ^RU-')).toBeInTheDocument()
    expect(screen.getByText('HIDDEN')).toBeInTheDocument()
    expect(screen.getByText(/proxy-3/)).toBeInTheDocument()
  })

  it('для тегов панели теги не выдумываются', () => {
    renderNode({
      kind: 'inject',
      index: 0,
      selector: 'тег как у получателя',
      scheme: 'panel',
      tags: [],
    })
    expect(screen.getByText(/задаст панель/)).toBeInTheDocument()
  })

  it('без выбранного способа именования это названо ошибкой конфигурации', () => {
    renderNode({ kind: 'inject', index: 0, selector: 'по списку: 2', scheme: 'none', tags: [] })
    expect(screen.getByText(/не задан/)).toBeInTheDocument()
  })
})
