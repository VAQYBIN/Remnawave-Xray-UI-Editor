import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { MihomoTopology, mihomoColumns, nextGroupName } from '../src/features/topology/MihomoTopology'
import { usePositionsStore } from '../src/features/topology/positionsStore'
import { buildMihomoGraph, layoutMihomo } from '../src/entities/graph/mihomo/buildGraph'
import { parseMihomo } from '../src/entities/mihomo'

const DOC = [
  'proxy-groups:',
  '  - name: Основная',
  '    type: select',
  '    proxies:',
  '      - DIRECT',
  'rules:',
  '  - DOMAIN,a.com,Основная',
  '  - SUB-RULE,(NETWORK,udp),block',
  '',
].join('\n')

function draftStub(over: Record<string, unknown> = {}) {
  return {
    storageKey: 'template:t-1',
    selectedNode: null,
    setSelectedNode: vi.fn(),
    nodeIssues: {},
    focus: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    addRuleText: vi.fn(),
    addGroupNamed: vi.fn(),
    refusal: null,
    dismissRefusal: vi.fn(),
    ...over,
  } as never
}

function renderTopology(over: Record<string, unknown> = {}) {
  const md = parseMihomo(DOC)
  return render(
    <ReactFlowProvider>
      <MihomoTopology draft={draftStub(over)} md={md} />
    </ReactFlowProvider>,
  )
}

describe('граф Mihomo', () => {
  it('рисует карточки групп и правил', () => {
    renderTopology()
    expect(screen.getByText('Основная')).toBeInTheDocument()
    expect(screen.getByText('DOMAIN')).toBeInTheDocument()
  })

  it('подписи колонок выводятся из содержимого', () => {
    const md = parseMihomo(DOC)
    const nodes = layoutMihomo(buildMihomoGraph(md).nodes)
    const titles = mihomoColumns(nodes).map((c) => c.title)
    expect(titles[0]).toBe('правила')
    expect(titles[titles.length - 1]).toBe('выходы')
  })

  it('док заводит правило и группу', async () => {
    const addRuleText = vi.fn()
    const addGroupNamed = vi.fn()
    renderTopology({ addRuleText, addGroupNamed })
    await userEvent.click(screen.getByRole('button', { name: '+ Правило' }))
    expect(addRuleText).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: '+ Группа' }))
    expect(addGroupNamed).toHaveBeenCalledOnce()
  })

  it('подсписок правил рисуется узлом, и правило SUB-RULE ведёт в него', () => {
    const md = parseMihomo(
      [
        'proxy-groups:',
        '  - name: Основная',
        'sub-rules:',
        '  block:',
        '    - MATCH,Основная',
        'rules:',
        '  - SUB-RULE,(NETWORK,udp),block',
        '',
      ].join('\n'),
    )
    const graph = buildMihomoGraph(md)
    expect(graph.nodes.map((n) => n.id)).toContain('subrule:block')
    expect(graph.edges.map((e) => e.id)).toContain('e:rule:0->subrule:block')
    // Подсписок ведёт дальше сам: иначе видно имя, но не видно, куда уходит трафик
    expect(graph.edges.map((e) => e.id)).toContain('e:subrule:block->group:Основная')
  })

  it('рисует карточки провайдера, подстановки, встроенной цели и подсписка', () => {
    const md = parseMihomo(
      [
        'proxy-providers:',
        '  Внешний:',
        '    type: http',
        '    override:',
        '      dialer-proxy: warp',
        'proxy-groups:',
        '  - name: Основная',
        '    include-all: true',
        '    filter: (RU)',
        'sub-rules:',
        '  block:',
        // Две строки на одну цель: карточка обязана считать ПРАВИЛА, а не
        // разные цели — иначе «правил: N» врёт на любом реальном подсписке
        '    - DOMAIN,a.com,REJECT',
        '    - MATCH,REJECT',
        'rules:',
        '  - SUB-RULE,(NETWORK,udp),block',
        '',
      ].join('\n'),
    )
    render(
      <ReactFlowProvider>
        <MihomoTopology draft={draftStub()} md={md} />
      </ReactFlowProvider>,
    )
    expect(screen.getByText('Внешний')).toBeInTheDocument()
    expect(screen.getByText('через warp')).toBeInTheDocument()
    expect(screen.getByText('хосты панели')).toBeInTheDocument()
    expect(screen.getByText('фильтр: (RU)')).toBeInTheDocument()
    expect(screen.getByText('подсписок')).toBeInTheDocument()
    expect(screen.getByText('правил: 2')).toBeInTheDocument()
    expect(screen.getByText('встроенная')).toBeInTheDocument()
    expect(screen.getByText('REJECT')).toBeInTheDocument()
  })

  it('карточка группы говорит о хостах панели условно и в обе стороны', () => {
    const md = parseMihomo(
      'proxy-groups:\n  - name: С хостами\n    include-all: true\n  - name: Без хостов\n    proxies:\n      - DIRECT\n',
    )
    render(
      <ReactFlowProvider>
        <MihomoTopology draft={draftStub()} md={md} />
      </ReactFlowProvider>,
    )
    expect(screen.getByText('панель добавит хосты')).toBeInTheDocument()
    expect(screen.getByText('хостов от панели не будет')).toBeInTheDocument()
  })

  it('причина отказа коммутации показывается диалогом и закрывается', async () => {
    const dismissRefusal = vi.fn()
    renderTopology({ refusal: 'flow-list', dismissRefusal })
    expect(screen.getByText(/одну строку/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Понятно' }))
    expect(dismissRefusal).toHaveBeenCalledOnce()
  })
})

