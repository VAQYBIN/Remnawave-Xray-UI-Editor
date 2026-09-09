import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { yaml } from '@codemirror/lang-yaml'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { contextAt } from '../src/features/editor/mihomoIntellisense/context'
import { mihomoCompletionSource } from '../src/features/editor/mihomoIntellisense/complete'

// Позиция курсора помечается ‸ — символ, в YAML-содержимом не встречающийся
const CARET = '‸'

function at(src: string): { text: string; pos: number } {
  const pos = src.indexOf(CARET)
  if (pos < 0) throw new Error('нет маркера курсора ‸')
  return { text: src.slice(0, pos) + src.slice(pos + CARET.length), pos }
}

function complete(src: string): CompletionResult | null {
  const { text, pos } = at(src)
  const state = EditorState.create({ doc: text, extensions: [yaml()] })
  return mihomoCompletionSource(new CompletionContext(state, pos, true))
}

function ctx(src: string) {
  const { text, pos } = at(src)
  return contextAt(text, pos)
}

function labels(src: string): string[] {
  return (complete(src)?.options ?? []).map((o) => String(o.label))
}

describe('контекст курсора', () => {
  it('внутри элемента proxy-groups — поля группы', () => {
    const { text, pos } = at('proxy-groups:\n  - name: A\n    ‸\n')
    const cursor = contextAt(text, pos)
    expect(cursor?.path).toEqual(['proxy-groups', 0])
    expect(cursor?.mode).toBe('key')
    expect(cursor?.existingKeys).toContain('name')
    expect(cursor?.fields?.map((f) => f.key)).toContain('type')
  })

  it('внутри dns — поля секции dns', () => {
    const { text, pos } = at('dns:\n  enable: true\n  ‸\n')
    const cursor = contextAt(text, pos)
    expect(cursor?.path).toEqual(['dns'])
    expect(cursor?.fields?.map((f) => f.key)).toContain('nameserver')
  })

  it('после двоеточия — режим значения с именем ключа', () => {
    const { text, pos } = at('proxy-groups:\n  - name: A\n    type: ‸\n')
    const cursor = contextAt(text, pos)
    expect(cursor?.mode).toBe('value')
    expect(cursor?.key).toBe('type')
  })

  it('пробел внутри значения значением его быть не отменяет', () => {
    const written = ctx('dns:\n  nameserver: 1.1.1.1 8.8‸\n')
    expect(written?.mode).toBe('value')
    expect(written?.key).toBe('nameserver')
    expect(ctx('proxy-groups:\n  - name: A\n    filter: (US|HK) ‸\n')?.mode).toBe('value')
  })
})

// containerOf — приватная середина contextAt, и проверяется через его `path`:
// отдельный экспорт потребовал бы синтетического пути и колонки, а значение
// имеет ровно то, во что они складываются на настоящем тексте
describe('отображение, которому принадлежит курсор', () => {
  function path(src: string) {
    return ctx(src)?.path
  }

  it('отступ пустой строки внутри элемента списка — сам элемент', () => {
    expect(path('proxy-groups:\n  - name: A\n    ‸\n')).toEqual(['proxy-groups', 0])
  })

  it('отступ внутри вложенной секции — сама секция', () => {
    expect(path('proxy-groups:\n  - name: A\n    remnawave:\n      ‸\n')).toEqual([
      'proxy-groups',
      0,
      'remnawave',
    ])
  })

  it('нулевая колонка — корень документа, а не секция выше', () => {
    expect(path('dns:\n  enable: true\n‸\n')).toEqual([])
  })

  it('после «type: » без значения — отображение группы, а не сама пара', () => {
    expect(path('proxy-groups:\n  - name: A\n    type: ‸\n')).toEqual(['proxy-groups', 0])
  })

  it('хозяин строки с дефисом — список, а не элемент', () => {
    // ключей у нового элемента ещё нет, и путь ведёт к списку: чей это будет
    // элемент по счёту, до написания неизвестно
    const next = ctx('proxy-groups:\n  - name: A\n  - ‸\n')
    expect(next?.path).toEqual(['proxy-groups'])
    expect(next?.existingKeys).toEqual([])
    expect(next?.mode).toBe('key')
  })

  it('пустой документ — корень', () => {
    expect(path('‸')).toEqual([])
  })
})

