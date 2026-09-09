import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMihomoDraft } from '../src/features/editor/useMihomoDraft'
import { mihomoAdapter } from '../src/features/editor/mihomoAdapter'
import { LOCK_ALIAS, originAt, parseMihomo } from '../src/entities/mihomo'
import { groupsOf } from '../src/entities/mihomo/groups'
import { refusalText } from '../src/entities/graph/mihomo/mutations'
import { useDraftStore } from '../src/features/editor/draftStore'
import { useHistoryStore } from '../src/features/editor/historyStore'

const DOC = [
  'proxy-groups:',
  '  - name: A',
  '    type: select',
  '    proxies:',
  '      - DIRECT',
  'rules:',
  '  - DOMAIN,a.com,A',
  '  - MATCH,A',
  '',
].join('\n')

/**
 * Черновик спрашивает geo-базу по ключам правил (трассировка), а значит живёт
 * внутри react-query. Запрос никуда не уходит, пока не задана цель трассировки,
 * но КЛИЕНТ хуку нужен всегда — отсюда обёртка.
 */
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function renderDraft(text = DOC) {
  return renderHook(
    () => useMihomoDraft({ docKey: 'tpl-1', panelText: text, baseVersion: 'h1' }),
    { wrapper },
  )
}

describe('адаптер Mihomo', () => {
  it('битый YAML даёт ошибку, но документ остаётся разобранным', () => {
    const res = mihomoAdapter.parse('proxy-groups:\n  - name: A\n   type: [\n')
    expect(res.issues.some((i) => i.level === 'error')).toBe(true)
    expect(res.model).toBeDefined()
  })

  it('пустой документ — законная модель: сценарий «с нуля» открывает холст, а не гаснет', () => {
    // Контракт задачи 10: пустой документ — не «нечего разбирать», а
    // отправная точка, на которой холст показывает «+ Добавить»
    expect(mihomoAdapter.parse('').model).toBeDefined()
  })
})

