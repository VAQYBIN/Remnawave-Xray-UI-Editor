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

// isValidConnection работает по префиксам id и конфига не видит, поэтому гнездо
// подсвечивалось бы всегда. А мутации для схем panel/none возвращают тот же
// конфиг: кабель дотягивался и не делал ничего. Закрываем гнездо на карточке.
describe('гнездо группы подстановки', () => {
  const handleOf = (container: HTMLElement) => container.querySelector('.react-flow__handle')

  it('при префиксной схеме коммутируется', () => {
    const { container } = renderNode({
      kind: 'inject',
      index: 0,
      selector: 'тег ~ ^RU-',
      scheme: 'prefix',
      tags: ['proxy'],
    })
    expect(handleOf(container)).toHaveClass('connectable')
    expect(screen.queryByText(/Гнездо закрыто/)).not.toBeInTheDocument()
  })

  it('при тегах от панели закрыто и объясняет почему', () => {
    const { container } = renderNode({
      kind: 'inject',
      index: 0,
      selector: 'тег как у получателя',
      scheme: 'panel',
      tags: [],
    })
    expect(handleOf(container)).not.toHaveClass('connectable')
    expect(screen.getByText(/Гнездо закрыто/)).toBeInTheDocument()
  })

  it('без выбранного способа именования тоже закрыто', () => {
    const { container } = renderNode({
      kind: 'inject',
      index: 0,
      selector: 'по списку: 2',
      scheme: 'none',
      tags: [],
    })
    expect(handleOf(container)).not.toHaveClass('connectable')
  })
})
