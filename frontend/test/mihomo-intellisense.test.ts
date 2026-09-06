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
  it('внутри элемента proxy-groups — секция группы', () => {
    const { text, pos } = at('proxy-groups:\n  - name: A\n    ‸\n')
    const ctx = contextAt(text, pos)
    expect(ctx?.section).toBe('proxy-group')
    expect(ctx?.mode).toBe('key')
    expect(ctx?.existingKeys).toContain('name')
  })

  it('внутри dns — секция dns', () => {
    const { text, pos } = at('dns:\n  enable: true\n  ‸\n')
    expect(contextAt(text, pos)?.section).toBe('dns')
  })

  it('после двоеточия — режим значения с именем ключа', () => {
    const { text, pos } = at('proxy-groups:\n  - name: A\n    type: ‸\n')
    const ctx = contextAt(text, pos)
    expect(ctx?.mode).toBe('value')
    expect(ctx?.key).toBe('type')
  })

  it('пробел внутри значения значением его быть не отменяет', () => {
    const written = ctx('dns:\n  nameserver: 1.1.1.1 8.8‸\n')
    expect(written?.mode).toBe('value')
    expect(written?.key).toBe('nameserver')
    expect(ctx('proxy-groups:\n  - name: A\n    filter: (US|HK) ‸\n')?.mode).toBe('value')
  })
})

// containerOf — приватная середина contextAt, и проверяется через его `parts`:
// отдельный экспорт потребовал бы синтетического пути и колонки, а значение
// имеет ровно то, во что они складываются на настоящем тексте
describe('отображение, которому принадлежит курсор', () => {
  function parts(src: string) {
    return ctx(src)?.parts
  }

  it('отступ пустой строки внутри элемента списка — сам элемент', () => {
    expect(parts('proxy-groups:\n  - name: A\n    ‸\n')).toEqual(['proxy-groups', 0])
  })

  it('отступ внутри вложенной секции — сама секция', () => {
    expect(parts('proxy-groups:\n  - name: A\n    remnawave:\n      ‸\n')).toEqual([
      'proxy-groups',
      0,
      'remnawave',
    ])
  })

  it('нулевая колонка — корень документа, а не секция выше', () => {
    expect(parts('dns:\n  enable: true\n‸\n')).toEqual([])
  })

  it('после «type: » без значения — отображение группы, а не сама пара', () => {
    expect(parts('proxy-groups:\n  - name: A\n    type: ‸\n')).toEqual(['proxy-groups', 0])
  })

  it('хозяин строки с дефисом — список, а не элемент', () => {
    // ключей у нового элемента ещё нет, и путь ведёт к списку: чей это будет
    // элемент по счёту, до написания неизвестно
    const next = ctx('proxy-groups:\n  - name: A\n  - ‸\n')
    expect(next?.parts).toEqual(['proxy-groups'])
    expect(next?.existingKeys).toEqual([])
  })

  it('пустой документ — корень', () => {
    expect(parts('‸')).toEqual([])
  })
})

