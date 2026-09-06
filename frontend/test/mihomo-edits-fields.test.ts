import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo/parse'
import {
  addGroup,
  applyEdits,
  moveMihomoRule,
  originAt,
  readFieldAt,
  removeFieldAt,
  removeGroup,
  replaceRuleText,
  setFieldAt,
  setListAt,
} from '../src/entities/mihomo/edits'
import { groupsOf } from '../src/entities/mihomo/groups'
import { rulesOf } from '../src/entities/mihomo/rules'
import { mihomoFixture } from './helpers'

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

describe('правки полей секций', () => {
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
    // Находка 8 (ревью раунд 1): отказ обязан быть ПОПОЛЕВЫМ, а не посекционным —
    // на том же документе собственное поле группы (не пришедшее через `<<`)
    // правится как обычно, слияние в этой же группе тому не помеха
    expect(setFieldAt(md, ['proxy-groups', 0], 'name', 'B')).not.toEqual([])
  })

  it('поле, дошедшее до отображения через *alias на промежуточном сегменте, правкой не трогается (находка 1)', () => {
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
    // Читатель продолжает видеть значение — форма должна показать его, просто без права записи
    expect(readFieldAt(md, ['proxy-groups', 0], 'remnawave.include-proxies')).toEqual({
      value: false,
      origin: 'alias',
    })
    // Отказ не должен быть посекционным: правка через тот же путь у группы B —
    // из ТОГО ЖЕ якоря, и тоже отказывает, а не «повезло» с индексом группы A
    expect(setFieldAt(md, ['proxy-groups', 1], 'remnawave.include-proxies', true)).toEqual([])
    // Парный успех на том же документе (находка 8): поле верхнего уровня группы,
    // не проходящее через алиас, правится как обычно
    expect(setFieldAt(md, ['proxy-groups', 0], 'type', 'url-test')).not.toEqual([])
    // И правда не задевает объявление якоря: применение отказной правки — no-op
    expect(applyEdits(text, setFieldAt(md, ['proxy-groups', 0], 'remnawave.include-proxies', true))).toBe(
      text,
    )
  })

  it('заводит группу в конец секции', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, addGroup(md, 'Новая'))
    const groups = groupsOf(parseMihomo(next))
    expect(groups.map((g) => g.name)).toEqual(['A', 'B', 'Новая'])
    expect(groups[2]!.type).toBe('select')
  })

  // Находка 4 (ревью раунд 1): три структурных варианта секции `proxy-groups`
  // одним блоком — успешный случай «секция пуста» служит парным успехом
  // (находка 8) для двух соседних отказов на близких вариантах того же ключа.
  describe('addGroup на разных формах секции', () => {
    it('заводит ПЕРВУЮ группу, когда секция пуста (`proxy-groups:` без элементов)', () => {
      const text = 'dns:\n  enable: true\nproxy-groups:\nrules:\n  - MATCH,DIRECT\n'
      const md = parseMihomo(text)
      const edits = addGroup(md, 'Первая')
      expect(edits).not.toEqual([])
      const next = applyEdits(text, edits)
      expect(parseMihomo(next).issues).toHaveLength(0)
      expect(groupsOf(parseMihomo(next)).map((g) => g.name)).toEqual(['Первая'])
    })

    it('отказывает на пустом flow-списке `proxy-groups: []`', () => {
      const md = parseMihomo('proxy-groups: []\n')
      expect(addGroup(md, 'Новая')).toEqual([])
    })

    it('отказывает, если ключа proxy-groups нет в документе вовсе', () => {
      const md = parseMihomo('dns:\n  enable: true\n')
      expect(addGroup(md, 'Новая')).toEqual([])
    })
  })

  it('удаляет группу целиком, не задев соседей', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, removeGroup(md, 0))
    expect(groupsOf(parseMihomo(next)).map((g) => g.name)).toEqual(['B'])
    expect(next).toContain('enhanced-mode: fake-ip')
  })

  it('удаляет группу, не задевая комментарий перед СЛЕДУЮЩЕЙ группой (находка 6)', () => {
    const text = [
      'proxy-groups:',
      '  - name: A',
      '    type: select',
      '  # про B',
      '  - name: B',
      '    type: url-test',
      '',
    ].join('\n')
    const md = parseMihomo(text)
    const next = applyEdits(text, removeGroup(md, 0))
    expect(groupsOf(parseMihomo(next)).map((g) => g.name)).toEqual(['B'])
    expect(next).toContain('# про B')
  })

  it('чтение поля видит и собственный ключ, и пришедший через слияние', () => {
    const md = parseMihomo(DOC)
    expect(readFieldAt(md, ['proxy-groups', 0], 'type')).toEqual({ value: 'select', origin: 'own' })
    expect(readFieldAt(md, ['proxy-groups', 0], 'remnawave.include-proxies').value).toBe(false)
    expect(readFieldAt(md, ['dns'], 'нет-такого').origin).toBe('absent')
  })

  it('замена списка сохраняет отступ и не трогает соседние ключи', () => {
    const text = [
      'proxy-groups:',
      '  - name: A',
      '    proxies:',
      '      - DIRECT',
      '    type: select',
      '',
    ].join('\n')
    const md = parseMihomo(text)
    const next = applyEdits(text, setListAt(md, ['proxy-groups', 0], 'proxies', ['REJECT', 'B']))
    expect(next).toContain('      - REJECT\n      - B\n')
    expect(next).toContain('    type: select')
  })

  it('setListAt отказывает, когда значение ключа — алиас на список (bundle.yaml, находка 2)', () => {
    // dns.default-nameserver в bundle.yaml задан `*dns_ru` — ключ «свой»
    // (origin === 'own'), но его значение не Seq и не «пусто»: ветка «пустого
    // списка» приняла бы диапазон алиаса за отсутствующий список и дописала бы
    // новый блок РЯДОМ с ним, оставив сам алиас на строке ключа — синтаксически
    // битый документ. Воспроизведено на боевой фикстуре, а не на синтетике.
    const text = mihomoFixture('bundle')
    const md = parseMihomo(text)
    expect(originAt(md, ['dns'], 'default-nameserver')).toBe('own')
    expect(setListAt(md, ['dns'], 'default-nameserver', ['1.1.1.1'])).toEqual([])
    // Парный успех на том же файле (находка 8): обычный блочный список той же
    // секции правится как обычно — отказ не посекционный, а поточечный
    const okEdits = setListAt(md, ['dns'], 'fake-ip-filter', ['+.example.com'])
    expect(okEdits).not.toEqual([])
    expect(parseMihomo(applyEdits(text, okEdits)).issues).toHaveLength(0)
  })

  it('замена строки правила проходит через сериализатор', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, replaceRuleText(md, 0, 'DOMAIN-KEYWORD,a.com,B'))
    expect(rulesOf(parseMihomo(next))[0]!.rule?.type).toBe('DOMAIN-KEYWORD')
    // Неразбираемый вход — отказ, а не запись мусора в документ
    expect(replaceRuleText(md, 0, 'СОВСЕМ-НЕ-ПРАВИЛО')).toEqual([])
  })

  it('переставляет правило, сохраняя его текст', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, moveMihomoRule(md, 0, 1))
    expect(rulesOf(parseMihomo(next)).map((r) => r.raw)).toEqual(['MATCH,B', 'DOMAIN,a.com,A'])
  })

  it('переставляет правило вместе с его хвостовым комментарием (находка 5)', () => {
    // Диапазон правила (rulesOf/rangeOf) заканчивается ДО хвостового комментария —
    // обмен одними этими диапазонами оставлял бы комментарий на своей строке,
    // то есть приклеивал бы его к правилу, которое туда переехало
    const text = ['rules:', '  - DOMAIN,a.com,A  # первый', '  - MATCH,B', ''].join('\n')
    const md = parseMihomo(text)
    const next = applyEdits(text, moveMihomoRule(md, 0, 1))
    expect(next.split('\n')).toEqual(['rules:', '  - MATCH,B', '  - DOMAIN,a.com,A  # первый', ''])
  })

  it('переставляет правило без завершающего \\n в файле, не склеивая строки (ревью раунд 2)', () => {
    // Раунд 1 сам внёс этот дефект: обмен «строка вместе со своим терминатором»
    // переносил `\n` вместе с содержимым, когда у последней строки файла его нет
    // вовсе, — два правила слипались в один скаляр, а `parseMihomo` результата
    // не подавал об этом никакого сигнала (документ оставался валидным YAML).
    // Проверка одной лишь строки текста не поймала бы слияние, если бы оно дало
    // похожий текст, — поэтому здесь ещё и `rulesOf` результата.
    const text = 'rules:\n  - DOMAIN,a.com,A\n  - MATCH,B'
    const md = parseMihomo(text)
    const next = applyEdits(text, moveMihomoRule(md, 0, 1))
    expect(next).toBe('rules:\n  - MATCH,B\n  - DOMAIN,a.com,A')
    const parsed = parseMihomo(next)
    expect(parsed.issues).toHaveLength(0)
    const rules = rulesOf(parsed)
    expect(rules).toHaveLength(2)
    expect(rules.map((r) => r.raw)).toEqual(['MATCH,B', 'DOMAIN,a.com,A'])
  })

  it('без завершающего \\n и с хвостовым комментарием у последнего правила — находки 5 и раунда 2 пересекаются здесь', () => {
    const text = 'rules:\n  - DOMAIN,a.com,A\n  - MATCH,B  # последний'
    const md = parseMihomo(text)
    const next = applyEdits(text, moveMihomoRule(md, 0, 1))
    expect(next).toBe('rules:\n  - MATCH,B  # последний\n  - DOMAIN,a.com,A')
    const parsed = parseMihomo(next)
    expect(parsed.issues).toHaveLength(0)
    const rules = rulesOf(parsed)
    expect(rules).toHaveLength(2)
    expect(rules.map((r) => r.raw)).toEqual(['MATCH,B', 'DOMAIN,a.com,A'])
  })

  it('перестановка за границы списка ничего не меняет', () => {
    const md = parseMihomo(DOC)
    expect(moveMihomoRule(md, 0, -1)).toEqual([])
    expect(moveMihomoRule(md, 1, 1)).toEqual([])
  })

  it('на эталонных шаблонах правка поля меняет ровно диапазон старого значения на новое', () => {
    // Находка 7 (ревью раунд 1): исходные два утверждения истинны для ЛЮБОГО
    // `from`/`to` при ровно одной правке (так устроен `applyEdits`) — они не
    // ловят заведомо неверный диапазон. Добавлены две проверки, которые ловят:
    // срез старого текста по диапазону правки обязан быть именно старым
    // значением `type`, а разобранный результат обязан нести именно новое
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