describe('черновик Mihomo', () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {} })
    useHistoryStore.setState({ stacks: {} })
  })

  it('правка поля идёт сплайсом: байты вне правки те же', () => {
    const { result } = renderDraft()
    act(() => result.current.applyOps([{ op: 'set', path: ['proxy-groups', 0, 'type'], value: 'fallback' }]))
    expect(result.current.text).toContain('type: fallback')
    expect(result.current.text).toContain('  - MATCH,A')
    expect(result.current.text.split('\n').length).toBe(DOC.split('\n').length)
  })

  it('переименование группы ведёт выбор за ней', () => {
    const { result } = renderDraft()
    act(() => result.current.setSelectedNode('group:A'))
    act(() => result.current.rename('group', 'A', 'Б'))
    expect(result.current.selectedNode).toBe('group:Б')
    expect(result.current.text).toContain('MATCH,Б')
  })

  it('отказ коммутации виден и снимается', () => {
    // Список задан ссылкой на якорь: writer применяет операцию поверх модели,
    // но лежит она у объявления якоря — коммутация обязана отказать раньше,
    // чем дойдёт до писателя, и текст держится без изменений.
    const text = 'x-anchors:\n  base: &base\n    - DIRECT\nproxy-groups:\n  - name: A\n    proxies: *base\n'
    const { result } = renderDraft(text)
    act(() => result.current.connect('group:A', 'builtin:REJECT'))
    // `refusal` — уже переведённый текст, не код причины: writer и кабель
    // делят один и тот же вид отказа наружу
    expect(result.current.refusal).toBe(refusalText('alias-list'))
    expect(result.current.text).toBe(text)
    act(() => result.current.dismissRefusal())
    expect(result.current.refusal).toBeNull()
  })

  it('успешная коммутация правит документ и причины не оставляет', () => {
    const { result } = renderDraft()
    act(() => result.current.connect('group:A', 'builtin:REJECT'))
    expect(result.current.text).toContain('- REJECT')
    expect(result.current.refusal).toBeNull()
  })

  it('удаление правила снимает выбор: id правил позиционные', () => {
    const { result } = renderDraft()
    act(() => result.current.setSelectedNode('rule:0'))
    act(() => result.current.applyOps([{ op: 'remove', path: ['rules', 0] }], null))
    expect(result.current.selectedNode).toBeNull()
    expect(result.current.text).not.toContain('DOMAIN,a.com,A')
  })

  it('перестановка правила ведёт выбор за ним', () => {
    const { result } = renderDraft()
    act(() => result.current.setSelectedNode('rule:0'))
    act(() => result.current.applyOps([{ op: 'move', path: ['rules'], from: 0, to: 1 }], 'rule:1'))
    expect(result.current.selectedNode).toBe('rule:1')
  })

  it('все операции отказали — выбор не переносится (документ не изменился)', () => {
    // Находка ревью-минора: `select` применялся даже когда ни одна операция
    // не прошла — узел, на который просился перенос (например, после смены
    // тега кабелем), в документе так и не появился, а выбор врал об успехе.
    const text = [
      'x-anchors:',
      '  base: &base',
      '    type: select',
      'proxy-groups:',
      '  - name: A',
      '    <<: *base',
      '    proxies: [DIRECT]',
      'rules:',
      '  - DOMAIN,a.com,A',
      '',
    ].join('\n')
    const { result } = renderDraft(text)
    act(() => result.current.setSelectedNode('group:A'))
    act(() => result.current.applyOps(
      [{ op: 'set', path: ['proxy-groups', 0, 'type'], value: 'fallback' }],
      'rule:0',
    ))
    expect(result.current.selectedNode).toBe('group:A')
    expect(result.current.text).toBe(text)
  })

  it('правки складываются в историю по одной', () => {
    const { result } = renderDraft()
    act(() => result.current.applyOps([{ op: 'set', path: ['proxy-groups', 0, 'type'], value: 'fallback' }]))
    act(() => result.current.applyOps([{ op: 'set', path: ['proxy-groups', 0, 'type'], value: 'relay' }]))
    act(() => result.current.doUndo())
    expect(result.current.text).toContain('type: fallback')
  })

  // Ниже — операции, объявленные в интерфейсе задачи, но не покрытые её
  // основным набором: без них проброс мог бы разойтись с `entities/mihomo`
  // молча, а потребитель (формы инспектора) появится только в следующих задачах.

  it('originAt пропускает наружу все четыре происхождения: own, merged, alias, absent', () => {
    // Одна фикстура на весь союз: `name` — своё поле, `type` приходит слиянием
    // `<<: *base`, `remnawave` — ссылка на якорь, `filter` отсутствует.
    // Сужение союза в пробросе (например, `merged` → `own`) обязано покраснеть
    // здесь, иначе форма сочла бы значение из якоря своим и предложила правку,
    // которую писатель всё равно отклоняет.
    const text = [
      'x-anchors:',
      '  base: &base',
      '    type: select',
      '  rw: &rw',
      '    include-proxies: false',
      'proxy-groups:',
      '  - name: A',
      '    <<: *base',
      '    remnawave: *rw',
      '',
    ].join('\n')
    const { result } = renderDraft(text)
    const origin = (parts: (string | number)[], key: string) => originAt(result.current.md!, parts, key)
    expect(origin(['proxy-groups', 0], 'name')).toBe('own')
    expect(origin(['proxy-groups', 0], 'type')).toBe('merged')
    expect(origin(['proxy-groups', 0], 'remnawave.include-proxies')).toBe('alias')
    expect(origin(['proxy-groups', 0], 'filter')).toBe('absent')
    // Правки по merged- и alias-путям отказывают — черновик остаётся нетронутым
    act(() => result.current.applyOps([{ op: 'set', path: ['proxy-groups', 0, 'type'], value: 'fallback' }]))
    act(() => result.current.applyOps([
      { op: 'set', path: ['proxy-groups', 0, 'remnawave', 'include-proxies'], value: true },
    ]))
    expect(result.current.text).toBe(text)
  })

  it('замена списка не трогает соседние секции', () => {
    const { result } = renderDraft()
    act(() => result.current.applyOps([
      { op: 'set', path: ['proxy-groups', 0, 'proxies'], value: ['DIRECT', 'REJECT'] },
    ]))
    const md = parseMihomo(result.current.text)
    expect(md.doc.errors).toEqual([])
    expect(result.current.text).toContain('- REJECT')
    expect(result.current.text).toContain('  - MATCH,A')
  })

  it('замена строки правила переписывает только её', () => {
    const { result } = renderDraft()
    act(() => result.current.applyOps([{ op: 'set', path: ['rules', 0], value: 'DOMAIN-SUFFIX,b.com,A' }]))
    expect(result.current.text).toContain('DOMAIN-SUFFIX,b.com,A')
    expect(result.current.text).not.toContain('DOMAIN,a.com,A')
    expect(result.current.text).toContain('  - MATCH,A')
  })

  it('разрыв связи убирает участника и причины не оставляет', () => {
    const { result } = renderDraft()
    act(() => result.current.disconnect(['e:group:A->builtin:DIRECT']))
    expect(result.current.text).not.toContain('- DIRECT')
    expect(result.current.text).toContain('  - MATCH,A')
    expect(result.current.refusal).toBeNull()
  })

  it('отказ разрыва поднимает причину и документ не трогает', () => {
    // У правила цель обязательна — разрывать нечего; фикстура та же, что и у
    // успешного разрыва выше, так что различает ветви именно ребро, а не документ
    const { result } = renderDraft()
    act(() => result.current.disconnect(['e:rule:0->group:A']))
    // Причина называет настоящее основание: связь у правила можно только
    // сменить, а не убрать. Прежний `invalid-pair` объяснял отказ узлом
    // подстановки, которого в этом ребре нет.
    expect(result.current.refusal).toBe(refusalText('rule-target-required'))
    expect(result.current.text).toBe(DOC)
  })

  it('удаление выбранной группы убирает её и снимает выбор', () => {
    const text = [
      'proxy-groups:',
      '  - name: A',
      '    type: select',
      '    proxies:',
      '      - DIRECT',
      '  - name: B',
      '    type: select',
      '    proxies:',
      '      - DIRECT',
      'rules:',
      '  - MATCH,B',
      '',
    ].join('\n')
    const { result } = renderDraft(text)
    act(() => result.current.setSelectedNode('group:A'))
    act(() => result.current.applyOps([{ op: 'remove', path: ['proxy-groups', 0] }], null))
    expect(result.current.selectedNode).toBeNull()
    expect(result.current.text).not.toContain('name: A')
    expect(result.current.text).toContain('name: B')
    expect(parseMihomo(result.current.text).doc.errors).toEqual([])
  })
})