// Правило одно: подсказка выдаётся ТОЛЬКО в отображении, которому словарь знает
// секцию. Не опознали место — молчим; откат к корню выдал бы описание чужого
// ключа (у `port` внутри записи `proxies` это был бы «порт HTTP-входа»)
describe('места, где словарь молчит', () => {
  // Один документ на положительный и отрицательный случай: курсор ставится то в
  // запись сервера, то в группу, то в dns — меняется место, а не фикстура
  const doc = (where: 'server' | 'group' | 'dns'): string =>
    [
      'proxies:',
      '  - name: сервер',
      '    port: 443',
      ...(where === 'server' ? ['    ‸'] : []),
      'proxy-groups:',
      '  - name: A',
      ...(where === 'group' ? ['    ‸'] : []),
      'dns:',
      '  nameserver:',
      '    - 1.1.1.1',
      ...(where === 'dns' ? ['  ‸'] : []),
      '',
    ].join('\n')

  it('внутри записи proxies подсказок нет, а внутри группы того же документа есть', () => {
    expect(ctx(doc('server'))).toBeNull()
    expect(labels(doc('server'))).toEqual([])
    expect(ctx(doc('group'))?.section).toBe('proxy-group')
    expect(labels(doc('group'))).toContain('type')
  })

  it('в секции dns того же документа подсказки есть', () => {
    expect(ctx(doc('dns'))?.section).toBe('dns')
    expect(labels(doc('dns'))).toContain('enhanced-mode')
  })

  it('новый элемент proxies не описан, новый элемент proxy-groups описан', () => {
    expect(ctx('proxies:\n  - ‸\n')).toBeNull()
    expect(labels('proxies:\n  - ‸\n')).toEqual([])
    expect(ctx('proxy-groups:\n  - ‸\n')?.section).toBe('proxy-group')
    expect(labels('proxy-groups:\n  - ‸\n')).toContain('name')
  })

  it('элемент rules — скаляр, подсказывать там нечего', () => {
    expect(ctx('rules:\n  - ‸\n')).toBeNull()
    expect(ctx('rules:\n  - MATCH,DIRECT\n  - ‸\n')).toBeNull()
  })

  it('элемент списка серверов DNS — тоже', () => {
    expect(ctx('dns:\n  enable: true\n  nameserver:\n    - ‸\n')).toBeNull()
    // а сама секция dns на том же документе описана
    expect(ctx('dns:\n  enable: true\n  nameserver:\n    - 1.1.1.1\n  ‸\n')?.section).toBe('dns')
  })

  it('произвольное отображение без секции (якоря шаблона) молчит', () => {
    expect(ctx('x-anchors:\n  common: &common\n    type: http\n    ‸\n')).toBeNull()
  })

  it('провайдеры описаны по имени записи, но не на уровне самой карты', () => {
    expect(ctx('proxy-providers:\n  наш:\n    type: http\n    ‸\n')?.section).toBe('proxy-provider')
    expect(ctx('rule-providers:\n  наш:\n    type: http\n    ‸\n')?.section).toBe('rule-provider')
    expect(ctx('proxy-providers:\n  ‸\n')).toBeNull()
  })

  it('вложенные отображения словаря описаны, чужие — нет', () => {
    expect(ctx('proxy-groups:\n  - name: A\n    remnawave:\n      ‸\n')?.section).toBe('proxy-group')
    expect(ctx('proxy-groups:\n  - name: A\n    своё:\n      ‸\n')).toBeNull()
  })

  it('внутри комментария подсказок нет', () => {
    expect(ctx('proxies:\n  # LEAVE THIS LINE‸\n')).toBeNull()
    expect(ctx('# proxies: LEAVE‸')).toBeNull()
    expect(ctx('dns:\n  enable: true  # включено‸\n')).toBeNull()
    // решётка внутри значения комментария не начинает — там подсказки работают
    expect(ctx('dns:\n  nameserver: https://x/dns-query#VPN‸\n')?.mode).toBe('value')
  })
})

