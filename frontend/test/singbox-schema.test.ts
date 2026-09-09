import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import {
  SINGBOX_DOC_SECTIONS,
  SINGBOX_SCHEMA,
  singboxEnum,
  singboxFieldAt,
  singboxFieldsAt,
  singboxRefs,
} from '../src/entities/singbox/schema'
import type { FieldSchema } from '../src/shared/schema'
import { singboxFixture } from './helpers'

function walk(fields: FieldSchema[], seen = new Set<FieldSchema[]>(), visit: (f: FieldSchema) => void) {
  if (seen.has(fields)) return
  seen.add(fields)
  for (const f of fields) {
    visit(f)
    if (f.fields) walk(f.fields, seen, visit)
    if (f.item?.fields) walk(f.item.fields, seen, visit)
  }
}

describe('корень схемы sing-box', () => {
  it('описывает все секции корня', () => {
    expect(SINGBOX_SCHEMA.map((f) => f.key)).toEqual(['log', 'dns', 'ntp', 'certificate', 'endpoints', 'inbounds', 'outbounds', 'route', 'experimental', 'http_clients', 'services'])
  })

  it('у каждого поля дерева непустое описание, у устаревшего — замена, у ссылки — известный вид', () => {
    const refs = new Set(['outbound', 'inbound', 'dns-server', 'rule-set'])
    walk(SINGBOX_SCHEMA, new Set(), (f) => {
      expect(f.doc.trim(), f.key).not.toBe('')
      if (f.deprecated) expect(f.deprecated.replacement.trim(), f.key).not.toBe('')
      if (f.ref) expect(refs.has(f.ref), f.key).toBe(true)
      if (f.item?.ref) expect(refs.has(f.item.ref), f.key).toBe(true)
      for (const e of f.enum ?? []) if (e.deprecated) expect(e.deprecated.replacement.trim(), e.value).not.toBe('')
    })
  })

  it('спуск по пути в живом документе: группа и сервер различаются по типу', () => {
    const doc = parseSingbox(singboxFixture('bundle')).doc!
    // outbounds[0] у фикстуры bundle.json — «direct» (не группа); группа —
    // selector с тегом «default» под индексом 1. Индекс из брифа (0) для этой
    // фикстуры указывал бы на «direct» и не мог бы одновременно нести
    // 'outbounds' (группа) и не нести 'server' (не-сервер) — см. отчёт.
    const group = singboxFieldsAt(['outbounds', 1], doc)!.map((f) => f.key)
    expect(group).toContain('outbounds')
    expect(group).not.toContain('server')
    expect(singboxFieldsAt(['route', 'rules', 0], doc)!.map((f) => f.key)).toContain('rule_set')
    expect(singboxFieldsAt(['dns', 'servers', 0], doc)!.map((f) => f.key)).toContain('tag')
    expect(singboxFieldsAt(['dns', 'rules', 0], doc)!.map((f) => f.key)).toContain('server')
    expect(singboxFieldsAt(['experimental', 'cache_file'], doc)!.map((f) => f.key)).toContain('enabled')
    expect(singboxFieldsAt(['nope'], doc)).toBeUndefined()
  })

  it('legacy-документ: сервер без type видит поле address, выход block описан', () => {
    const doc = parseSingbox(singboxFixture('legacy')).doc!
    const server = singboxFieldsAt(['dns', 'servers', 0], doc)!.map((f) => f.key)
    expect(server).toContain('address')
    expect(singboxEnum(['outbounds', 0, 'type'], doc).map((e) => e.value)).toContain('block')
  })

  it('singboxFieldAt и singboxEnum', () => {
    const doc = { outbounds: [{ type: 'vless', tag: 'a' }] }
    expect(singboxFieldAt(['outbounds', 0, 'flow'], doc)?.kind).toBe('enum')
    expect(singboxEnum(['outbounds', 0, 'flow'], doc).map((e) => e.value)).toEqual(['xtls-rprx-vision'])
    expect(singboxEnum(['outbounds', 0, 'tag'], doc)).toEqual([])
  })

  it('singboxRefs собирает теги по обоим спискам выходов, входам, серверам DNS и наборам', () => {
    const doc = parseSingbox(`{
      "inbounds": [{"type":"tun","tag":"tun-in"}],
      "outbounds": [{"type":"direct","tag":"direct"}],
      "endpoints": [{"type":"wireguard","tag":"wg"}],
      "dns": {"servers": [{"type":"local","tag":"dns-local"}]},
      "route": {"rule_set": [{"type":"remote","tag":"ads","url":"u"}]}
    }`).doc!
    expect(singboxRefs(doc)).toEqual({
      outbound: ['direct', 'wg'],
      inbound: ['tun-in'],
      'dns-server': ['dns-local'],
      'rule-set': ['ads'],
    })
  })

  it('у каждого поля дерева непустое русское описание', () => {
    // Из плоского словаря: непустое описание проверяет и общий обход выше, а
    // здесь отдельно то, что старый тест проверял сверх этого, — сам язык
    walk(SINGBOX_SCHEMA, new Set(), (f) => {
      expect(f.doc, f.key).toMatch(/[а-яА-ЯёЁ]/)
    })
  })

  it('значения enum не пустые', () => {
    walk(SINGBOX_SCHEMA, new Set(), (f) => {
      for (const value of f.enum ?? []) {
        expect(value.value.length, f.key).toBeGreaterThan(0)
      }
    })
  })

  it('ключи настоящих шаблонов описаны на верхнем уровне', () => {
    const doc = JSON.parse(singboxFixture('bundle')) as Record<string, unknown>
    const known = new Set(SINGBOX_SCHEMA.map((f) => f.key))
    const missing = Object.keys(doc).filter((key) => !known.has(key))
    expect(missing, `не описаны корневые ключи: ${missing.join(', ')}`).toEqual([])
  })

  it('разделы панели «Документ» ведут в существующие поля схемы и не повторяют холст', () => {
    for (const section of SINGBOX_DOC_SECTIONS) {
      const field = singboxFieldAt(section.path, {})
      expect(field, section.title).toBeDefined()
      expect(field!.kind, section.title).toBe(section.kind === 'list' ? 'list' : 'object')
    }
    const route = SINGBOX_DOC_SECTIONS.find((s) => s.path.join('.') === 'route')!
    expect(route.skip).toEqual(expect.arrayContaining(['rules', 'rule_set']))
  })
})
