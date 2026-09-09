// Что `MihomoTopology` отдаёт канвасу и как реагирует на его события. Канвас
// здесь подменён: настоящий React Flow в jsdom не даёт дотянуться до
// `onEdgesDelete` (удаление ребра идёт через выделение и клавишу), а проверять
// надо именно обработчик и его последствия. Подмена живёт в ОТДЕЛЬНОМ файле:
// vi.mock действует на весь модуль, и в основном наборе она отняла бы у тестов
// настоящие карточки узлов.

import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
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
    applyOps: vi.fn(),
    refusal: null,
    dismissRefusal: vi.fn(),
    ...over,
  } as never
}

function edgesDelete(deleted: { id: string }[]) {
  act(() => (captured.onEdgesDelete as (d: { id: string }[]) => void)(deleted))
}

beforeEach(() => {
  captured = {}
})

// Разрыв нескольких рёбер разом больше не отказывает целиком: у Mihomo нет
// позиционных id, которые смещались бы друг относительно друга при пачечной
// правке (в отличие от индексов `outbounds` у sing-box), и черновик умеет
// применить весь список одним вызовом `disconnect(edgeIds)` — см.
// `useMihomoDraft.ts`. Здесь проверяем только передачу: что дошло из
// `onEdgesDelete`, ушло в `disconnect` целиком и одним вызовом.
describe('разрыв рёбер', () => {
  it('одиночный разрыв передаётся списком из одного id', () => {
    const disconnect = vi.fn()
    render(<MihomoTopology draft={draftStub({ disconnect })} md={parseMihomo(DOC)} />)
    edgesDelete([{ id: 'e:group:Основная->builtin:DIRECT' }])
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledWith(['e:group:Основная->builtin:DIRECT'])
  })

  it('разрыв нескольких рёбер уходит одним вызовом со всеми id', () => {
    const disconnect = vi.fn()
    render(<MihomoTopology draft={draftStub({ disconnect })} md={parseMihomo(DOC)} />)
    edgesDelete([
      { id: 'e:group:Основная->builtin:DIRECT' },
      { id: 'e:rule:0->group:Основная' },
    ])
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledWith([
      'e:group:Основная->builtin:DIRECT',
      'e:rule:0->group:Основная',
    ])
  })

  it('пустой список ничего не делает и молчит', () => {
    const disconnect = vi.fn()
    render(<MihomoTopology draft={draftStub({ disconnect })} md={parseMihomo(DOC)} />)
    edgesDelete([])
    expect(disconnect).not.toHaveBeenCalled()
  })
})

// `targetKinds` уходит в GraphCanvas как есть — подсветка гнёзд коммутации
// зависит от того, что здесь перечислено (см. tokens.css). Сервер — такая же
// адресуемая тегом цель, как группа, провайдер и встроенное имя.
describe('targetKinds', () => {
  it('содержит proxy', () => {
    render(<MihomoTopology draft={draftStub()} md={parseMihomo(DOC)} />)
    expect(captured.targetKinds).toContain('proxy')
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
