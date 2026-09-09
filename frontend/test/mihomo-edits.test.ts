import { describe, expect, it } from 'vitest'
import { applyEdits, originAt, removeFieldAt, setFieldAt } from '../src/entities/mihomo/edits'
import { groupsOf } from '../src/entities/mihomo/groups'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { valueAt } from '../src/shared/schema'
import { mihomoFixture } from './helpers'

// Переименование группы (renameGroup), правила-сплайсы (setRuleTarget/
// removeRule/addRule/moveMihomoRule/replaceRuleText) и списки-сплайсы
// (setListAt/addGroup/removeGroup) удалены задачей 17: писатель
// (`entities/mihomo/write.ts`) заводит ключи и правит списки/правила моделью
// `Document` (задача 10), а переименование с переносом ссылок теперь у
// `entities/mihomo/refs.ts` (`renameAt`, покрыт `mihomo-refs.test.ts`).
// Оставшиеся здесь тесты — про сплайс-примитивы, которые писатель зовёт для
// ОДНОГО собственного однострочного скаляра (режим сплайса), и про механику
// `applyEdits` саму по себе.

describe('наложение правок', () => {
  it('накладывает несколько правок, не съезжая по смещениям', () => {
    expect(applyEdits('abcdef', [{ from: 0, to: 1, insert: 'X' }, { from: 4, to: 6, insert: 'YZ' }]))
      .toBe('Xbcd' + 'YZ')
  })

  it('пересекающиеся правки — исключение, а не тихая порча', () => {
    expect(() => applyEdits('abcdef', [{ from: 0, to: 3, insert: 'X' }, { from: 2, to: 4, insert: 'Y' }]))
      .toThrow(/пересек/i)
  })
})

describe('решение В и I1: детерминизм и конфликт правок', () => {
  it('порядок совпадающих по началу правок не влияет на результат (I1)', () => {
    const text = 'abcdefgh'
    const zeroWidth = { from: 5, to: 5, insert: 'Z' }
    const wider = { from: 5, to: 8, insert: 'XXX' }
    expect(applyEdits(text, [zeroWidth, wider])).toBe(applyEdits(text, [wider, zeroWidth]))
  })

  it('две вставки нулевой длины в одну точку — исключение (решение В)', () => {
    expect(() => applyEdits('abcdef', [{ from: 2, to: 2, insert: 'X' }, { from: 2, to: 2, insert: 'Y' }]))
      .toThrow(/пересек/i)
    // и в обратном порядке — тоже, а не «как повезёт»
    expect(() => applyEdits('abcdef', [{ from: 2, to: 2, insert: 'Y' }, { from: 2, to: 2, insert: 'X' }]))
      .toThrow(/пересек/i)
  })

  it('правка задом наперёд — исключение', () => {
    expect(() => applyEdits('abcdef', [{ from: 3, to: 1, insert: 'x' }])).toThrow()
  })

  it('правка за границами текста — исключение', () => {
    expect(() => applyEdits('abcdef', [{ from: 0, to: 100, insert: 'x' }])).toThrow()
    expect(() => applyEdits('abcdef', [{ from: -1, to: 2, insert: 'x' }])).toThrow()
  })
})

const DOC = [
  'dns:',
  '  enable: true',
  '  enhanced-mode: fake-ip',
  'proxy-groups:',
  '  - name: A',
  '    type: select',
  '    remnawave:',
  '      include-proxies: false',
  '  - name: B',
  '    type: url-test',
  'rules:',
  '  - DOMAIN,a.com,A',
  '  - MATCH,B',
  '',
].join('\n')