// Раньше словарь был плоским, и «неописанное место» означало null курсора.
// Теперь дерево схемы описывает почти всё (в том числе записи `proxies`), а
// null остаётся только там, где позиция вообще не про документ (комментарий,
// flow-коллекция). Для настоящих «дырок» схемы (`x-anchors`, карта без
// записи, чужой ключ вложенного отображения) курсор возвращается, но
// `fields` — undefined: подсказывать всё равно нечего
describe('места, где схема не знает полей (курсор есть, fields — undefined)', () => {
  it('произвольное отображение без описания в схеме (якоря шаблона) молчит', () => {
    const cursor = ctx('x-anchors:\n  common: &common\n    type: http\n    ‸\n')
    expect(cursor).not.toBeNull()
    expect(cursor?.fields).toBeUndefined()
    expect(labels('x-anchors:\n  common: &common\n    type: http\n    ‸\n')).toEqual([])
  })

  it('уровень самой карты proxy-providers полей не имеет — они у записи по имени', () => {
    const cursor = ctx('proxy-providers:\n  ‸\n')
    expect(cursor).not.toBeNull()
    expect(cursor?.fields).toBeUndefined()
  })

  it('провайдеры описаны по имени записи', () => {
    const httpProvider = ctx('proxy-providers:\n  наш:\n    type: http\n    ‸\n')
    expect(httpProvider?.path).toEqual(['proxy-providers', 'наш'])
    expect(httpProvider?.fields?.map((f) => f.key)).toEqual(expect.arrayContaining(['url', 'interval', 'proxy']))

    const ruleProvider = ctx('rule-providers:\n  наш:\n    type: http\n    ‸\n')
    expect(ruleProvider?.fields?.map((f) => f.key)).toEqual(expect.arrayContaining(['behavior', 'url']))
  })

  it('вложенные отображения словаря описаны, чужие — нет', () => {
    const known = ctx('proxy-groups:\n  - name: A\n    remnawave:\n      ‸\n')
    expect(known?.fields?.map((f) => f.key)).toContain('include-proxies')

    const unknown = ctx('proxy-groups:\n  - name: A\n    своё:\n      ‸\n')
    expect(unknown?.fields).toBeUndefined()
  })

  it('внутри комментария подсказок нет', () => {
    expect(ctx('proxies:\n  # LEAVE THIS LINE‸\n')).toBeNull()
    expect(ctx('# proxies: LEAVE‸')).toBeNull()
    expect(ctx('dns:\n  enable: true  # включено‸\n')).toBeNull()
    // решётка внутри значения комментария не начинает — там подсказки работают
    expect(ctx('dns:\n  nameserver: https://x/dns-query#VPN‸\n')?.mode).toBe('value')
  })
})

