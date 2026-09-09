import { describe, expect, it } from 'vitest'
import {
  conditionHolds,
  deprecatedAt,
  fieldAt,
  fieldsAt,
  unknownKeys,
  valueAt,
  visibleFields,
  walkSchema,
  type FieldSchema,
} from '../src/shared/schema'

const TLS: FieldSchema = {
  key: 'tls',
  doc: 'TLS',
  kind: 'object',
  fields: [
    { key: 'enabled', doc: 'Включён', kind: 'boolean' },
    { key: 'server_name', doc: 'Имя', kind: 'string' },
  ],
}

const OUTBOUND: FieldSchema[] = [
  {
    key: 'type',
    doc: 'Тип',
    kind: 'enum',
    enum: [
      { value: 'direct' },
      { value: 'vless' },
      { value: 'block', deprecated: { since: '1.13.0', replacement: 'действие правила reject' } },
    ],
  },
  { key: 'tag', doc: 'Тег', kind: 'string' },
  { key: 'uuid', doc: 'UUID', kind: 'string', when: { key: 'type', in: ['vless'] } },
  { key: 'detour', doc: 'Через выход', kind: 'string', ref: 'outbound', when: { key: 'type', notIn: ['selector'] } },
  { ...TLS, when: { key: 'type', in: ['vless'] } },
  {
    key: 'override_port',
    doc: 'Порт',
    kind: 'number',
    deprecated: { since: '1.11.0', replacement: 'route-options.override_port' },
  },
]

const ROOT: FieldSchema[] = [
  { key: 'log', doc: 'Журнал', kind: 'object', fields: [{ key: 'level', doc: 'Уровень', kind: 'string' }] },
  { key: 'outbounds', doc: 'Выходы', kind: 'list', item: { kind: 'object', fields: OUTBOUND } },
  { key: 'tags', doc: 'Теги', kind: 'list', item: { kind: 'string' } },
]

const DOC = {
  log: { level: 'warn' },
  outbounds: [
    { type: 'vless', tag: 'a', uuid: 'u', tls: { enabled: true } },
    { type: 'selector', tag: 'g' },
  ],
  tags: ['x'],
}

describe('условия видимости', () => {
  it('in и notIn сравнивают значение соседа как строку, отсутствие — пустая строка', () => {
    expect(conditionHolds({ key: 'type', in: ['vless'] }, { type: 'vless' })).toBe(true)
    expect(conditionHolds({ key: 'type', in: ['vless'] }, { type: 'direct' })).toBe(false)
    expect(conditionHolds({ key: 'type', in: [''] }, {})).toBe(true)
    expect(conditionHolds({ key: 'type', notIn: ['selector'] }, { type: 'selector' })).toBe(false)
    expect(conditionHolds({ key: 'type', notIn: ['selector'] }, {})).toBe(true)
    expect(conditionHolds(undefined, {})).toBe(true)
    // Число тоже сравнивается строкой: у DNS-правила ip_version — число
    expect(conditionHolds({ key: 'v', in: ['4'] }, { v: 4 })).toBe(true)
  })

  it('visibleFields скрывает поле, чьё условие не выполнено, и не трогает остальные', () => {
    expect(visibleFields(OUTBOUND, { type: 'direct' }).map((f) => f.key)).toEqual([
      'type', 'tag', 'detour', 'override_port',
    ])
    expect(visibleFields(OUTBOUND, { type: 'vless' }).map((f) => f.key)).toContain('uuid')
  })
})