describe('правки полей секций (setFieldAt/removeFieldAt: только собственный существующий ключ)', () => {
  it('меняет скаляр секции верхнего уровня', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, setFieldAt(md, ['dns'], 'enhanced-mode', 'redir-host'))
    expect(next).toContain('enhanced-mode: redir-host')
    expect(next).toContain('enable: true')
  })

  it('меняет вложенный ключ через точку', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, setFieldAt(md, ['proxy-groups', 0], 'remnawave.include-proxies', true))
    expect(next).toContain('include-proxies: true')
  })

  it('отказывает, когда промежуточной секции нет: структуру не выдумываем', () => {
    const md = parseMihomo(DOC)
    expect(setFieldAt(md, ['proxy-groups', 1], 'remnawave.include-proxies', true)).toEqual([])
  })

  it('снимает поле вместе со строкой', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, removeFieldAt(md, ['proxy-groups', 1], 'type'))
    expect(next).not.toContain('url-test')
    expect(next).toContain('- name: B')
  })

  // Находка задачи 17 (мутационная приёмка): раньше отсутствующий ключ третьей
  // веткой вставлялся сплайсом после последней скалярной пары отображения —
  // теперь эта ветка удалена, недостающий ключ заводит режим модели писателя
  // (`entities/mihomo/write.ts`), а `setFieldAt` на отсутствующем ключе ОБЯЗАН
  // отказать, а не рискованно вставить строку.
  it('отказывает на отсутствующем ключе: вставку делает только режим модели писателя', () => {
    const text = 'proxy-groups:\n  - name: a\n    type: select\n'
    const md = parseMihomo(text)
    expect(setFieldAt(md, ['proxy-groups', 0], 'hidden', true)).toEqual([])
  })

  it('значение из якоря правкой не трогается', () => {
    const text = [
      'x-anchors:',
      '  base: &base',
      '    type: select',
      'proxy-groups:',
      '  - name: A',
      '    <<: *base',
      '',
    ].join('\n')
    const md = parseMihomo(text)
    expect(originAt(md, ['proxy-groups', 0], 'type')).toBe('merged')
    expect(setFieldAt(md, ['proxy-groups', 0], 'type', 'fallback')).toEqual([])
    // Отказ обязан быть ПОПОЛЕВЫМ, а не посекционным — на том же документе
    // собственное поле группы (не пришедшее через `<<`) правится как обычно
    expect(setFieldAt(md, ['proxy-groups', 0], 'name', 'B')).not.toEqual([])
  })

  it('поле, дошедшее до отображения через *alias на промежуточном сегменте, правкой не трогается', () => {
    // `remnawave: *rw` — это не `<<`-слияние: сам ключ `remnawave` присутствует и
    // «свой», но отображение, в которое он указывает, — общее объявление якоря,
    // используемое ОБЕИМИ группами. Правка внутри него задела бы обе.
    const text = [
      'x-anchors:',
      '  rw: &rw',
      '    include-proxies: false',
      'proxy-groups:',
      '  - name: A',
      '    type: select',
      '    remnawave: *rw',
      '  - name: B',
      '    type: select',
      '    remnawave: *rw',
      '',
    ].join('\n')
    const md = parseMihomo(text)
    expect(originAt(md, ['proxy-groups', 0], 'remnawave.include-proxies')).toBe('alias')
    expect(setFieldAt(md, ['proxy-groups', 0], 'remnawave.include-proxies', true)).toEqual([])
    expect(removeFieldAt(md, ['proxy-groups', 0], 'remnawave.include-proxies')).toEqual([])
    // Читатель продолжает видеть значение — форма должна показать его, просто
    // без права записи (читает `md.json`, снимок с развёрнутыми ссылками, а
    // не отдельный обход — см. parse.ts)
    expect(valueAt(md.json, ['proxy-groups', 0, 'remnawave', 'include-proxies'])).toBe(false)
    // Отказ не должен быть посекционным: правка через тот же путь у группы B —
    // из ТОГО ЖЕ якоря, и тоже отказывает, а не «повезло» с индексом группы A
    expect(setFieldAt(md, ['proxy-groups', 1], 'remnawave.include-proxies', true)).toEqual([])
    // Парный успех на том же документе: поле верхнего уровня группы, не
    // проходящее через алиас, правится как обычно
    expect(setFieldAt(md, ['proxy-groups', 0], 'type', 'url-test')).not.toEqual([])
    // И правда не задевает объявление якоря: применение отказной правки — no-op
    expect(applyEdits(text, setFieldAt(md, ['proxy-groups', 0], 'remnawave.include-proxies', true))).toBe(
      text,
    )
  })

  // Ключ свой, но его ЗНАЧЕНИЕ — ссылка. Диапазон значения здесь — токен `*n`,
  // и замена по нему стирает саму ссылку, подменяя её литералом: авторское
  // объявление якоря молча теряет потребителя. Читать при этом можно и нужно.
  it('скаляр через ссылку на якорь не пишется, но читается', () => {
    const text = [
      'x-anchors:', '  n: &n 300', 'proxy-groups:', '  - name: A', '    type: select', '    interval: *n', '',
    ].join('\n')
    const md = parseMihomo(text)
    expect(originAt(md, ['proxy-groups', 0], 'interval')).toBe('alias')
    expect(valueAt(md.json, ['proxy-groups', 0, 'interval'])).toBe(300)
    expect(setFieldAt(md, ['proxy-groups', 0], 'interval', 999)).toEqual([])
    // Соседний СОБСТВЕННЫЙ ключ той же секции по-прежнему пишется: отказ поточечный
    expect(setFieldAt(md, ['proxy-groups', 0], 'type', 'url-test')).not.toEqual([])
  })

  it('«type:» без значения получает пробел, а не склеивается', () => {
    const text = 'proxy-groups:\n  - name: a\n    type:\n'
    const md = parseMihomo(text)
    const out = applyEdits(text, setFieldAt(md, ['proxy-groups', 0], 'type', 'url-test'))
    expect(out).toBe('proxy-groups:\n  - name: a\n    type: url-test\n')
  })

  it('значение содержит перевод строки — отказ, а не порча', () => {
    const text = 'proxy-groups:\n  - name: a\n    type: select\n'
    const md = parseMihomo(text)
    expect(setFieldAt(md, ['proxy-groups', 0], 'type', 'a\nb')).toEqual([])
  })

  it('замена СОБСТВЕННОГО поля flow-группы (замена скаляра безопасна вне зависимости от flow)', () => {
    const text = 'proxy-groups: [{name: a, type: select}]\n'
    const md = parseMihomo(text)
    const out = applyEdits(text, setFieldAt(md, ['proxy-groups', 0], 'type', 'url-test'))
    expect(out).toBe('proxy-groups: [{name: a, type: url-test}]\n')
  })

  it('на эталонных шаблонах правка поля меняет ровно диапазон старого значения на новое', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const text = mihomoFixture(name)
      const md = parseMihomo(text)
      const group = groupsOf(md)[0]
      if (group === undefined || group.type === undefined) continue
      const edits = setFieldAt(md, ['proxy-groups', group.index], 'type', 'fallback')
      if (edits.length === 0) continue
      const edit = edits[0]!
      // Значение в исходнике могло быть в кавычках («type: "select"») — YAML их
      // уже снял в `group.type`, снимаем и здесь тем же простым правилом
      const raw = text.slice(edit.from, edit.to)
      const unquoted =
        (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
          ? raw.slice(1, -1)
          : raw
      expect(unquoted, name).toBe(group.type)
      const next = applyEdits(text, edits)
      expect(next.slice(0, edit.from), name).toBe(text.slice(0, edit.from))
      expect(next.slice(next.length - (text.length - edit.to)), name).toBe(text.slice(edit.to))
      expect(groupsOf(parseMihomo(next))[group.index]!.type, name).toBe('fallback')
    }
  })
})