// Списки СКАЛЯРОВ (rules, DNS nameserver, network у tunnels): дефис заводит
// не ключ отображения, а значение элемента, и подсказки те же, что у значения
// самого поля-списка (enum элемента, ссылка). Списки ОБЪЕКТОВ (proxies,
// proxy-groups, listeners…) теперь ВСЕ описаны схемой одинаково
describe('элементы списков', () => {
  it('элемент rules — скаляр без известных значений: курсор есть, подсказок нет', () => {
    const cursor = ctx('rules:\n  - ‸\n')
    expect(cursor).not.toBeNull()
    expect(cursor?.mode).toBe('value')
    expect(cursor?.key).toBe('rules')
    expect(labels('rules:\n  - ‸\n')).toEqual([])
    expect(labels('rules:\n  - MATCH,DIRECT\n  - ‸\n')).toEqual([])
  })

  it('элемент списка серверов DNS — тоже без подсказок, но курсор есть', () => {
    const cursor = ctx('dns:\n  enable: true\n  nameserver:\n    - ‸\n')
    expect(cursor?.mode).toBe('value')
    expect(cursor?.key).toBe('nameserver')
    expect(labels('dns:\n  enable: true\n  nameserver:\n    - ‸\n')).toEqual([])
    // а сама секция dns на том же документе описана как обычно
    expect(ctx('dns:\n  enable: true\n  nameserver:\n    - 1.1.1.1\n  ‸\n')?.path).toEqual(['dns'])
  })

  it('элемент списка network у tunnels — известные значения элемента (enum)', () => {
    const doc = 'tunnels:\n  - target: a:1\n    network:\n      - ‸\n'
    const cursor = ctx(doc)
    expect(cursor?.mode).toBe('value')
    expect(cursor?.key).toBe('network')
    expect(labels(doc)).toEqual(expect.arrayContaining(['tcp', 'udp']))
  })

  it('новый элемент proxies теперь описан наравне с proxy-groups', () => {
    expect(labels('proxies:\n  - ‸\n')).toEqual(expect.arrayContaining(['name', 'type']))
    expect(labels('proxy-groups:\n  - ‸\n')).toContain('name')
  })
})

// Второй распространённый стиль: дефисы списка стоят в колонке КЛЮЧА, а не с
// отступом. Все фикстуры репозитория написаны с отступом 2, поэтому весь этот
// стиль был слеп для суиты — отсюда отдельный блок
describe('списки с нулевым отступом', () => {
  const GROUPS = 'proxy-groups:\n- name: A\n  type: select\n'

  it('ключ внутри элемента описан полями группы', () => {
    expect(ctx(`${GROUPS}  ‸\n`)?.path).toEqual(['proxy-groups', 0])
    expect(labels(`${GROUPS}  ‸\n`)).toContain('filter')
  })

  it('новый элемент получает ключи группы', () => {
    const next = ctx(`${GROUPS}- ‸\n`)
    expect(next?.path).toEqual(['proxy-groups'])
    expect(next?.existingKeys).toEqual([])
    expect(labels(`${GROUPS}- ‸\n`)).toContain('name')
  })

  it('значение ключа элемента подсказывается из схемы', () => {
    expect(labels('proxy-groups:\n- name: A\n  type: ‸\n')).toEqual(
      expect.arrayContaining(['select', 'url-test']),
    )
  })

  it('дефис без пробела — тоже начало элемента', () => {
    expect(labels(`${GROUPS}-‸\n`)).toContain('name')
    expect(labels('proxy-groups:\n  -‸\n')).toContain('name')
  })
})

// Flow-стиль словарь не описывает: внутри квадратных скобок стоят имена
// серверов и групп, которых он не знает, а внутри фигурных подсказка вставила
// бы значение туда, где ядро ждёт список
describe('flow-коллекции молчат', () => {
  it('внутри flow-списка и flow-отображения контекста нет', () => {
    expect(ctx('proxies: [DIRECT‸]\n')).toBeNull()
    expect(ctx('proxies: [‸]\n')).toBeNull()
    expect(ctx('proxy-groups: [{name: A‸}]\n')).toBeNull()
    expect(ctx('proxy-groups: [{name: A, ‸}]\n')).toBeNull()
    expect(ctx('dns: {enhanced-mode: ‸}\n')).toBeNull()
  })

  it('значения из схемы во flow-список не предлагаются', () => {
    // ключ у strategy enum'ный, и без проверки его варианты сыпались бы прямо
    // в скобки — туда, где ядро ждёт скаляр
    expect(labels('proxy-groups:\n  - name: A\n    strategy: [‸]\n')).toEqual([])
    expect(labels('proxy-groups:\n  - name: A\n    strategy: ‸\n')).toContain('round-robin')
  })

  it('на ключе строки с flow-значением контекст остаётся', () => {
    // курсор ещё вне скобок: строка написана flow-стилем, но правится ключ
    expect(ctx('dns:\n  namese‸rver: [1.1.1.1]\n')?.path).toEqual(['dns'])
    expect(ctx('proxy-groups:\n  - name: A\n    proxi‸es: [DIRECT]\n')?.path).toEqual(['proxy-groups', 0])
  })

  it('за закрытой скобкой подсказки снова работают', () => {
    expect(ctx('proxies: [DIRECT]\n‸\n')?.path).toEqual([])
    expect(labels('proxies: [DIRECT]\n‸\n')).toContain('proxy-groups')
  })
})

