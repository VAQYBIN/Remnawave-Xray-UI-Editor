import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { GraphCanvas } from '../src/features/topology/GraphCanvas'
import { usePositionsStore } from '../src/features/topology/positionsStore'

const NODE_TYPES = {
  box: ({ data }: { data: { label: string } }) => <div>{data.label}</div>,
} as never

function renderCanvas(over: Partial<Parameters<typeof GraphCanvas>[0]> = {}) {
  return render(
    <ReactFlowProvider>
      <GraphCanvas
        docKey="template:u-1"
        nodes={[
          // `type` — ключ компонента-рендерера, `kind` — вид узла; в графе Mihomo это
          // намеренно разные имена, поэтому и здесь они разведены
          {
            id: 'a',
            type: 'box',
            position: { x: 0, y: 0 },
            data: { kind: 'boxKind', label: 'узел A' },
          },
        ]}
        edges={[]}
        nodeTypes={NODE_TYPES}
        edgeTypes={{}}
        selectedId={null}
        onSelect={vi.fn()}
        isValidConnection={() => true}
        onConnect={vi.fn()}
        targetKinds={['group']}
        columns={[{ kind: 'boxKind', title: 'колонка', x: 0 }]}
        dockActions={<button type="button">+ Правило</button>}
        {...over}
      />
    </ReactFlowProvider>,
  )
}

describe('GraphCanvas', () => {
  it('рисует узлы переданных типов', () => {
    renderCanvas()
    expect(screen.getByText('узел A')).toBeInTheDocument()
  })

  it('подписи колонок приходят пропсом', () => {
    renderCanvas()
    expect(screen.getByText('колонка')).toBeInTheDocument()
  })

  it('кнопки дока приходят слотом, а «Сбросить расположение» есть всегда', () => {
    renderCanvas()
    expect(screen.getByRole('button', { name: '+ Правило' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сбросить расположение' })).toBeInTheDocument()
  })

  it('раскрытый инструмент уезжает во вторую строку дока', () => {
    const { container } = renderCanvas({ dockRow: <span>вторая строка</span> })
    expect(container.querySelector('.wb-dock-stacked')).not.toBeNull()
    expect(screen.getByText('вторая строка')).toBeInTheDocument()
  })

  it('подсказка пустого графа показывается только когда её передали', () => {
    const { container } = renderCanvas({ hint: <p>правил пока нет</p> })
    expect(screen.getByText('правил пока нет')).toBeInTheDocument()
    expect(container.querySelector('.canvas-hint')).not.toBeNull()
  })

  it('без подсказки её места в разметке нет', () => {
    const { container } = renderCanvas()
    expect(container.querySelector('.canvas-hint')).toBeNull()
  })

  it('кнопка «Сбросить расположение» чистит позиции узлов документа', async () => {
    usePositionsStore.getState().setPosition('template:u-1', 'a', { x: 42, y: 42 })
    renderCanvas()
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить расположение' }))
    expect(usePositionsStore.getState().positions['template:u-1']).toBeUndefined()
  })
})
