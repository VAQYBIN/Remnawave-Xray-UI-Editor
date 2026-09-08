import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMihomoDraft } from '../src/features/editor/useMihomoDraft'
import { mihomoAdapter } from '../src/features/editor/mihomoAdapter'
import { parseMihomo } from '../src/entities/mihomo'
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

function draft(text = DOC) {
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

  it('пустой документ модели не даёт', () => {
    expect(mihomoAdapter.parse('').model).toBeUndefined()
  })

  it('подпись текстовой вкладки — YAML', () => {
    expect(mihomoAdapter.textTabLabel).toBe('YAML')
  })
})

describe('черновик Mihomo', () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {} })
    useHistoryStore.setState({ stacks: {} })
  })

  it('правка поля идёт сплайсом: байты вне правки те же', () => {
    const { result } = draft()
    act(() => result.current.setField(['proxy-groups', 0], 'type', 'fallback'))
    expect(result.current.text).toContain('type: fallback')
    expect(result.current.text).toContain('  - MATCH,A')
    expect(result.current.text.split('\n').length).toBe(DOC.split('\n').length)
  })

  it('переименование группы ведёт выбор за ней', () => {
    const { result } = draft()
    act(() => result.current.setSelectedNode('group:A'))
    act(() => result.current.renameGroupTo(0, 'Б'))
    expect(result.current.selectedNode).toBe('group:Б')
    expect(result.current.text).toContain('MATCH,Б')
  })

  it('отказ коммутации виден и снимается', () => {
    const { result } = draft('proxy-groups:\n  - name: A\n    proxies: [DIRECT]\n')
    act(() => result.current.connect('group:A', 'builtin:REJECT'))
    expect(result.current.refusal).toBe('flow-list')
    act(() => result.current.dismissRefusal())
    expect(result.current.refusal).toBeNull()
  })

  it('успешная коммутация правит документ и причины не оставляет', () => {
    const { result } = draft()
    act(() => result.current.connect('group:A', 'builtin:REJECT'))
    expect(result.current.text).toContain('- REJECT')
    expect(result.current.refusal).toBeNull()
  })

  it('удаление правила снимает выбор: id правил позиционные', () => {
    const { result } = draft()
    act(() => result.current.setSelectedNode('rule:0'))
    act(() => result.current.removeSelected())
    expect(result.current.selectedNode).toBeNull()
    expect(result.current.text).not.toContain('DOMAIN,a.com,A')
  })

  it('перестановка правила ведёт выбор за ним', () => {
    const { result } = draft()
    act(() => result.current.setSelectedNode('rule:0'))
    act(() => result.current.moveSelected(1))
    expect(result.current.selectedNode).toBe('rule:1')
  })

  it('правки складываются в историю по одной', () => {
    const { result } = draft()
    act(() => result.current.setField(['proxy-groups', 0], 'type', 'fallback'))
    act(() => result.current.setField(['proxy-groups', 0], 'type', 'relay'))
    act(() => result.current.doUndo())
    expect(result.current.text).toContain('type: fallback')
  })

  // Ниже — операции, объявленные в интерфейсе задачи, но не покрытые её
  // основным набором: без них проброс мог бы разойтись с `entities/mihomo`
  // молча, а потребитель (формы инспектора) появится только в следующих задачах.

  it('originOf пропускает наружу все четыре происхождения: own, merged, alias, absent', () => {
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
    const { result } = draft(text)
    expect(result.current.originOf(['proxy-groups', 0], 'name')).toBe('own')
    expect(result.current.originOf(['proxy-groups', 0], 'type')).toBe('merged')
    expect(result.current.originOf(['proxy-groups', 0], 'remnawave.include-proxies')).toBe('alias')
    expect(result.current.originOf(['proxy-groups', 0], 'filter')).toBe('absent')
    // Правки по merged- и alias-путям отказывают — черновик остаётся нетронутым
    act(() => result.current.setField(['proxy-groups', 0], 'type', 'fallback'))
    act(() => result.current.setField(['proxy-groups', 0], 'remnawave.include-proxies', true))
    expect(result.current.text).toBe(text)
  })

  it('замена списка идёт через setListAt и не трогает соседние секции', () => {
    const { result } = draft()
    act(() => result.current.setListAt(['proxy-groups', 0], 'proxies', ['DIRECT', 'REJECT']))
    const md = parseMihomo(result.current.text)
    expect(md.doc.errors).toEqual([])
    expect(result.current.text).toContain('- REJECT')
    expect(result.current.text).toContain('  - MATCH,A')
  })

  it('замена строки правила переписывает только её', () => {
    const { result } = draft()
    act(() => result.current.replaceRule(0, 'DOMAIN-SUFFIX,b.com,A'))
    expect(result.current.text).toContain('DOMAIN-SUFFIX,b.com,A')
    expect(result.current.text).not.toContain('DOMAIN,a.com,A')
    expect(result.current.text).toContain('  - MATCH,A')
  })

  it('разрыв связи убирает участника и причины не оставляет', () => {
    const { result } = draft()
    act(() => result.current.disconnect('e:group:A->builtin:DIRECT'))
    expect(result.current.text).not.toContain('- DIRECT')
    expect(result.current.text).toContain('  - MATCH,A')
    expect(result.current.refusal).toBeNull()
  })

  it('отказ разрыва поднимает причину и документ не трогает', () => {
    // У правила цель обязательна — разрывать нечего; фикстура та же, что и у
    // успешного разрыва выше, так что различает ветви именно ребро, а не документ
    const { result } = draft()
    act(() => result.current.disconnect('e:rule:0->group:A'))
    // Причина называет настоящее основание: связь у правила можно только
    // сменить, а не убрать. Прежний `invalid-pair` объяснял отказ узлом
    // подстановки, которого в этом ребре нет.
    expect(result.current.refusal).toBe('rule-target-required')
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
    const { result } = draft(text)
    act(() => result.current.setSelectedNode('group:A'))
    act(() => result.current.removeSelected())
    expect(result.current.selectedNode).toBeNull()
    expect(result.current.text).not.toContain('name: A')
    expect(result.current.text).toContain('name: B')
    expect(parseMihomo(result.current.text).doc.errors).toEqual([])
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
    const { result } = draft()
    expect(result.current.trace).toBeUndefined()
    act(() => result.current.setTraceTarget(target('a.com')))
    // Ввод ещё не затих: дергать бэкенд и пересчитывать вердикты рано
    expect(result.current.trace).toBeUndefined()
    act(() => vi.advanceTimersByTime(600))
    expect(result.current.trace?.winner).toEqual({ ruleIndex: 0, target: 'A' })
  })

  it('другая цель даёт другого победителя, а не тот же самый', () => {
    const { result } = draft()
    act(() => result.current.setTraceTarget(target('b.com')))
    act(() => vi.advanceTimersByTime(600))
    // DOMAIN,a.com не подходит — ловит MATCH вторым правилом
    expect(result.current.trace?.winner).toEqual({ ruleIndex: 1, target: 'A' })
  })

  it('снятая цель убирает разбор сразу, без ожидания паузы', () => {
    const { result } = draft()
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
    const { result } = draft(GEO_DOC)
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
    const { result } = draft()
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
    const { result } = draft(SET_DOC('RULE-SET,net,A', 'MATCH,A'))
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

  it('набор из файла клиента останавливает проход и называет причину без сети', async () => {
    const { result } = draft(SET_DOC('RULE-SET,net,A', 'RULE-SET,local,A', 'MATCH,A'))
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.trace?.stopped?.index).toBe(1), { timeout: 3000 })
    expect(result.current.trace?.stopped?.reason).toMatch(/«local»/)
    expect(result.current.trace?.stopped?.reason).toMatch(/файл/)
  })

  it('набор незнакомого вида останавливает проход своей причиной, а не общей', async () => {
    const { result } = draft(SET_DOC('RULE-SET,net,A', 'RULE-SET,weird,A', 'MATCH,A'))
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.trace?.stopped?.index).toBe(1), { timeout: 3000 })
    expect(result.current.trace?.stopped?.reason).toMatch(/«weird»/)
    expect(result.current.trace?.stopped?.reason).toMatch(/незнаком/)
  })

  it('пока ответ едет, причина остановки — «ещё загружается», а не промах', async () => {
    // Ответ не приедет никогда: важна ровно та секунда, пока запрос в пути
    answer = new Promise<Response>(() => {})
    const { result } = draft(SET_DOC('RULE-SET,net,A', 'MATCH,A'))
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.trace?.stopped?.index).toBe(0), { timeout: 3000 })
    expect(result.current.trace?.stopped?.reason).toMatch(/загружа/)
  })

  it('приехавший ответ доводит проход до конца', async () => {
    const { result } = draft(SET_DOC('RULE-SET,net,A', 'MATCH,A'))
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.trace?.winner?.ruleIndex).toBe(1), { timeout: 3000 })
    expect(result.current.trace?.stopped).toBeUndefined()
  })

  it('без наборов в документе ручку не дёргают вовсе', async () => {
    const { result } = draft()
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.trace).toBeDefined(), { timeout: 3000 })
    expect(setBodies).toEqual([])
  })
})