describe('черновик Mihomo — писатель (DocWriter)', () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {} })
    useHistoryStore.setState({ stacks: {} })
  })

  it('applyOps пишет через писатель одним снимком истории; отказ показывается текстом', async () => {
    // Анкор обязан идти РАНЬШЕ ссылки на него в тексте документа: `yaml` не
    // резолвит обратные ссылки ни при разборе значений, ни при перепечатке
    // (`Unresolved alias: the anchor must be set before the alias`) — это
    // общее правило библиотеки, а не свойство этой конкретной правки.
    const { result } = renderDraft('x:\n  l: &l [DIRECT]\nproxy-groups:\n  - name: A\n    type: select\n    proxies: *l\n')
    act(() => result.current.applyOps([{ op: 'set', path: ['proxy-groups', 0, 'hidden'], value: true }]))
    expect(result.current.text).toContain('hidden: true')
    act(() => result.current.applyOps([{ op: 'insert', path: ['proxy-groups', 0, 'proxies'], index: 0, value: 'REJECT' }]))
    expect(result.current.refusal).toBe(LOCK_ALIAS)
    act(() => result.current.doUndo())
    expect(result.current.text).not.toContain('hidden: true')
    // Стухший отказ не должен переживать следующую успешную правку — иначе
    // диалог «так соединить нельзя» висел бы и после того, как форма спокойно
    // записала поле
    act(() => result.current.applyOps([{ op: 'set', path: ['proxy-groups', 0, 'hidden'], value: true }]))
    expect(result.current.refusal).toBeNull()
  })

  it('writer и lockAt держат тождество между рендерами — иначе формы, memo\'ящие по writer, пересобирались бы на каждую правку', () => {
    const { result } = renderDraft()
    const writer = result.current.writer
    const lockAt = result.current.lockAt
    act(() => result.current.applyOps([{ op: 'set', path: ['proxy-groups', 0, 'hidden'], value: true }]))
    // Документ поменялся (черновик перезаписан, компонент перерендерился), но
    // тождество писателя — нет: зависимости callback'ов читают `core.*` из
    // ref, а не из замыкания над плоской функцией `useDocumentDraft`, которая
    // получает новое тождество на каждый рендер
    expect(result.current.text).toContain('hidden: true')
    expect(result.current.writer).toBe(writer)
    expect(result.current.lockAt).toBe(lockAt)
  })

  it('lockAt отдаёт замок с действием «Развернуть значение здесь», materialize снимает его', () => {
    const { result } = renderDraft('x:\n  l: &l [DIRECT]\nproxy-groups:\n  - name: A\n    type: select\n    proxies: *l\n')
    const lock = result.current.lockAt(['proxy-groups', 0, 'proxies'])
    expect(lock?.action?.label).toBe('Развернуть значение здесь')
    act(() => lock!.action!.run())
    expect(result.current.lockAt(['proxy-groups', 0, 'proxies'])).toBeNull()
    expect(result.current.text).toContain('&l')
  })

  it('rename ведёт ссылки и переносит выбор за узлом', () => {
    const { result } = renderDraft('proxy-groups:\n  - name: A\n    type: select\nrules:\n  - MATCH,A\n')
    act(() => result.current.setSelectedNode('group:A'))
    let refusal: string | null = null
    act(() => { refusal = result.current.rename('group', 'A', 'B') })
    expect(refusal).toBeNull()
    expect(result.current.text).toContain('MATCH,B')
    expect(result.current.selectedNode).toBe('group:B')
    act(() => { refusal = result.current.rename('group', 'B', 'DIRECT') })
    expect(refusal).toMatch(/занято/)
  })

  it('disconnect разрывает несколько рёбер одной пачкой', () => {
    const { result } = renderDraft('proxy-groups:\n  - name: A\n    type: select\n    proxies: [DIRECT, REJECT]\n')
    act(() => result.current.disconnect(['e:group:A->builtin:DIRECT', 'e:group:A->builtin:REJECT']))
    expect(groupsOf(result.current.md!)[0]!.proxies).toEqual([])
  })
})