// Находки финального ревью плана 1, общий корень: замена/удаление по
// `[range.from, range.to)` верны ТОЛЬКО для однострочного скаляра. У
// свёрнутого (`>-`), литерального (`|`) и у блочного списка `range.to` уже
// указывает на начало СЛЕДУЮЩЕЙ физической строки. Порча при этом молчаливая:
// у блочного списка `parseMihomo` результата не даёт ни одной ошибки разбора —
// поэтому каждая проверка ниже требует не только текста, но и чистого разбора.
const BLOCK = [
  'proxy-groups:',
  '  - name: g',
  '    filter: >-',
  '      aaa',
  '      bbb',
  '    type: select',
  '    proxies:',
  '      - DIRECT',
  '      - REJECT',
  '    icon: end.png',
  '',
].join('\n')

const LITERAL = [
  'proxy-groups:',
  '  - name: g',
  '    filter: |',
  '      aaa',
  '    type: select',
  '',
].join('\n')

describe('финальное ревью: блочное значение поля не задевает соседей', () => {
  it('снятие свёрнутого скаляра забирает только его строки', () => {
    const md = parseMihomo(BLOCK)
    const next = applyEdits(BLOCK, removeFieldAt(md, ['proxy-groups', 0], 'filter'))
    expect(next).not.toContain('aaa')
    expect(parseMihomo(next).issues).toEqual([])
    const group = groupsOf(parseMihomo(next))[0]!
    expect(group.filter).toBeUndefined()
    // Соседнее поле — то самое, которое прежняя арифметика съедала вместе с блоком
    expect(group.type).toBe('select')
    expect(group.proxies).toEqual(['DIRECT', 'REJECT'])
  })

  it('снятие литерального скаляра забирает только его строки', () => {
    const md = parseMihomo(LITERAL)
    const next = applyEdits(LITERAL, removeFieldAt(md, ['proxy-groups', 0], 'filter'))
    expect(parseMihomo(next).issues).toEqual([])
    expect(groupsOf(parseMihomo(next))[0]!.type).toBe('select')
  })

  it('снятие блочного списка забирает только его строки', () => {
    const md = parseMihomo(BLOCK)
    const next = applyEdits(BLOCK, removeFieldAt(md, ['proxy-groups', 0], 'proxies'))
    expect(parseMihomo(next).issues).toEqual([])
    const group = groupsOf(parseMihomo(next))[0]!
    expect(group.proxies).toEqual([])
    expect(valueAt(parseMihomo(next).json, ['proxy-groups', 0, 'icon'])).toBe('end.png')
  })

  it('снятие однострочного поля на той же фикстуре работает как раньше', () => {
    const md = parseMihomo(BLOCK)
    const next = applyEdits(BLOCK, removeFieldAt(md, ['proxy-groups', 0], 'type'))
    expect(parseMihomo(next).issues).toEqual([])
    const group = groupsOf(parseMihomo(next))[0]!
    expect(group.type).toBeUndefined()
    expect(group.filter).toBe('aaa bbb')
    expect(group.proxies).toEqual(['DIRECT', 'REJECT'])
  })

  it('замена блочного значения — отказ, а не склейка строк', () => {
    const md = parseMihomo(BLOCK)
    // Схема объявляет `filter` строкой, документ держит свёрнутый скаляр —
    // штатное расхождение схемы с чужим файлом, ради которого модуль и написан
    expect(setFieldAt(md, ['proxy-groups', 0], 'filter', 'zzz')).toEqual([])
    // У блочного СПИСКА порча была совсем молчаливой: разбор её не замечал
    expect(setFieldAt(md, ['proxy-groups', 0], 'proxies', 'zzz')).toEqual([])
    expect(setFieldAt(parseMihomo(LITERAL), ['proxy-groups', 0], 'filter', 'zzz')).toEqual([])
  })

  it('замена однострочного значения на той же фикстуре по-прежнему проходит', () => {
    const md = parseMihomo(BLOCK)
    const edits = setFieldAt(md, ['proxy-groups', 0], 'type', 'fallback')
    expect(edits).toHaveLength(1)
    const next = applyEdits(BLOCK, edits)
    expect(parseMihomo(next).issues).toEqual([])
    const group = groupsOf(parseMihomo(next))[0]!
    expect(group.type).toBe('fallback')
    expect(group.filter).toBe('aaa bbb')
  })
})
