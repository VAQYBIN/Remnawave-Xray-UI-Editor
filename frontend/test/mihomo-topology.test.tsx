// НЕ ЗАМЕНЯТЬ на `import css from '...tokens.css?raw'`. Проверяемый факт: у
// vitest в этом проекте `css: false`, и любой импорт CSS — включая сырой `?raw`
// — подменяется заглушкой, то есть в переменной окажется ПУСТАЯ СТРОКА. Убедиться
// можно за один прогон: подставьте `?raw` и распечатайте длину — она нулевая.
//
// Что будет дальше, зависит от силы утверждений, и обе развилки плохие. С
// нынешними (ниже ищутся конкретные селекторы) тест на пустой строке ПАДАЕТ —
// и выглядит это как «комментарий протух, тест сломан», хотя сломан импорт.
// Естественная реакция — ослабить утверждение, чтобы прошло; тогда тест станет
// зелёным навсегда и перестанет что-либо проверять. Ровно это и случилось в
// первой версии здешней проверки: она смотрела только на префикс селектора,
// зеленела при любом состоянии tokens.css, и поймали её мутацией, а не глазами.
//
// Поэтому источник — файл с диска. Цена — одно подавление типов: @types/node в
// tsconfig фронтенда нет (`types: ["vite/client"]`), а тянуть их ради одного
// теста или включать `css: true` и замедлять весь набор дороже, чем строка ниже.
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
  nextRulePlacement,
} from '../src/features/topology/MihomoTopology'
import { usePositionsStore } from '../src/features/topology/positionsStore'
import { buildMihomoGraph, layoutMihomo } from '../src/entities/graph/mihomo/buildGraph'
import { parseMihomo } from '../src/entities/mihomo'
import { mihomoFixture } from './helpers'

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
    // Две карточки подстановки на этом документе: у группы «Основная» и
    // корневая — панель дописывает хосты в корневой `proxies` ВСЕГДА, узел
    // `hosts:root` рисуется независимо от группы (маркер декоративен)
    expect(screen.getAllByText('хосты панели')).toHaveLength(2)
    expect(screen.getByText('фильтр: (RU)')).toBeInTheDocument()
    expect(screen.getByText('подсписок')).toBeInTheDocument()
    expect(screen.getByText('правил: 2')).toBeInTheDocument()
    expect(screen.getByText('встроенная')).toBeInTheDocument()
    expect(screen.getByText('REJECT')).toBeInTheDocument()
  })

  it('карточка группы говорит о хостах панели условно и в обе стороны', () => {
    // «Без хостов» обязана явно отказаться (`include-proxies: false`): без
    // этого ключа панель по умолчанию дописывает хосты и в эту группу тоже
    // (маркер декоративен, решают ключи документа, см. entities/mihomo/inject.ts)
    const md = parseMihomo(
      'proxy-groups:\n  - name: С хостами\n    include-all: true\n  - name: Без хостов\n    remnawave:\n      include-proxies: false\n    proxies:\n      - DIRECT\n',
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

  function hintOn(doc: string): string {
    const { container } = render(
      <ReactFlowProvider>
        <MihomoTopology draft={draftStub()} md={parseMihomo(doc)} />
      </ReactFlowProvider>,
    )
    const hint = container.querySelector('.canvas-hint')
    expect(hint).not.toBeNull()
    return hint!.textContent ?? ''
  }

  it('подсказка пустого холста говорит про разбор, а не про содержимое документа', () => {
    // Корень документа — список, а не отображение: панели, в отличие от
    // документа-отображения, здесь физически некуда класть хосты (`isMap` в
    // `buildMihomoGraph` не пропускает узел `hosts:root`), и холст остаётся
    // пустым несмотря на непустой текст
    const text = hintOn('- a\n- b\n')
    expect(text).toMatch(/не нашёл/)
    expect(text).not.toMatch(/[Дд]окумент пуст/)
    // Импорт из каталога с этого холста недостижим: кнопка живёт в топбаре
    // СТРАНИЦЫ, а `MihomoTopology` о ней не знает и рендерится без неё — в том
    // числе здесь. Подсказка обязана звать туда, что стоит рядом с ней: в док и
    // на вкладку YAML. (Прежнее обоснование — «диалога импорта нет ни одного» —
    // пережило свою правду: диалог в ветке появился.)
    expect(text).not.toMatch(/импорт/i)
  })

  // Панель дописывает хосты в корневой `proxies` ВСЕГДА (маркер декоративен) —
  // `hosts:root` рисуется у любого документа-отображения без всяких условий
  // (см. buildMihomoGraph). Холст с одним только скалярными настройками или с
  // неназванной записью группы (`groupsOf` её пропускает, узла у неё нет) —
  // всё равно НЕ пуст: подсказки не будет, а карточка подстановки будет.
  it('документ-отображение без единой группы, правила или провайдера всё равно не пуст: виден узел подстановки', () => {
    const { container } = render(
      <ReactFlowProvider>
        <MihomoTopology draft={draftStub()} md={parseMihomo('port: 7890\nmode: rule\n')} />
      </ReactFlowProvider>,
    )
    expect(container.querySelector('.canvas-hint')).toBeNull()
    expect(screen.getByText('хосты панели')).toBeInTheDocument()
  })

  it('запись группы без имени не мешает узлу подстановки появиться на холсте', () => {
    // `- type: select` без `name` группой не считается (`groupsOf` её
    // пропускает), но корень документа всё равно отображение — узел подстановки
    // рисуется независимо от того, нашлась ли хоть одна именованная группа
    const { container } = render(
      <ReactFlowProvider>
        <MihomoTopology draft={draftStub()} md={parseMihomo('proxy-groups:\n  - type: select\n')} />
      </ReactFlowProvider>,
    )
    expect(container.querySelector('.canvas-hint')).toBeNull()
    expect(screen.getByText('хосты панели')).toBeInTheDocument()
  })

  it('подсказки нет, как только на холсте появился хоть один узел', () => {
    const { container } = renderTopology()
    expect(container.querySelector('.canvas-hint')).toBeNull()
  })

  it('причина отказа коммутации показывается диалогом и закрывается', async () => {
    // `flow-list` больше не существует (задача 9: операции поверх модели
    // принимают список в одну строку без отказа) — той же проверке годится
    // любой сохранившийся отказ, здесь взят `alias-list`.
    const dismissRefusal = vi.fn()
    renderTopology({ refusal: 'alias-list', dismissRefusal })
    expect(screen.getByText(/якор/)).toBeInTheDocument()
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

describe('дефект 3в: место и текст нового правила', () => {
  it('последнее правило — MATCH: заготовка встаёт ПЕРЕД ним и сама не MATCH', () => {
    const md = parseMihomo('rules:\n  - DOMAIN,a.com,DIRECT\n  - MATCH,DIRECT\n')
    expect(nextRulePlacement(md)).toEqual({ raw: 'DOMAIN-SUFFIX,example.com,DIRECT', at: 1 })
  })

  it('MATCH в конце нет: MATCH,DIRECT дописывается в конец', () => {
    const md = parseMihomo('rules:\n  - DOMAIN,a.com,DIRECT\n')
    expect(nextRulePlacement(md)).toEqual({ raw: 'MATCH,DIRECT' })
  })

  it('правил ещё нет: MATCH,DIRECT — первое правило документа', () => {
    expect(nextRulePlacement(parseMihomo('mode: rule\n'))).toEqual({ raw: 'MATCH,DIRECT' })
  })

  it('док вставляет правило перед финальным MATCH шаблона панели', async () => {
    const addRuleText = vi.fn()
    // Хвост default.yaml: `- MATCH,→ Remnawave`. Новое MATCH после него было бы
    // мёртвым — в Mihomo выигрывает первое совпавшее правило
    const md = parseMihomo(mihomoFixture('default'))
    render(
      <ReactFlowProvider>
        <MihomoTopology draft={draftStub({ addRuleText })} md={md} />
      </ReactFlowProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '+ Правило' }))
    expect(addRuleText).toHaveBeenCalledWith('DOMAIN-SUFFIX,example.com,DIRECT', 2)
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

describe('вердикт трассировки на карточке правила', () => {
  const trace = {
    verdicts: [
      { index: 0, state: 'no' as const, target: 'Основная' },
      { index: 1, state: 'yes' as const, target: 'block' },
    ],
    winner: { ruleIndex: 1, target: 'block' },
    caveats: [],
  }

  it('победитель отделён от обычного совпадения', () => {
    renderTopology({ trace })
    // «маршрут» — только у победителя, проигравший подписан своим состоянием
    expect(screen.getByText('маршрут')).toBeInTheDocument()
    expect(screen.getByText('не совпало')).toBeInTheDocument()
    // Победителя не подписали как рядовое совпадение
    expect(screen.queryByText('совпало')).not.toBeInTheDocument()
  })

  it('правило, до которого проход не дошёл, бейджа не получает', () => {
    // Разбор оборвался на первом правиле: у второго вердикта нет вовсе
    const stopped = {
      verdicts: [{ index: 0, state: 'unknown' as const, reason: 'набор правил «ads»: сервер ответил 404' }],
      stopped: { index: 0, reason: 'набор правил «ads»: сервер ответил 404' },
      caveats: [],
    }
    const { container } = renderTopology({ trace: stopped })
    expect(screen.getByText('проверить нечем')).toBeInTheDocument()
    expect(container.querySelectorAll('.trace-badge')).toHaveLength(1)
  })

  it('без трассировки бейджей нет ни на одной карточке', () => {
    const { container } = renderTopology()
    expect(container.querySelectorAll('.trace-badge')).toHaveLength(0)
  })

  it('mihomoTraceStateOf отличает победителя, вердикт и отсутствие вердикта', async () => {
    const { mihomoTraceStateOf } = await import('../src/features/topology/MihomoTopology')
    expect(mihomoTraceStateOf(trace, 1)).toBe('winner')
    expect(mihomoTraceStateOf(trace, 0)).toBe('no')
    expect(mihomoTraceStateOf(trace, 2)).toBeUndefined()
    expect(mihomoTraceStateOf(undefined, 0)).toBeUndefined()
  })
})

describe('док топологии Mihomo', () => {
  it('принимает контролы инструментов и вторую строку', () => {
    render(
      <ReactFlowProvider>
        <MihomoTopology
          draft={draftStub()}
          md={parseMihomo(DOC)}
          dockExtra={<button type="button">Куда пойдёт трафик</button>}
          dockRow={<span>строка ввода цели</span>}
        />
      </ReactFlowProvider>,
    )
    expect(screen.getByRole('button', { name: 'Куда пойдёт трафик' })).toBeInTheDocument()
    expect(screen.getByText('строка ввода цели')).toBeInTheDocument()
  })
})