describe('трассировка в черновике Mihomo', () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {} })
    useHistoryStore.setState({ stacks: {} })
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  const target = (address: string) => ({ address, port: 443, network: 'tcp' as const })

  it('разбор появляется только после паузы и считается по цели', () => {
    const { result } = renderDraft()
    expect(result.current.trace).toBeUndefined()
    act(() => result.current.setTraceTarget(target('a.com')))
    // Ввод ещё не затих: дергать бэкенд и пересчитывать вердикты рано
    expect(result.current.trace).toBeUndefined()
    act(() => vi.advanceTimersByTime(600))
    expect(result.current.trace?.winner).toEqual({ ruleIndex: 0, target: 'A' })
  })

  it('другая цель даёт другого победителя, а не тот же самый', () => {
    const { result } = renderDraft()
    act(() => result.current.setTraceTarget(target('b.com')))
    act(() => vi.advanceTimersByTime(600))
    // DOMAIN,a.com не подходит — ловит MATCH вторым правилом
    expect(result.current.trace?.winner).toEqual({ ruleIndex: 1, target: 'A' })
  })

  it('снятая цель убирает разбор сразу, без ожидания паузы', () => {
    const { result } = renderDraft()
    act(() => result.current.setTraceTarget(target('a.com')))
    act(() => vi.advanceTimersByTime(600))
    expect(result.current.trace).toBeDefined()
    act(() => result.current.setTraceTarget(null))
    expect(result.current.trace).toBeUndefined()
  })
})

