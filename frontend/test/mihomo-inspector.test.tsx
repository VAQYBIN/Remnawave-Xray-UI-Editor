// Инспектор Mihomo поверх писателя (задача 10) и форм по схеме (задачи 11–12):
// формы получают writer = draft.writer без обёртки, имя правится через
// draft.rename, порядок и удаление — операциями draft.applyOps по пути записи.
// Помощник draftStub собирает минимум, который читает инспектор, не настоящий
// хук — тела форм и писателя здесь не участники теста.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo'
import { buildMihomoGraph } from '../src/entities/graph/mihomo/buildGraph'
import { MihomoInspector } from '../src/features/topology/MihomoInspector'
import { selectOption } from './helpers'
import type { MihomoDraft } from '../src/features/editor/useMihomoDraft'

function draftStub(over: Record<string, unknown> = {}) {
  return {
    writer: { apply: vi.fn(), lockAt: () => null },
    rename: vi.fn(() => null),
    applyOps: vi.fn(),
    setSelectedNode: vi.fn(),
    selectedNode: null,
    lockAt: () => null,
    ...over,
  } as unknown as MihomoDraft
}

describe('инспектор узла Mihomo', () => {
  it('группа: форма группы, порядок и удаление через операции', async () => {
    const md = parseMihomo('proxy-groups:\n  - name: A\n    type: select\n  - name: B\n    type: select\n')
    const draft = draftStub({ selectedNode: 'group:B' })
    render(<MihomoInspector draft={draft} md={md} nodeId="group:B" />)
    expect(screen.getByText('порядок: 2 из 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Переместить выше' }))
    expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'move', path: ['proxy-groups'], from: 1, to: 0 }])
    await userEvent.click(screen.getByRole('button', { name: 'Удалить группу' }))
    expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'remove', path: ['proxy-groups', 1] }], null)
  })

  it('сервер и провайдер: свои формы; у провайдера только удаление по имени', async () => {
    const md = parseMihomo('proxies:\n  - name: s\n    type: direct\nproxy-providers:\n  P: {type: http, url: u}\n')
    const { rerender } = render(<MihomoInspector draft={draftStub({ selectedNode: 'proxy:s' })} md={md} nodeId="proxy:s" />)
    expect(screen.getByText('сервер')).toBeInTheDocument()
    expect(screen.getByLabelText('Имя')).toHaveValue('s')
    const draft = draftStub({ selectedNode: 'provider:P' })
    rerender(<MihomoInspector draft={draft} md={md} nodeId="provider:P" />)
    expect(screen.queryByText(/порядок:/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Удалить провайдера' }))
    expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'remove', path: ['proxy-providers', 'P'] }], null)
  })

  it('переименование идёт через draft.rename с видом записи', async () => {
    const md = parseMihomo('proxy-groups:\n  - name: A\n    type: select\n')
    const draft = draftStub({ selectedNode: 'group:A' })
    render(<MihomoInspector draft={draft} md={md} nodeId="group:A" />)
    await userEvent.type(screen.getByLabelText('Имя'), 'B')
    // Коммит — на blur/Enter, не на каждой клавише (I1)
    expect(draft.rename).not.toHaveBeenCalled()
    await userEvent.tab()
    expect(draft.rename).toHaveBeenLastCalledWith('group', 'A', 'AB')
  })

  it('подсписок редактируется формой; правило подсписка пишет по пути sub-rules', async () => {
    const md = parseMihomo('sub-rules:\n  s:\n    - DOMAIN,a.com,DIRECT\n')
    const draft = draftStub({ selectedNode: 'subrule:s' })
    render(<MihomoInspector draft={draft} md={md} nodeId="subrule:s" />)
    await selectOption('Тип', 'DOMAIN-SUFFIX')
    expect(draft.writer.apply).toHaveBeenLastCalledWith([{ op: 'set', path: ['sub-rules', 's', 0], value: 'DOMAIN-SUFFIX,a.com,DIRECT' }])
  })

  it('перестановка правила ведёт выбор за ним', async () => {
    const md = parseMihomo('rules:\n  - MATCH,DIRECT\n  - MATCH,REJECT\n')
    const draft = draftStub({ selectedNode: 'rule:0' })
    render(<MihomoInspector draft={draft} md={md} nodeId="rule:0" />)
    await userEvent.click(screen.getByRole('button', { name: 'Переместить ниже' }))
    expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'move', path: ['rules'], from: 0, to: 1 }], 'rule:1')
  })

  it('doc:settings открывает панель «Документ»', () => {
    const md = parseMihomo('mode: rule\n')
    render(<MihomoInspector draft={draftStub({ selectedNode: 'doc:settings' })} md={md} nodeId="doc:settings" />)
    expect(screen.getByText('документ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Общие' })).toBeInTheDocument()
  })

  // Источник ОДИН — выбранный в черновике узел. Кнопки «Выше»/«Ниже»/«Удалить»
  // действуют на выбор, а не на переданный проп, и разойдись эти два источника,
  // кнопка задела бы не то, что на экране. Проп остаётся входом «покажи вот этот
  // узел» и работает, только пока выбора нет вовсе.
  it('показывает выбранный узел, а не то, что просят пропом', async () => {
    const md = parseMihomo('proxy-groups:\n  - name: A\n    type: select\nrules:\n  - DOMAIN,a.com,A\n  - MATCH,DIRECT\n')
    const draft = draftStub({ selectedNode: 'rule:0' })
    render(<MihomoInspector draft={draft} md={md} nodeId="group:A" />)
    expect(screen.getByText('rule:0')).toBeInTheDocument()
    expect(screen.queryByText('group:A')).not.toBeInTheDocument()
    // И действие тоже про правило: у группы кнопок перестановки нет вовсе
    await userEvent.click(screen.getByRole('button', { name: 'Переместить ниже' }))
    expect(draft.applyOps).toHaveBeenCalledWith([{ op: 'move', path: ['rules'], from: 0, to: 1 }], 'rule:1')
  })

  // Узел берём из настоящего графа, а не из строки-фикстуры: id подсписка задаёт
  // buildMihomoGraph, и разойтись эти две схемы обязаны заметно. Узел ищем по
  // `data.kind` — у графа Mihomo `type` узла (`mihomoSubRule`) с ним НЕ совпадает,
  // и сравнение по `type` прошло бы мимо.
  it('узел подсписка из живого графа открывается инспектором', () => {
    const md = parseMihomo('sub-rules:\n  block:\n    - MATCH,REJECT\n')
    const node = buildMihomoGraph(md).nodes.find(
      (n) => (n.data as { kind?: string }).kind === 'mihomo-subrule',
    )
    expect(node).toBeDefined()
    render(<MihomoInspector draft={draftStub()} md={md} nodeId={node!.id} />)
    expect(screen.getByLabelText('Имя')).toHaveValue('block')
  })
})

