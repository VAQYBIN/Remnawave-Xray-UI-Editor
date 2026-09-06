import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { GraphCanvas } from '../src/features/topology/GraphCanvas'

const NODE_TYPES = {
  box: ({ data }: { data: { label: string } }) => <div>{data.label}</div>,
} as never

function renderCanvas(over: Partial<Parameters<typeof GraphCanvas>[0]> = {}) {
  return render(
    <ReactFlowProvider>
      <GraphCanvas
        docKey="template:u-1"
        nodes={[{ id: 'a', type: 'box', position: { x: 0, y: 0 }, data: { label: 'узел A' } }]}
        edges={[]}
        nodeTypes={NODE_TYPES}
        edgeTypes={{}}
        selectedId={null}
        onSelect={vi.fn()}
        isValidConnection={() => true}
        onConnect={vi.fn()}
        targetKinds={['group']}
        columns={[{ kind: 'box', title: 'колонка', x: 0 }]}
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

  it('подсказка пустого графа показывается только когда её передали', async () => {
    renderCanvas({ hint: <p>правил пока нет</p> })
    expect(screen.getByText('правил пока нет')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить расположение' }))
  })
})