describe('трассировка спрашивает geo-базу по ключам документа', () => {
  const GEO_DOC = [
    'proxy-groups:',
    '  - name: A',
    '    proxies:',
    '      - DIRECT',
    'rules:',
    '  - GEOSITE,ads,A',
    '  - MATCH,DIRECT',
    '',
  ].join('\n')

  /** Тела POST-запросов к ручке geo — по ним видно, какие ключи ушли */
  let geoBodies: Record<string, unknown>[] = []

  beforeEach(() => {
    useDraftStore.setState({ drafts: {} })
    useHistoryStore.setState({ stacks: {} })
    qc.clear()
    geoBodies = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/api/tools/geo/match')) {
          geoBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
        }
        return new Response(
          JSON.stringify({ loaded: true, answers: { 'geosite:ads': true }, missing: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  const target = { address: 'a.com', port: 443, network: 'tcp' as const }

  it('ключи правил уходят в запрос, а ответ доходит до вердикта', async () => {
    const { result } = renderDraft(GEO_DOC)
    act(() => result.current.setTraceTarget(target))
    // Пауза ввода настоящая: подменять таймеры посреди react-query дороже
    await waitFor(() => expect(geoBodies).toHaveLength(1), { timeout: 3000 })
    expect(geoBodies[0]).toEqual({ domain: 'a.com', ip: undefined, keys: ['geosite:ads'] })
    // Ответ базы обязан дойти до трассировки: иначе GEOSITE вечно останавливал
    // бы проход, выглядя при этом «честным»
    await waitFor(() => expect(result.current.trace?.winner?.target).toBe('A'), { timeout: 3000 })
    expect(result.current.trace?.stopped).toBeUndefined()
  })

  it('без geo-правил базу не спрашивают вовсе', async () => {
    const { result } = renderDraft()
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.trace).toBeDefined(), { timeout: 3000 })
    expect(geoBodies).toEqual([])
  })
})

/**
 * Наборы правил: что уходит на бэкенд, что известно без него и что значит
 * «ответ ещё едет». Документ намеренно без geo-условий — иначе в тесте были бы
 * два запроса, и провалившийся ответ одного лечился бы другим.
 */
describe('трассировка спрашивает наборы правил', () => {
  const SET_DOC = (...rules: string[]) =>
    [
      'rule-providers:',
      '  net:',
      '    type: http',
      '    behavior: domain',
      '    format: mrs',
      '    url: https://example.com/net.mrs',
      '    proxy: Авто',
      '    interval: 86400',
      '  local:',
      '    type: file',
      '    behavior: domain',
      '    format: yaml',
      '    path: ./local.yaml',
      '  weird:',
      '    type: http',
      '    behavior: чепуха',
      '    format: yaml',
      '    url: https://example.com/weird.yaml',
      'rules:',
      ...rules.map((r) => `  - ${r}`),
      '',
    ].join('\n')

  /** Тела POST-запросов к ручке наборов — по ним видно, что именно спросили */
  let setBodies: Record<string, unknown>[] = []
  /** Ответ ручки держится здесь: тест решает, когда он приедет и приедет ли */
  let answer: Promise<Response>

  const respond = (answers: Record<string, unknown>) =>
    Promise.resolve(
      new Response(JSON.stringify({ answers }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

  beforeEach(() => {
    useDraftStore.setState({ drafts: {} })
    useHistoryStore.setState({ stacks: {} })
    qc.clear()
    setBodies = []
    answer = respond({ net: { state: 'no', count: 0 } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/api/tools/ruleset/match')) {
          setBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
          return answer
        }
        throw new Error(`Неожиданный запрос: ${String(input)}`)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  const target = { address: 'a.com', port: 443, network: 'tcp' as const }

  it('на бэкенд уходят только http-наборы, файл и незнакомый вид — нет', async () => {
    const { result } = renderDraft(SET_DOC('RULE-SET,net,A', 'MATCH,A'))
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(setBodies).toHaveLength(1), { timeout: 3000 })
    expect(setBodies[0]).toEqual({
      target: { address: 'a.com' },
      sets: [
        {
          name: 'net',
          kind: 'http',
          url: 'https://example.com/net.mrs',
          behavior: 'domain',
          format: 'mrs',
          intervalSec: 86400,
        },
      ],
    })
  })

  it('адрес-IP уезжает на бэкенд как адрес назначения', async () => {
    // Иначе выходит расхождение на ровном месте: правило IP-CIDR из документа
    // на цели 10.1.2.3 совпадает, а набор подсетей отвечает «в цели нет IP
    // назначения», потому что поле не попало в запрос. Вывод цели обязан
    // произойти ДО запроса, а не только внутри трассировки
    const { result } = renderDraft(SET_DOC('RULE-SET,net,A', 'MATCH,A'))
    act(() => result.current.setTraceTarget({ ...target, address: '10.1.2.3' }))
    await waitFor(() => expect(setBodies).toHaveLength(1), { timeout: 3000 })
    expect(setBodies[0]!.target).toEqual({ address: '10.1.2.3', ip: '10.1.2.3' })
  })

  it('набор из файла клиента останавливает проход и называет причину без сети', async () => {
    const { result } = renderDraft(SET_DOC('RULE-SET,net,A', 'RULE-SET,local,A', 'MATCH,A'))
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.trace?.stopped?.index).toBe(1), { timeout: 3000 })
    expect(result.current.trace?.stopped?.reason).toMatch(/«local»/)
    expect(result.current.trace?.stopped?.reason).toMatch(/файл/)
  })

  it('набор незнакомого вида останавливает проход своей причиной, а не общей', async () => {
    const { result } = renderDraft(SET_DOC('RULE-SET,net,A', 'RULE-SET,weird,A', 'MATCH,A'))
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.trace?.stopped?.index).toBe(1), { timeout: 3000 })
    expect(result.current.trace?.stopped?.reason).toMatch(/«weird»/)
    expect(result.current.trace?.stopped?.reason).toMatch(/незнаком/)
  })

  it('пока ответ едет, причина остановки — «ещё загружается», а не промах', async () => {
    // Ответ не приедет никогда: важна ровно та секунда, пока запрос в пути
    answer = new Promise<Response>(() => {})
    const { result } = renderDraft(SET_DOC('RULE-SET,net,A', 'MATCH,A'))
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.trace?.stopped?.index).toBe(0), { timeout: 3000 })
    expect(result.current.trace?.stopped?.reason).toMatch(/загружа/)
  })

  it('приехавший ответ доводит проход до конца', async () => {
    const { result } = renderDraft(SET_DOC('RULE-SET,net,A', 'MATCH,A'))
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.trace?.winner?.ruleIndex).toBe(1), { timeout: 3000 })
    expect(result.current.trace?.stopped).toBeUndefined()
  })

  it('без наборов в документе ручку не дёргают вовсе', async () => {
    const { result } = renderDraft()
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.trace).toBeDefined(), { timeout: 3000 })
    expect(setBodies).toEqual([])
  })

  it('успешный ответ сервера не перекрывается локальным отказом: state остаётся "yes"', async () => {
    answer = respond({ net: { state: 'yes', count: 3 } })
    const { result } = renderDraft(SET_DOC('RULE-SET,net,A', 'MATCH,A'))
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.trace?.winner?.ruleIndex).toBe(0), { timeout: 3000 })
    expect(result.current.trace?.winner?.target).toBe('A')
    expect(result.current.trace?.verdicts[0]?.state).toBe('yes')
    expect(result.current.trace?.verdicts[0]?.sets).toEqual([{ name: 'net', count: 3 }])
  })

  it('успевший ответ переживает последующий отказ сети: старые данные не тонут в failedAnswers', async () => {
    // Ловит мутацию порядка склейки: TanStack Query на неудачном ПОВТОРНОМ
    // запросе держит isError=true, но НЕ обнуляет ранее полученный data —
    // так что данные и отказ существуют одновременно, и порядок спреда решает,
    // кто победит. Правильный порядок — данные последними, они и должны
    // остаться победителем; переставленный порядок вернул бы «запрос не удался»
    // поверх всё ещё годного кэша.
    answer = respond({ net: { state: 'yes', count: 3 } })
    const { result } = renderDraft(SET_DOC('RULE-SET,net,A', 'MATCH,A'))
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.trace?.verdicts[0]?.state).toBe('yes'), { timeout: 3000 })

    // Тот же запрос (тот же ключ) на этот раз отказывает — стухший успешный
    // ответ у TanStack Query остаётся в кэше рядом с новой ошибкой
    answer = Promise.resolve(
      new Response(JSON.stringify({ message: 'Сервер недоступен' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['ruleset-match'], type: 'all' })
      // notifyManager у TanStack Query планирует уведомление подписчиков
      // отдельным тиком — без него React не успевает перерендерить хук до
      // следующей проверки
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current.trace?.verdicts[0]?.state).toBe('yes')
    expect(result.current.trace?.stopped).toBeUndefined()
  })
})