// Инвариант seqAtColumn: вдоль одной цепочки префиксов колонки дефисов строго
// возрастают с глубиной, поэтому совпадение колонки даёт не более одного
// кандидата, а соседние ветви отсекает сам префикс пути
describe('вложенные списки', () => {
  const NESTED = [
    'rules:',
    '  - MATCH,A',
    'proxy-groups:',
    '  - name: A',
    '    proxies:',
    '      - DIRECT',
    '',
  ].join('\n')

  it('каждый уровень отвечает за себя', () => {
    // внутренний список — имена целей документа (ref, не enum): группа A и
    // встроенные цели, а не список ключей — элемент списка скаляров ключей не
    // заводит вовсе
    expect(labels(`${NESTED}      - ‸\n`)).toEqual(expect.arrayContaining(['A', 'DIRECT']))
    // внешний — список групп
    expect(ctx(`${NESTED}  - ‸\n`)?.path).toEqual(['proxy-groups'])
    // ключевая строка внутри элемента — тоже группа
    expect(ctx(`${NESTED}    ‸\n`)?.path).toEqual(['proxy-groups', 0])
  })

  it('дефис, не попавший в колонку ни одного списка, молчит', () => {
    // отбит глубже, чем список групп: чей это элемент — неизвестно, и ключи
    // группы тут были бы догадкой
    expect(ctx('proxy-groups:\n  - name: A\n      - ‸\n')).toBeNull()
  })

  it('соседняя ветвь с дефисами в той же колонке не подменяет секцию', () => {
    // дефисы rules и proxy-groups стоят в одной колонке 2, но лежат в разных
    // ветвях: путь курсора отбирает свою (rules, а не поля соседней группы)
    const cursor = ctx('rules:\n  - MATCH,A\n  - ‸\nproxy-groups:\n  - name: A\n')
    expect(cursor?.mode).toBe('value')
    expect(cursor?.key).toBe('rules')
    expect(cursor?.fields?.map((f) => f.key)).not.toContain('filter')
  })
})

