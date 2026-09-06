// НЕ ЗАМЕНЯТЬ на `import css from '...tokens.css?raw'` — так уже пробовали, и
// тест позеленел ВХОЛОСТУЮ. У vitest в этом проекте `css: false`, и любой импорт
// CSS, включая сырой `?raw`, подменяется заглушкой: в переменной оказывается
// пустая строка, а проверки ниже ищут в ней подстроки и... находят ноль
// вхождений при любом состоянии tokens.css, потому что искать не в чем.
// Проверено мутацией: с `?raw` удаление правила подсветки тест не ловил.
// Поэтому файл читается с диска, и это единственный работающий способ.
//
// Цена — одно подавление типов: @types/node в tsconfig фронтенда нет
// (`types: ["vite/client"]`), а тянуть их ради одного теста или включать
// `css: true` и замедлять весь набор дороже, чем строка ниже.
// Путь относительный: корень vitest — каталог frontend.
// @ts-expect-error нет @types/node — модуль есть только в рантайме vitest
import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import {
  MihomoTopology,
  mihomoColumns,
  MIHOMO_TARGET_KINDS,
  nextGroupName,
} from '../src/features/topology/MihomoTopology'
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

  it('узел подсписка попадает в колонку правил после раскладки', () => {
    // Сравнивать x ДО layoutMihomo бессмысленно: там оба литерально 0 в одном и
    // том же файле. Проверяем то, что видит пользователь: разложенные узлы и
    // подпись колонки, в которую подсписок попал.
    const md = parseMihomo(
      'proxy-groups:\n  - name: VPN\n    proxies:\n      - DIRECT\n' +
        'sub-rules:\n  ru:\n    - MATCH,DIRECT\nrules:\n  - SUB-RULE,(NETWORK,udp),ru\n',
    )
    const nodes = layoutMihomo(buildMihomoGraph(md).nodes)
    const sub = nodes.find((n) => n.id === 'subrule:ru')!
    const rule = nodes.find((n) => n.id === 'rule:0')!
    const group = nodes.find((n) => n.id === 'group:VPN')!
    expect(sub.position.x).toBe(rule.position.x)
    // Колонка правил — не та же, что колонка групп: без этого равенство выше
    // выполнялось бы и при схлопывании всех колонок в одну
    expect(sub.position.x).not.toBe(group.position.x)
    expect(mihomoColumns(nodes).find((c) => c.x === sub.position.x)?.title).toBe('правила')
    // Раскладка развела их по вертикали — узлы не лежат друг на друге
    expect(sub.position.y).not.toBe(rule.position.y)
  })

  it('подсписок без единого правила в документе всё равно называет колонку правилами', () => {
    // Отступление 4 отчёта: `mihomo-subrule` заведён в COLUMN_TITLE ровно ради
    // документа с `sub-rules` и БЕЗ `rules` — иначе первым узлом колонки был бы
    // подсписок, и колонка правил назвалась бы «выходы»
    const md = parseMihomo('proxy-groups:\n  - name: VPN\nsub-rules:\n  ru:\n    - MATCH,VPN\n')
    const nodes = layoutMihomo(buildMihomoGraph(md).nodes)
    expect(nodes.some((n) => n.id === 'rule:0')).toBe(false)
    expect(mihomoColumns(nodes)[0]?.title).toBe('правила')
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
    // Ветка «хосты будут» — про то, что сделает панель, и обещать этого нельзя:
    // под `filter` может не подойти ни один хост. Проверяем условность, а не
    // формулировку, но безусловное обещание ловим отдельно.
    const positive = screen.getByText(/хост/i, { selector: '.metric-accent' })
    expect(positive.textContent).toMatch(/^если панель/)
    // Обратная ветка следует из ключей документа и условной быть не обязана
    expect(screen.getByText('хостов от панели не будет')).toBeInTheDocument()
  })

  it('подсказка пустого холста не называет документ пустым и не обещает импорта', () => {
    // Узлов нет, но документ не пуст: ни групп, ни правил, ни провайдеров в нём
    // просто нет, а `port`/`mode` есть. Сказать «документ пуст» — соврать.
    const md = parseMihomo('port: 7890\nmode: rule\n')
    const { container } = render(
      <ReactFlowProvider>
        <MihomoTopology draft={draftStub()} md={md} />
      </ReactFlowProvider>,
    )
    const hint = container.querySelector('.canvas-hint')
    expect(hint).not.toBeNull()
    const text = hint!.textContent ?? ''
    expect(text).toMatch(/нет ни групп, ни правил, ни провайдеров/)
    expect(text).not.toMatch(/[Дд]окумент пуст/)
    // Диалога импорта во фронтенде пока нет ни одного — обещать его нельзя
    expect(text).not.toMatch(/импорт/i)
  })

  it('подсказки нет, как только на холсте появился хоть один узел', () => {
    const { container } = renderTopology()
    expect(container.querySelector('.canvas-hint')).toBeNull()
  })

  it('причина отказа коммутации показывается диалогом и закрывается', async () => {
    const dismissRefusal = vi.fn()
    renderTopology({ refusal: 'flow-list', dismissRefusal })
    expect(screen.getByText(/одну строку/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Понятно' }))
    expect(dismissRefusal).toHaveBeenCalledOnce()
  })
})

// Подсветка «куда можно воткнуть кабель» — не украшение: без неё кабель тянут
// вслепую. `data-accepts` проставляет PatchbayState по targetKinds, а рисует
// подсветку CSS по префиксу id узла — два независимых списка, которые обязаны
// сходиться. Вид без правила в tokens.css молча остаётся неподсвеченным.
describe('подсветка целей кабеля', () => {
  // Путь относительный: корень vitest — каталог frontend
  const CSS: string = readFileSync('src/shared/ui/tokens.css', 'utf8')

  // Оформления ДВА и проверять надо оба: рамка карточки (`.fnode`) говорит «сюда
  // можно», гнездо (`.react-flow__handle-left`) — куда именно целиться. Проверка
  // одного лишь префикса зеленела бы, пока жив хоть один из двух блоков.
  function highlighted(kind: string): string[] {
    const head = `[data-accepts~='${kind}'] .react-flow__node[data-id^='${kind}:']`
    return [`${head} .fnode`, `${head} .react-flow__handle-left`].filter((s) => CSS.includes(s))
  }

  it('каждый вид цели Mihomo подсвечивает и карточку, и гнездо', () => {
    for (const kind of MIHOMO_TARGET_KINDS) {
      expect(highlighted(kind), kind).toHaveLength(2)
    }
  })

  it('виды целей Xray подсвечиваются по-прежнему', () => {
    // Список литеральный: он сторожит правку, сделанную ради Mihomo, от
    // случайного выпадения колонок соседнего графа
    for (const kind of ['rule', 'out', 'inj', 'bal']) {
      expect(highlighted(kind), kind).toHaveLength(2)
    }
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
