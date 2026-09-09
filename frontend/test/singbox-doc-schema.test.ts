import { describe, expect, it } from 'vitest'
import { SINGBOX_SECTIONS, fieldFor } from '../src/entities/singbox/docSchema'
import { singboxFixture } from './helpers'

describe('словарь sing-box', () => {
  it('в секции нет двух описаний одного ключа', () => {
    for (const [section, fields] of Object.entries(SINGBOX_SECTIONS)) {
      const keys = fields.map((f) => f.key)
      expect(new Set(keys).size, `дубли в секции ${section}`).toBe(keys.length)
    }
  })

  it('у каждого поля непустое русское описание', () => {
    for (const fields of Object.values(SINGBOX_SECTIONS)) {
      for (const field of fields) {
        expect(field.doc.trim().length, `пустое описание у ${field.key}`).toBeGreaterThan(0)
        expect(field.doc).toMatch(/[а-яА-ЯёЁ]/)
      }
    }
  })

  it('ключ панели помечен как панельный и живёт в секции группы', () => {
    const field = fieldFor('group', 'remnawave.includeProxies')
    expect(field).toBeDefined()
    expect(field!.panelKey).toBe(true)
  })

  it('ключи настоящих шаблонов описаны на верхнем уровне', () => {
    const doc = JSON.parse(singboxFixture('bundle')) as Record<string, unknown>
    const missing = Object.keys(doc).filter((key) => fieldFor('root', key) === undefined)
    expect(missing, `не описаны корневые ключи: ${missing.join(', ')}`).toEqual([])
  })

  it('тип выхода не предлагает то, чего ядро 1.13 уже не знает', () => {
    // block и dns удалены из ядра в 1.13, а панель нацелена именно на 1.13.x:
    // предложи их словарь — пользователь собрал бы шаблон, который ядро не примет
    const values = (fieldFor('outbound', 'type')?.enum ?? []).map((e) => e.value)
    expect(values).not.toContain('block')
    expect(values).not.toContain('dns')
    // Живые типы из списка никуда не делись
    expect(values).toEqual(expect.arrayContaining(['direct', 'selector', 'vless']))
  })

  it('значения enum не пустые', () => {
    for (const fields of Object.values(SINGBOX_SECTIONS)) {
      for (const field of fields) {
        for (const value of field.enum ?? []) {
          expect(value.value.length).toBeGreaterThan(0)
        }
      }
    }
  })
})
