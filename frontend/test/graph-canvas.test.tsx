import { act } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider, useEdges, useNodes, useReactFlow, type Edge, type Node } from '@xyflow/react'
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

// У Xray колонка каждого вида ровно одна, поэтому дубликат ключа там не
// возникал; у Mihomo колонок вида `mihomo-group` бывает несколько — их число
// зависит от глубины ссылок документа.
//
// Проверяем ИМЕННО предупреждение React, а не разметку: под дублирующимся ключом
// обе подписи всё равно оказываются в DOM и на своих координатах — и на первом
// рендере, и после перерисовки (проверено). То есть тест на текст и transform
// прошёл бы при ОБЕИХ версиях ключа и не поймал бы ничего. Наблюдаемое следствие
// здесь ровно одно — «Encountered two children with the same key», а сам React
// про такой случай пишет, что поведение не поддерживается и дети могут быть
// продублированы или потеряны в любой следующей версии.
describe('колонки одного вида на разных координатах', () => {
  it('ключи подписей не сталкиваются, и каждая колонка получает свою', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = renderCanvas({
      nodes: [
        { id: 'a', type: 'box', position: { x: 0, y: 0 }, data: { kind: 'boxKind', label: 'A' } },
        { id: 'b', type: 'box', position: { x: 430, y: 0 }, data: { kind: 'boxKind', label: 'Б' } },
      ],
      columns: [
        { kind: 'boxKind', title: 'группы', x: 0 },
        { kind: 'boxKind', title: 'группы', x: 430 },
      ],
    })
    const messages = errors.mock.calls.map((c) => String(c[0]))
    errors.mockRestore()
    expect(messages.filter((m) => m.includes('same key'))).toEqual([])

    const labels = [...container.querySelectorAll('.column-label')]
    expect(labels.map((l) => l.textContent)).toEqual(['группы', 'группы'])
    expect(labels.map((l) => (l as HTMLElement).style.transform)).toEqual([
      'translate(0px, -52px)',
      'translate(430px, -52px)',
    ])
  })
})

// Убрать ребро с холста имеет право только документ. React Flow спрашивает
// разрешения через onEdgesDelete; топология отвечает правкой либо отказом. При
// отказе документ не меняется, проп `edges` остаётся ТОЙ ЖЕ ссылкой, ресинк не
// срабатывает — и если канвас применил удаление локально, ребро висит убранным
// до следующей пересборки графа. Холст показывал бы документ, которого нет.
//
// Проверка идёт через настоящий путь удаления React Flow (`deleteElements`), а
// состояние читается его же хуком `useEdges` — это и есть «что сейчас на
// холсте». Дефект и починка живут в ОБЩЕМ канвасе, поэтому один тест здесь
// закрывает оба графа: и Xray, и Mihomo рисуются этим же компонентом.
describe('удаление ребра проходит через документ', () => {
  function probe() {
    const state: {
      edges: Edge[]
      nodes: Node[]
      remove: (() => Promise<unknown>) | null
      removeNode: (() => Promise<unknown>) | null
    } = { edges: [], nodes: [], remove: null, removeNode: null }
    function Probe() {
      state.edges = useEdges()
      state.nodes = useNodes()
      const { deleteElements } = useReactFlow()
      state.remove = () => deleteElements({ edges: [{ id: 'e1' }] })
      state.removeNode = () => deleteElements({ nodes: [{ id: 'a' }] })
      return null
    }
    return { state, Probe }
  }

  const EDGE = { id: 'e1', source: 'a', target: 'b' }
  const NODES = [
    { id: 'a', type: 'box', position: { x: 0, y: 0 }, data: { kind: 'boxKind', label: 'A' } },
    { id: 'b', type: 'box', position: { x: 200, y: 0 }, data: { kind: 'boxKind', label: 'Б' } },
  ]

  it('после отказа ребро остаётся на холсте, а документ о попытке узнал', async () => {
    const { state, Probe } = probe()
    // Отказ: обработчик вызван, но документ не изменился — проп edges тот же
    const onEdgesDelete = vi.fn()
    renderCanvas({ nodes: NODES, edges: [EDGE], onEdgesDelete, children: <Probe /> })

    await act(async () => {
      await state.remove!()
    })
    expect(onEdgesDelete).toHaveBeenCalledTimes(1)
    expect(state.edges.map((e) => e.id)).toEqual(['e1'])
  })

  it('когда документ ребро убрал, оно уходит и с холста', async () => {
    // Парная сторона: канвас не «замораживает» рёбра, он просто ждёт документ
    const { state, Probe } = probe()
    const view = render(
      <ReactFlowProvider>
        <GraphCanvas
          docKey="template:u-2"
          nodes={NODES}
          edges={[EDGE]}
          nodeTypes={NODE_TYPES}
          edgeTypes={{}}
          selectedId={null}
          onSelect={vi.fn()}
          isValidConnection={() => true}
          onConnect={vi.fn()}
          onEdgesDelete={vi.fn()}
          targetKinds={['group']}
          columns={[{ kind: 'boxKind', title: 'колонка', x: 0 }]}
        >
          <Probe />
        </GraphCanvas>
      </ReactFlowProvider>,
    )
    await act(async () => {
      await state.remove!()
    })
    expect(state.edges.map((e) => e.id)).toEqual(['e1'])

    view.rerender(
      <ReactFlowProvider>
        <GraphCanvas
          docKey="template:u-2"
          nodes={NODES}
          edges={[]}
          nodeTypes={NODE_TYPES}
          edgeTypes={{}}
          selectedId={null}
          onSelect={vi.fn()}
          isValidConnection={() => true}
          onConnect={vi.fn()}
          onEdgesDelete={vi.fn()}
          targetKinds={['group']}
          columns={[{ kind: 'boxKind', title: 'колонка', x: 0 }]}
        >
          <Probe />
        </GraphCanvas>
      </ReactFlowProvider>,
    )
    expect(state.edges).toEqual([])
  })

  it('узел с холста тоже убирает только документ — и его рёбра не повисают', async () => {
    // Сегодня обе топологии помечают узлы `deletable: false`, и через интерфейс
    // узел не удаляется: этот тест закрывает не достижимый сценарий, а
    // ИНВАРИАНТ. Держать его обязан сам канвас, а не каждый вызывающий по
    // памяти — фикстура здесь намеренно БЕЗ `deletable: false`, то есть ровно
    // такая, какой станет топология, если кто-то забудет флаг.
    //
    // Цена забывчивости выросла после фильтра рёбер: раньше узел уходил вместе
    // со своими рёбрами, теперь ребро выживает и висело бы, указывая в пустоту.
    const { state, Probe } = probe()
    renderCanvas({ nodes: NODES, edges: [EDGE], children: <Probe /> })

    await act(async () => {
      await state.removeNode!()
    })
    expect(state.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(state.edges.map((e) => e.id)).toEqual(['e1'])
  })
})