describe('спуск по пути', () => {
  it('valueAt читает вложенное значение и отвечает undefined мимо документа', () => {
    expect(valueAt(DOC, ['outbounds', 0, 'tag'])).toBe('a')
    expect(valueAt(DOC, ['outbounds', 5, 'tag'])).toBeUndefined()
    expect(valueAt(DOC, [])).toBe(DOC)
  })

  it('fieldsAt отдаёт поля объекта по пути с учётом условий', () => {
    expect(fieldsAt(ROOT, [], DOC)).toBe(ROOT)
    expect(fieldsAt(ROOT, ['log'], DOC)?.map((f) => f.key)).toEqual(['level'])
    expect(fieldsAt(ROOT, ['outbounds', 0], DOC)?.map((f) => f.key)).toContain('uuid')
    expect(fieldsAt(ROOT, ['outbounds', 1], DOC)?.map((f) => f.key)).not.toContain('uuid')
    expect(fieldsAt(ROOT, ['outbounds', 0, 'tls'], DOC)?.map((f) => f.key)).toEqual(['enabled', 'server_name'])
  })

  it('fieldsAt молчит там, где схема ничего не описывает', () => {
    expect(fieldsAt(ROOT, ['nope'], DOC)).toBeUndefined()
    expect(fieldsAt(ROOT, ['tags', 0], DOC)).toBeUndefined()
    expect(fieldsAt(ROOT, ['outbounds'], DOC)).toBeUndefined()
    expect(fieldsAt(ROOT, ['log', 'level', 'x'], DOC)).toBeUndefined()
  })

  it('элемент списка без объекта в документе всё равно описан: путь, а не значение, решает', () => {
    // Новая запись ещё не вставлена, а подсказке уже нужны её поля
    expect(fieldsAt(ROOT, ['outbounds', 7], DOC)?.map((f) => f.key)).toContain('tag')
  })

  it('fieldAt отдаёт поле последнего ключа; для индекса — поле списка', () => {
    expect(fieldAt(ROOT, ['outbounds', 0, 'uuid'], DOC)?.key).toBe('uuid')
    expect(fieldAt(ROOT, ['outbounds', 0], DOC)?.key).toBe('outbounds')
    expect(fieldAt(ROOT, ['outbounds', 0, 'tls', 'enabled'], DOC)?.kind).toBe('boolean')
    expect(fieldAt(ROOT, ['zzz'], DOC)).toBeUndefined()
  })
})

describe('неизвестное и устаревшее', () => {
  it('unknownKeys называет ключи документа, которых нет в схеме, включая скрытые условием — нет', () => {
    expect(unknownKeys(OUTBOUND, { type: 'direct', tag: 'd', extra: 1, uuid: 'x' })).toEqual(['extra'])
  })

  it('deprecatedAt находит устаревший ключ и устаревшее значение перечисления', () => {
    const found = deprecatedAt(OUTBOUND, { type: 'block', override_port: 1 })
    expect(found).toEqual([
      { key: 'type', value: 'block', deprecation: { since: '1.13.0', replacement: 'действие правила reject' } },
      { key: 'override_port', deprecation: { since: '1.11.0', replacement: 'route-options.override_port' } },
    ])
    expect(deprecatedAt(OUTBOUND, { type: 'direct' })).toEqual([])
  })

  it('устаревший ключ с enum даёт ровно одну запись, а не две', () => {
    // Значение 'a' само НЕ помечено устаревшим — этой веткой continue не поймать,
    // раз ветка перечисления и без него не сработает (enum.find ничего не найдёт)
    const legacy: FieldSchema = {
      key: 'legacy',
      doc: 'Старое поле',
      kind: 'enum',
      enum: [{ value: 'a' }],
      deprecated: { since: '1.0.0', replacement: 'ничего' },
    }
    expect(deprecatedAt([legacy], { legacy: 'a' })).toEqual([
      { key: 'legacy', deprecation: { since: '1.0.0', replacement: 'ничего' } },
    ])
    // А тут и ключ устарел, и текущее значение перечисления устарело само по
    // себе — без continue после первого push вторая ветка сработает тоже и
    // задвоит запись
    const both: FieldSchema = {
      key: 'legacy2',
      doc: 'Совсем старое поле',
      kind: 'enum',
      enum: [{ value: 'a', deprecated: { since: '0.9.0', replacement: 'x' } }],
      deprecated: { since: '1.0.0', replacement: 'ничего' },
    }
    expect(deprecatedAt([both], { legacy2: 'a' })).toEqual([
      { key: 'legacy2', deprecation: { since: '1.0.0', replacement: 'ничего' } },
    ])
  })
})

describe('обход по схеме', () => {
  it('walkSchema обходит объекты и элементы списков по схеме, но не неизвестные ключи', () => {
    const seen: string[] = []
    walkSchema(ROOT, { ...DOC, mystery: { deep: {} } }, (path) => seen.push(path.join('.')))
    expect(seen).toEqual(['', 'log', 'outbounds.0', 'outbounds.0.tls', 'outbounds.1'])
  })
})