// Второй распространённый стиль: дефисы списка стоят в колонке КЛЮЧА, а не с
// отступом. Все фикстуры репозитория написаны с отступом 2, поэтому весь этот
// стиль был слеп для суиты — отсюда отдельный блок
describe('списки с нулевым отступом', () => {
  const GROUPS = 'proxy-groups:\n- name: A\n  type: select\n'

  it('ключ внутри элемента описан секцией группы', () => {
    expect(ctx(`${GROUPS}  ‸\n`)?.section).toBe('proxy-group')
    expect(labels(`${GROUPS}  ‸\n`)).toContain('filter')
  })

  it('новый элемент получает ключи группы', () => {
    const next = ctx(`${GROUPS}- ‸\n`)
    expect(next?.section).toBe('proxy-group')
    expect(next?.parts).toEqual(['proxy-groups'])
    expect(next?.existingKeys).toEqual([])
    expect(labels(`${GROUPS}- ‸\n`)).toContain('name')
  })

  it('значение ключа элемента подсказывается из словаря', () => {
    expect(labels('proxy-groups:\n- name: A\n  type: ‸\n')).toEqual(
      expect.arrayContaining(['select', 'url-test']),
    )
  })

  it('дефис без пробела — тоже начало элемента', () => {
    expect(labels(`${GROUPS}-‸\n`)).toContain('name')
    expect(labels('proxy-groups:\n  -‸\n')).toContain('name')
  })

  it('proxies и rules в том же стиле по-прежнему молчат', () => {
    expect(ctx('proxies:\n- name: сервер\n  port: 443\n  ‸\n')).toBeNull()
    expect(ctx('proxies:\n- name: сервер\n- ‸\n')).toBeNull()
    expect(ctx('rules:\n- MATCH,DIRECT\n- ‸\n')).toBeNull()
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

  it('значения из словаря во flow-список не предлагаются', () => {
    // ключ у strategy enum'ный, и без проверки его варианты сыпались бы прямо
    // в скобки — туда, где ядро ждёт скаляр
    expect(labels('proxy-groups:\n  - name: A\n    strategy: [‸]\n')).toEqual([])
    expect(labels('proxy-groups:\n  - name: A\n    strategy: ‸\n')).toContain('round-robin')
  })

  it('за закрытой скобкой подсказки снова работают', () => {
    expect(ctx('proxies: [DIRECT]\n‸\n')?.section).toBe('root')
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
    // внутренний список — имена целей, словарь их не описывает
    expect(ctx(`${NESTED}      - ‸\n`)).toBeNull()
    // внешний — список групп
    expect(ctx(`${NESTED}  - ‸\n`)?.section).toBe('proxy-group')
    // ключевая строка внутри элемента — тоже группа
    expect(ctx(`${NESTED}    ‸\n`)?.section).toBe('proxy-group')
  })

  it('дефис, не попавший в колонку ни одного списка, молчит', () => {
    // отбит глубже, чем список групп: чей это элемент — неизвестно, и ключи
    // группы тут были бы догадкой
    expect(ctx('proxy-groups:\n  - name: A\n      - ‸\n')).toBeNull()
  })

  it('соседняя ветвь с дефисами в той же колонке не подменяет секцию', () => {
    // дефисы rules и proxy-groups стоят в одной колонке 2, но лежат в разных
    // ветвях: путь курсора отбирает свою
    expect(ctx('rules:\n  - MATCH,A\n  - ‸\nproxy-groups:\n  - name: A\n')).toBeNull()
  })
})

describe('подсказки Mihomo', () => {
  it('ключи группы предлагаются и не повторяют уже введённые', () => {
    const got = labels('proxy-groups:\n  - name: A\n    type: select\n    ‸\n')
    expect(got).toEqual(expect.arrayContaining(['filter', 'interval', 'use']))
    expect(got).not.toContain('name')
    expect(got).not.toContain('type')
  })

  it('значения типа группы предлагаются из словаря', () => {
    expect(labels('proxy-groups:\n  - name: A\n    type: ‸\n')).toEqual(
      expect.arrayContaining(['select', 'url-test', 'fallback', 'load-balance', 'relay']),
    )
  })

  it('ключи dns не смешиваются с ключами группы', () => {
    const got = labels('dns:\n  enable: true\n  ‸\n')
    expect(got).toEqual(expect.arrayContaining(['enhanced-mode', 'nameserver']))
    expect(got).not.toContain('filter')
  })

  it('в корне предлагаются секции верхнего уровня', () => {
    expect(labels('‸\n')).toEqual(expect.arrayContaining(['mode', 'log-level', 'dns', 'tun']))
  })

  it('имена секций словаря ключами корня не притворяются', () => {
    // dns/tun/sniffer/profile в корне лежат под своими именами, а root и
    // proxy-group — только имена секций: таких ключей в Mihomo нет
    const got = labels('‸\n')
    for (const name of ['root', 'proxy-group', 'proxy-provider', 'rule-provider']) {
      expect(got).not.toContain(name)
    }
  })

  it('в корне предлагаются и ключи-контейнеры', () => {
    expect(labels('‸\n')).toEqual(
      expect.arrayContaining(['proxies', 'proxy-groups', 'rules', 'rule-providers']),
    )
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

  it('подсказка несёт описание из словаря', () => {
    const option = (complete('dns:\n  ‸\n')?.options ?? []).find((o) => o.label === 'enhanced-mode')
    expect(String(option?.info ?? '')).toMatch(/fake-ip|redir-host|режим/i)
  })
})