describe('подсказки по дереву схемы', () => {
  it('ключи группы предлагаются и не повторяют уже введённые', () => {
    const got = labels('proxy-groups:\n  - name: A\n    type: select\n    ‸\n')
    expect(got).toEqual(expect.arrayContaining(['filter', 'interval', 'use']))
    expect(got).not.toContain('name')
    expect(got).not.toContain('type')
  })

  it('значения типа группы предлагаются из схемы', () => {
    expect(labels('proxy-groups:\n  - name: A\n    type: ‸\n')).toEqual(
      expect.arrayContaining(['select', 'url-test', 'fallback', 'load-balance', 'relay']),
    )
  })

  it('ключи dns не смешиваются с ключами группы', () => {
    const got = labels('dns:\n  enable: true\n  ‸\n')
    expect(got).toEqual(expect.arrayContaining(['enhanced-mode', 'nameserver']))
    expect(got).not.toContain('filter')
  })

  it('условие типа группы схема не ставит: tolerance и strategy предлагаются при любом типе', () => {
    const got = labels('proxy-groups:\n  - name: A\n    type: url-test\n    ‸\n')
    expect(got).toEqual(expect.arrayContaining(['tolerance', 'strategy']))
  })

  it('внутри proxies[0] при type: vless предлагают uuid и не предлагают cipher', () => {
    const got = labels('proxies:\n  - name: srv\n    type: vless\n    ‸\n')
    expect(got).toContain('uuid')
    expect(got).not.toContain('cipher')
  })

  it('внутри ws-opts (транспорт vless) предлагают path и headers', () => {
    const doc = 'proxies:\n  - name: srv\n    type: vless\n    network: ws\n    ws-opts:\n      ‸\n'
    const got = labels(doc)
    expect(got).toEqual(expect.arrayContaining(['path', 'headers']))
  })

  it('sniffer.sniff.HTTP предлагает ports и override-destination', () => {
    const doc = 'sniffer:\n  sniff:\n    HTTP:\n      ‸\n'
    expect(labels(doc)).toEqual(expect.arrayContaining(['ports', 'override-destination']))
  })

  it('в корне предлагаются все поля схемы, включая контейнеры', () => {
    expect(labels('‸\n')).toEqual(
      expect.arrayContaining(['mode', 'log-level', 'dns', 'tun', 'proxies', 'proxy-groups', 'rules', 'rule-providers']),
    )
  })

  it('синтетических имён секций среди ключей корня нет', () => {
    const got = labels('‸\n')
    for (const name of ['root', 'proxy-group', 'proxy-provider', 'rule-provider']) {
      expect(got).not.toContain(name)
    }
  })

  it('уже написанный ключ-контейнер второй раз не предлагается', () => {
    const got = labels('rules:\n  - MATCH,DIRECT\n‸\n')
    expect(got).toContain('proxy-groups')
    expect(got).not.toContain('rules')
  })

  it('битый YAML ниже курсора не мешает подсказкам выше', () => {
    const got = labels('proxy-groups:\n  - name: A\n    ‸\nrules:\n  - [\n')
    expect(got).toContain('type')
  })

  it('подсказка несёт описание из схемы', () => {
    const option = (complete('dns:\n  ‸\n')?.options ?? []).find((o) => o.label === 'enhanced-mode')
    expect(String(option?.info ?? '')).toMatch(/fake-ip|redir-host|режим/i)
  })

  it('устаревшее поле предлагается с пометкой замены', () => {
    const option = (complete('‸\n')?.options ?? []).find((o) => o.label === 'enable-process')
    expect(String(option?.info ?? '')).toMatch(/устарело/i)
    expect(String(option?.info ?? '')).toContain('find-process-mode')
  })

  /**
   * Ключ-контейнер корня — обычное поле корневой схемы, а не отдельная
   * запись словаря секций: описание при подсказке и при наведении
   * (`mihomo-hover.test.ts`) берётся из ОДНОГО и того же поля.
   */
  it('ключ-раздел в корне предлагается с описанием, а не с названием секции', () => {
    const options = complete('‸\n')?.options ?? []
    const info = (label: string) => String(options.find((o) => o.label === label)?.info ?? '')
    expect(info('dns')).toContain('резолвер')
    expect(info('rules')).toContain('первое совпавшее')
    expect(info('sub-rules')).toContain('SUB-RULE')
  })

  it('значения ref (proxy: у http-провайдера) — имена целей документа', () => {
    const doc = [
      'proxies:',
      '  - name: srv1',
      '    type: ss',
      'proxy-groups:',
      '  - name: g1',
      '    type: select',
      'proxy-providers:',
      '  наш:',
      '    type: http',
      '    proxy: ‸',
      '',
    ].join('\n')
    const got = labels(doc)
    expect(got).toEqual(expect.arrayContaining(['srv1', 'g1', 'DIRECT']))
  })

  it('ключи объекта/списка/карты вставляются с двоеточием, переводом строки и отступом', () => {
    const option = (complete('proxy-groups:\n  - name: A\n    ‸\n')?.options ?? []).find(
      (o) => o.label === 'remnawave',
    )
    expect(option?.apply).toBe('remnawave:\n      ')
  })
})
