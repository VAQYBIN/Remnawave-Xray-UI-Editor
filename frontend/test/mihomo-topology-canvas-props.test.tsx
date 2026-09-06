// Что `MihomoTopology` отдаёт канвасу и как реагирует на его события. Канвас
// здесь подменён: настоящий React Flow в jsdom не даёт дотянуться до
// `onEdgesDelete` (удаление ребра идёт через выделение и клавишу), а проверять
// надо именно обработчик и его последствия. Подмена живёт в ОТДЕЛЬНОМ файле:
// vi.mock действует на весь модуль, и в основном наборе она отняла бы у тестов
// настоящие карточки узлов.

import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let captured: Record<string, unknown> = {}

vi.mock('../src/features/topology/GraphCanvas', () => ({
  GraphCanvas: (props: Record<string, unknown>) => {
    captured = props
    return <div data-testid="canvas">{props.children as ReactNode}</div>
  },
}))

const { MihomoTopology } = await import('../src/features/topology/MihomoTopology')
const { parseMihomo } = await import('../src/entities/mihomo')

const DOC = [
  'proxy-groups:',
  '  - name: Основная',
  '    proxies:',
  '      - DIRECT',
  'rules:',
  '  - DOMAIN,a.com,Основная',
  '',
].join('\n')

function draftStub(over: Record<string, unknown> = {}) {
  return {
    storageKey: 'template:t-2',
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

function cutDialog(): HTMLDialogElement | null {
  return document.querySelector('dialog[aria-label="За раз разрывается одна связь"]')
}

function edgesDelete(deleted: { id: string }[]) {
  act(() => (captured.onEdgesDelete as (d: { id: string }[]) => void)(deleted))
}

beforeEach(() => {
  captured = {}
})

// Раньше применялся ПЕРВЫЙ разрыв, остальные молча выбрасывались: писатель
// видел исчезнувшие кабели и не знал, что применилось. Молчаливое частичное
// выполнение — та же порча, от которой уходит вся ветка, поэтому отказ целиком.
describe('разрыв нескольких кабелей за раз', () => {
  it('одиночный разрыв выполняется, диалог не открывается', () => {
    const disconnect = vi.fn()
    render(<MihomoTopology draft={draftStub({ disconnect })} md={parseMihomo(DOC)} />)
    // Диалог в разметке есть всегда — значение имеет только атрибут open
    expect(cutDialog()?.hasAttribute('open')).toBe(false)

    edgesDelete([{ id: 'e:group:Основная->builtin:DIRECT' }])
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledWith('e:group:Основная->builtin:DIRECT')
    expect(cutDialog()?.hasAttribute('open')).toBe(false)
  })

  it('разрыв двух и более отказывает целиком и объясняет причину', () => {
    const disconnect = vi.fn()
    render(<MihomoTopology draft={draftStub({ disconnect })} md={parseMihomo(DOC)} />)

    edgesDelete([
      { id: 'e:group:Основная->builtin:DIRECT' },
      { id: 'e:rule:0->group:Основная' },
    ])
    // Ни одной правки: частично выполненный разрыв хуже невыполненного
    expect(disconnect).not.toHaveBeenCalled()
    expect(cutDialog()?.hasAttribute('open')).toBe(true)
    expect(screen.getByText(/частично выполненный разрыв хуже невыполненного/)).toBeInTheDocument()
  })

  it('пустой список ничего не делает и молчит', () => {
    const disconnect = vi.fn()
    render(<MihomoTopology draft={draftStub({ disconnect })} md={parseMihomo(DOC)} />)
    edgesDelete([])
    expect(disconnect).not.toHaveBeenCalled()
    expect(cutDialog()?.hasAttribute('open')).toBe(false)
  })
})

// `columns` уходит в зависимость useMemo внутри GraphCanvas: новый массив на
// каждый рендер обесценивал бы её полностью.
describe('стабильность пропсов канваса', () => {
  it('columns не пересоздаётся, пока документ тот же', () => {
    const md = parseMihomo(DOC)
    const { rerender } = render(<MihomoTopology draft={draftStub()} md={md} />)
    const first = captured.columns
    rerender(<MihomoTopology draft={draftStub()} md={md} />)
    expect(captured.columns).toBe(first)
  })

  it('на другом документе columns пересчитывается', () => {
    const { rerender } = render(<MihomoTopology draft={draftStub()} md={parseMihomo(DOC)} />)
    const first = captured.columns
    rerender(
      <MihomoTopology draft={draftStub()} md={parseMihomo('proxy-groups:\n  - name: Другая\n')} />,
    )
    expect(captured.columns).not.toBe(first)
  })
})