describe('наборы правил: отказы и диагностики', () => {
  const DOC = [
    'rule-providers:',
    '  ads:',
    '    type: http',
    '    behavior: domain',
    '    format: mrs',
    '    url: https://example.com/ads.mrs',
    '  local:',
    '    type: file',
    '    behavior: domain',
    '    path: ./local.yaml',
    'rules:',
    '  - RULE-SET,ads,REJECT',
    '  - MATCH,PROXY',
    '',
  ].join('\n')

  const json = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )

  /** Куда и с чем ходили: по этому видно, о чём спросили базу */
  let calls: { url: string; body: Record<string, unknown> }[] = []
  /** Ответ ручки наборов держится здесь: тест решает, каким он будет */
  let matchResponse: () => Promise<Response>

  beforeEach(() => {
    useDraftStore.setState({ drafts: {} })
    useHistoryStore.setState({ stacks: {} })
    qc.clear()
    calls = []
    matchResponse = () =>
      json({ answers: { ads: { state: 'unavailable', reason: 'не удалось скачать: 404' } } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
        if (url.includes('/api/tools/ruleset/match')) return matchResponse()
        if (url.includes('/api/tools/geo/match')) {
          return json({ loaded: true, answers: {}, missing: [] })
        }
        throw new Error(`Неожиданный запрос: ${url}`)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  const target = { address: 'a.com', port: 443, network: 'tcp' as const }

  it('сбой запроса называет причину по каждому спрошенному набору', async () => {
    // Без этого отказ на границе роута обнулял ответы по ВСЕМУ документу, и
    // каждое правило получало общее «содержимое редактору неизвестно»
    matchResponse = () => json({ message: 'Тело великовато' }, 500)
    const { result } = renderDraft(DOC)
    act(() => result.current.setTraceTarget(target))
    await waitFor(
      () => expect(result.current.trace?.stopped?.reason).toMatch(/запрос к серверу не удался/),
      { timeout: 3000 },
    )
    expect(result.current.trace?.stopped?.reason).toMatch(/Тело великовато/)
  })

  it('недоступный набор и набор из файла клиента становятся предупреждениями', async () => {
    const { result } = renderDraft(DOC)
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.issues.some((i) => i.path.includes('ads'))).toBe(true), {
      timeout: 3000,
    })
    const issue = result.current.issues.find((i) => i.path.includes('ads'))!
    // Предупреждение, а не ошибка: документ корректен, и сохранение не
    // блокируется нашей неспособностью скачать чужой файл
    expect(issue.level).toBe('warning')
    expect(issue.message).toMatch(/404/)
    expect(result.current.issues.some((i) => i.path.includes('local'))).toBe(true)
    // Счётчик в статус-баре обязан их видеть, иначе список и число разойдутся
    expect(result.current.warningCount).toBeGreaterThanOrEqual(2)
  })

  it('без цели трассировки сетевых предупреждений нет: мы ещё не спрашивали', async () => {
    const { result } = renderDraft(DOC)
    await waitFor(() => expect(result.current.md).toBeDefined())
    // Утверждать, что набор недоступен, не спросив о нём, было бы выдумкой
    expect(result.current.issues.some((i) => i.path.includes('ads'))).toBe(false)
    expect(calls).toEqual([])
  })

  it('geo-ключи спрашиваются и по строкам набора classical', async () => {
    const doc = [
      'rule-providers:',
      '  region:',
      '    type: http',
      '    behavior: classical',
      '    url: https://example.com/region.yaml',
      'rules:',
      '  - RULE-SET,region,PROXY',
      '  - MATCH,D',
      '',
    ].join('\n')
    matchResponse = () =>
      json({ answers: { region: { state: 'lines', lines: ['GEOSITE,cn'], count: 1 } } })
    const { result } = renderDraft(doc)
    act(() => result.current.setTraceTarget(target))
    await waitFor(
      () => {
        const geo = calls.filter((c) => c.url.includes('/api/tools/geo/match')).at(-1)
        expect((geo?.body.keys as string[] | undefined) ?? []).toContain('geosite:cn')
      },
      { timeout: 3000 },
    )
    expect(result.current.md).toBeDefined()
  })
})
