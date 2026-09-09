import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { edgeHues } from '../src/features/topology/edges'
import {
  addFromMenu,
  SINGBOX_TARGET_KINDS,
  singboxColumns,
  SingboxTopology,
  singboxTraceStateOf,
} from '../src/features/topology/SingboxTopology'
import type { SingboxDraft } from '../src/features/editor/useSingboxDraft'
import { buildSingboxGraph, layoutSingbox } from '../src/entities/graph/singbox/buildGraph'
import { parseSingbox } from '../src/entities/singbox/parse'
import { singboxFixture } from './helpers'

const graph = layoutSingbox(buildSingboxGraph(parseSingbox(singboxFixture('bundle')).doc!).nodes)

describe('колонки графа sing-box', () => {
  it('подписаны по виду узла и знают свою координату', () => {
    const columns = singboxColumns(graph)
    expect(columns.length).toBeGreaterThan(1)
    expect(columns.every((c) => typeof c.x === 'number')).toBe(true)
    expect(columns.map((c) => c.title)).toContain('правила')
  })

  it('колонка одного вида может быть не одна', () => {
    // Ключ подписи в GraphCanvas — вид ВМЕСТЕ с координатой, ровно ради этого
    const nodes = [
      { id: 'group:a', position: { x: 0, y: 0 }, data: { kind: 'singbox-group' } },
      { id: 'group:b', position: { x: 430, y: 0 }, data: { kind: 'singbox-group' } },
    ] as never
    expect(singboxColumns(nodes)).toHaveLength(2)
  })
})

describe('цвет кабеля sing-box', () => {
  it('правило и группа — переключатели: сталь на входе, янтарь на выходе', () => {
    expect(edgeHues('e:sbrule:0->out:direct')).toEqual(['var(--cable-steel)', 'var(--ember)'])
    expect(edgeHues('e:sbgroup:g->out:direct')).toEqual(['var(--cable-steel)', 'var(--ember)'])
  })

  it('кабель от входа начинается индиго', () => {
    expect(edgeHues('e:sbin:tun-in->rule:0')[0]).toBe('var(--flux)')
  })

  it('прежние правила Xray не тронуты', () => {
    // Контрольная группа разреза: правка edgeHues обязана быть аддитивной
    expect(edgeHues('e:rule:0->out:x')).toEqual(['var(--cable-steel)', 'var(--ember)'])
    expect(edgeHues('e:squad:1->in:a')).toEqual(['var(--flux)', 'var(--flux)'])
  })
})

describe('вердикт трассировки на карточке', () => {
  const result = {
    verdicts: [
      { index: 0, state: 'no' as const },
      { index: 1, state: 'yes' as const, target: 'direct' },
    ],
    caveats: [],
    winner: { ruleIndex: 1, target: 'direct' },
  }

  it('победитель отделён от обычного совпадения', () => {
    expect(singboxTraceStateOf(result, 1)).toBe('winner')
    expect(singboxTraceStateOf(result, 0)).toBe('no')
  })

  it('правило, до которого проход не дошёл, вердикта не имеет', () => {
    // У него не «нет данных» — его просто не проверяли
    expect(singboxTraceStateOf(result, 5)).toBeUndefined()
    expect(singboxTraceStateOf(undefined, 0)).toBeUndefined()
  })
})

describe('гнёзда коммутации', () => {
  it('каждый вид цели назван в SINGBOX_TARGET_KINDS', () => {
    // Вид отсюда обязан иметь правило подсветки в tokens.css, иначе data-accepts
    // проставится, а цель не подсветится — кабель тянется вслепую
    expect([...SINGBOX_TARGET_KINDS]).toEqual(['group', 'out'])
  })
})

// У наборов правил, серверов DNS и прочих секций без узлов на холсте единственный
// вход к их формам — псевдоузлы дока: меню «+ Добавить» заводит записи, кнопка
// «Документ» открывает инспектор на doc:settings (сам инспектор — задача 17).
describe('меню «+ Добавить»', () => {
  const DOC = parseSingbox('{"outbounds":[{"type":"direct","tag":"direct"}]}').doc!

  function draftStub(setSelectedNode: () => void): SingboxDraft {
    return {
      storageKey: 'template:sb-1',
      selectedNode: null,
      setSelectedNode,
      changeDoc: vi.fn(),
      applyOps: vi.fn(),
      nodeIssues: {},
      trace: undefined,
      focus: null,
    } as unknown as SingboxDraft
  }

  it('каждый пункт вставляет запись в конец своего списка и выбирает её узел', () => {
    const doc = parseSingbox('{"outbounds":[{"type":"direct","tag":"direct"}]}').doc!
    const draft = { applyOps: vi.fn(), setSelectedNode: vi.fn() } as unknown as SingboxDraft
    addFromMenu(draft, doc, 'group')
    expect(draft.applyOps).toHaveBeenCalledWith([
      { op: 'insert', path: ['outbounds'], index: 1, value: { type: 'selector', tag: 'select', outbounds: [] } },
    ])
    expect(draft.setSelectedNode).toHaveBeenCalledWith('group:select')
    addFromMenu(draft, doc, 'inbound')
    expect(draft.setSelectedNode).toHaveBeenLastCalledWith('inbound:mixed-in')
    addFromMenu(draft, doc, 'endpoint')
    expect(draft.applyOps).toHaveBeenLastCalledWith([
      expect.objectContaining({ op: 'insert', path: ['endpoints'], index: 0 }),
    ])
    expect(draft.setSelectedNode).toHaveBeenLastCalledWith('out:wg')
  })

  it('док показывает меню и кнопку «Документ», старых кнопок нет', async () => {
    const setSelectedNode = vi.fn()
    const draft = draftStub(setSelectedNode)
    render(
      <ReactFlowProvider>
        <SingboxTopology draft={draft} doc={DOC} />
      </ReactFlowProvider>,
    )

    expect(screen.getByRole('button', { name: '+ Добавить' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Документ' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Наборы правил' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'DNS' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Вход',
      'Выход',
      'Сервер',
      'Группа',
      'Эндпоинт',
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Документ' }))
    expect(setSelectedNode).toHaveBeenLastCalledWith('doc:settings')
  })
})