describe('карточка подстановки хостов', () => {
  /** Карточка узла подстановки на своём документе: основание задаётся ключами */
  function hostsCard(doc: string, nodeId = 'hosts:A') {
    render(<MihomoInspector draft={draftStub()} md={parseMihomo(doc)} nodeId={nodeId} />)
  }

  const MARKED = [
    'proxy-groups:',
    '  - name: A',
    '    type: select',
    '    filter: "(?i)nl"',
    '    proxies: # LEAVE THIS LINE!',
    '      - DIRECT',
    '',
  ].join('\n')

  // Условная формулировка обязательна: подставит панель хосты или нет и какие
  // именно — редактор не знает, а утвердительное «сюда попадут» было бы враньём
  it('узел подстановки говорит о хостах условно и не обещает кабель', () => {
    hostsCard(MARKED)
    expect(screen.getByText(/Если панель подставит хосты/)).toBeInTheDocument()
    expect(screen.getByText(/filter: \(\?i\)nl/)).toBeInTheDocument()
  })

  /**
   * Панель дописывает хосты по ключам, а не по маркеру: без
   * `remnawave.include-proxies: false` группа попадает в первую ветку текста
   * («панель допишет...») даже с `include-all`. Вторая ветка («include-all:
   * панель ничего не дописывает...») достижима только ПОСЛЕ явного отказа
   * `include-proxies: false` — иначе группа получила бы хосты от панели, и
   * говорить про сборку ядром было бы неверно.
   */
  it('основание подстановки называется по документу: include-all после include-proxies: false', () => {
    hostsCard(
      'proxy-groups:\n  - name: A\n    type: select\n    remnawave:\n      include-proxies: false\n    include-all: true\n',
    )
    expect(screen.getByText(/include-all/)).toBeInTheDocument()
    expect(screen.queryByText(/Панель допишет/)).not.toBeInTheDocument()
  })

  it('без include-proxies: false говорит, что панель допишет хосты сама — include-all в тексте не упоминается', () => {
    hostsCard('proxy-groups:\n  - name: A\n    type: select\n    include-all: true\n')
    expect(screen.getByText(/Панель допишет имена подставленных хостов/)).toBeInTheDocument()
    expect(screen.queryByText(/include-all/)).not.toBeInTheDocument()
  })

  /**
   * Группу могут назвать `root`, и тогда id её узла подстановки совпадает с id
   * корневого — на холсте побеждает узел ГРУППЫ (см. buildMihomoGraph). Карточка
   * обязана различать эти два случая: иначе она говорит «в КОРНЕВОМ списке
   * proxies» и тут же печатает фильтр группы.
   */
  it('группа с именем root описана как группа, а не как корневой список', () => {
    hostsCard(
      [
        'proxies: # LEAVE THIS LINE!',
        'proxy-groups:',
        '  - name: root',
        '    type: select',
        '    filter: "(?i)nl"',
        '    proxies: # LEAVE THIS LINE!',
        '      - DIRECT',
        '',
      ].join('\n'),
      'hosts:root',
    )
    expect(screen.getByText(/списка proxies группы «root»/)).toBeInTheDocument()
    expect(screen.queryByText(/корневого списка proxies/)).not.toBeInTheDocument()
    expect(screen.getByText(/filter: \(\?i\)nl/)).toBeInTheDocument()
  })

  // Корневой список рисуется ВСЕГДА (маркер декоративен), а без одноимённой
  // группы карточка по-прежнему говорит про корневой список, и фильтру взяться
  // неоткуда
  it('корневая подстановка описана как корневой список даже без маркера в тексте', () => {
    hostsCard('mode: rule\n', 'hosts:root')
    expect(screen.getByText(/конец корневого списка proxies/)).toBeInTheDocument()
    expect(screen.queryByText(/filter:/)).not.toBeInTheDocument()
  })

  it('способ подстановки хостов описан условно', () => {
    const md = parseMihomo(
      ['proxy-groups:', '  - name: A', '    remnawave:', '      select-random-proxy: true', ''].join('\n'),
    )
    render(<MihomoInspector draft={draftStub()} md={md} nodeId="hosts:A" />)
    expect(screen.getByText(/Если хосты будут подставлены, сюда попадёт один случайный/)).toBeInTheDocument()
  })
})

describe('карточка встроенной цели', () => {
  it('встроенная цель объясняется карточкой', () => {
    const md = parseMihomo('mode: rule\n')
    render(<MihomoInspector draft={draftStub()} md={md} nodeId="builtin:REJECT-DROP" />)
    expect(screen.getByText(/отбрасываются молча/)).toBeInTheDocument()
  })
})