describe('имя новой группы', () => {
  it('первое свободное: Группа, Группа 2, Группа 3', () => {
    // Совпадение имён — диагностируемая ошибка документа, кнопкой её не заводим
    expect(nextGroupName(parseMihomo('rules:\n  - MATCH,DIRECT\n'))).toBe('Группа')
    expect(nextGroupName(parseMihomo('proxy-groups:\n  - name: Группа\n'))).toBe('Группа 2')
    expect(
      nextGroupName(parseMihomo('proxy-groups:\n  - name: Группа\n  - name: Группа 2\n')),
    ).toBe('Группа 3')
  })

  it('док заводит группу именем, которого в документе ещё нет', async () => {
    const addGroupNamed = vi.fn()
    const md = parseMihomo('proxy-groups:\n  - name: Группа\n')
    render(
      <ReactFlowProvider>
        <MihomoTopology draft={draftStub({ addGroupNamed })} md={md} />
      </ReactFlowProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '+ Группа' }))
    expect(addGroupNamed).toHaveBeenCalledWith('Группа 2')
  })
})

describe('позиции узлов', () => {
  it('перетащенная позиция побеждает раскладку по колонкам', () => {
    usePositionsStore.getState().setPosition('template:t-1', 'rule:0', { x: 909, y: 707 })
    const { container } = renderTopology()
    const node = container.querySelector('.react-flow__node[data-id="rule:0"]')
    expect((node as HTMLElement | null)?.style.transform).toContain('909px')
    usePositionsStore.getState().resetPositions('template:t-1')
  })
})

describe('допустимость соединения знает тип правила', () => {
  it('от SUB-RULE кабель к группе не тянется', async () => {
    const md = parseMihomo(DOC)
    const nodes = layoutMihomo(buildMihomoGraph(md).nodes)
    // rule:1 — SUB-RULE; проверяем через ту же функцию, что уходит в GraphCanvas
    const { canConnect } = await import('../src/features/topology/MihomoTopology')
    expect(canConnect(nodes, { source: 'rule:1', target: 'group:Основная' })).toBe(false)
    expect(canConnect(nodes, { source: 'rule:0', target: 'group:Основная' })).toBe(true)
  })
})
