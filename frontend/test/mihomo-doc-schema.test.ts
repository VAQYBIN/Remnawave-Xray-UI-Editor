import { describe, expect, it } from 'vitest'
import {
  fieldOf,
  fieldsOf,
  MIHOMO_SECTIONS,
  sectionForKey,
} from '../src/entities/mihomo/docSchema'
import { mihomoFixture } from './helpers'
import { parseMihomo } from '../src/entities/mihomo'

describe('словарь Mihomo', () => {
  it('знает поля группы, включая ключи remnawave', () => {
    const keys = fieldsOf('proxy-group').map((f) => f.key)
    expect(keys).toEqual(
      expect.arrayContaining([
        'name', 'type', 'proxies', 'use', 'include-all', 'filter', 'exclude-filter',
        'url', 'interval', 'lazy', 'tolerance', 'hidden', 'icon',
        'remnawave.include-proxies', 'remnawave.select-random-proxy',
        'remnawave.shuffle-proxies-order',
      ]),
    )
  })

  it('тип группы — enum из пяти значений ядра', () => {
    expect(fieldOf('proxy-group', 'type')?.enum?.map((e) => e.value)).toEqual([
      'select', 'url-test', 'fallback', 'load-balance', 'relay',
    ])
  })

  // Ключи снифера перечислены в документации ядра полностью, поэтому и
  // сверяемся с полным списком, а не с «содержит вот эти». Пропущенный ключ
  // не ломает документ — его просто не видно в форме, и заметить пропажу
  // иначе нечем: молчание формы выглядит как «такого ключа не бывает»
  it('секция снифера знает все ключи, задокументированные ядром', () => {
    expect(fieldsOf('sniffer').map((f) => f.key).sort()).toEqual(
      [
        'enable',
        'force-dns-mapping',
        'force-domain',
        'override-destination',
        'parse-pure-ip',
        'skip-domain',
        'skip-dst-address',
        'skip-src-address',
        'sniff',
      ].sort(),
    )
  })

  it('отпечаток клиента предлагает все значения карты ядра', () => {
    // Документация ядра их не перечисляет, а описывает примерами, поэтому
    // список зеркалит карту отпечатков самого ядра. Это подсказка, а не
    // ограничение: незнакомое значение проходит насквозь
    expect(fieldOf('root', 'global-client-fingerprint')?.enum?.map((e) => e.value)).toEqual([
      'chrome',
      'firefox',
      'safari',
      'ios',
      'android',
      'edge',
      '360',
      'qq',
      'random',
      'none',
    ])
  })
  it('знает поля провайдера, включая override', () => {
    const keys = fieldsOf('proxy-provider').map((f) => f.key)
    expect(keys).toEqual(
      expect.arrayContaining([
        'type', 'url', 'interval', 'remnawave.include-proxies',
        'override.dialer-proxy', 'override.additional-prefix',
      ]),
    )
  })

  it('behavior набора правил — enum, но значение остаётся строкой', () => {
    const field = fieldOf('rule-provider', 'behavior')
    expect(field?.type).toBe('string')
    expect(field?.enum?.map((e) => e.value)).toEqual(['domain', 'ipcidr', 'classical'])
  })

  it('у каждого поля есть русское описание — оно уходит и в форму, и в подсказку', () => {
    for (const section of Object.values(MIHOMO_SECTIONS)) {
      for (const field of section.fields) {
        expect(field.doc, `${section.name}.${field.key}`).not.toBe('')
      }
    }
  })

  it('секция ключа верхнего уровня определяется по имени', () => {
    expect(sectionForKey('dns')).toBe('dns')
    expect(sectionForKey('tun')).toBe('tun')
    expect(sectionForKey('sniffer')).toBe('sniffer')
    expect(sectionForKey('profile')).toBe('profile')
    expect(sectionForKey('mode')).toBeUndefined()
  })

  it('ни одна секция не осталась пустой', () => {
    for (const section of Object.values(MIHOMO_SECTIONS)) {
      expect(section.fields.length, section.name).toBeGreaterThan(1)
    }
  })

  // Словарь обязан покрывать то, что реально встречается в живых шаблонах:
  // незнакомое поле в форме превращается в «правьте руками», и молча копить
  // такие поля нельзя
  it('покрывает ключи групп из всех трёх эталонных шаблонов', () => {
    const known = new Set(fieldsOf('proxy-group').map((f) => f.key))
    const unknown = new Set<string>()
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const md = parseMihomo(mihomoFixture(name))
      const seq = md.doc.get('proxy-groups') as { items?: unknown[] } | undefined
      for (const item of seq?.items ?? []) {
        for (const pair of (item as { items?: { key?: { value?: unknown } }[] }).items ?? []) {
          const key = pair.key?.value
          if (typeof key === 'string' && key !== '<<' && !known.has(key) && !key.startsWith('remnawave')) {
            unknown.add(key)
          }
        }
      }
    }
    expect([...unknown]).toEqual([])
  })
})
