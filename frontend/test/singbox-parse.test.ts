import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import { singboxFixture as fixture } from './helpers'

describe('разбор документа sing-box', () => {
  it.each(['default', 'bundle', 'legacy'] as const)('настоящий шаблон %s разбирается', (name) => {
    const res = parseSingbox(fixture(name))
    expect(res.ok).toBe(true)
    expect(res.issues).toEqual([])
    expect(res.doc!.outbounds!.length).toBeGreaterThan(0)
  })

  it('битый JSON объясняется по-русски и не даёт модели', () => {
    const res = parseSingbox('{ "outbounds": [')
    expect(res.ok).toBe(false)
    expect(res.doc).toBeUndefined()
    expect(res.issues[0]!.level).toBe('error')
    expect(res.issues[0]!.message).toMatch(/JSON/)
    expect(res.issues[0]!.parts).toEqual([])
  })

  it('корень-массив — ошибка с понятной причиной', () => {
    const res = parseSingbox('[]')
    expect(res.ok).toBe(false)
    expect(res.issues[0]!.message).toMatch(/объект/)
  })

  it('выход без type — ошибка с путём до элемента', () => {
    const res = parseSingbox('{"outbounds":[{"tag":"x"}]}')
    expect(res.ok).toBe(false)
    expect(res.issues[0]!.parts).toEqual(['outbounds', 0, 'type'])
  })

  it('незнакомые ключи проходят насквозь', () => {
    // Ядро развивается быстрее словаря: строгая схема отвергала бы валидные
    // документы будущих версий
    const res = parseSingbox('{"outbounds":[{"type":"direct","tag":"d","brand_new_field":1}],"future_section":{"a":1}}')
    expect(res.ok).toBe(true)
    expect(res.doc!.outbounds![0]!.brand_new_field).toBe(1)
    expect(res.doc!.future_section).toEqual({ a: 1 })
  })

  it('null в outbounds группы сохраняется как есть', () => {
    // Дефолтный шаблон панели пишет именно null, и модель обязана уметь его
    // отличить от пустого списка
    const res = parseSingbox('{"outbounds":[{"type":"selector","tag":"g","outbounds":null}]}')
    expect(res.ok).toBe(true)
    expect(res.doc!.outbounds![0]!.outbounds).toBeNull()
  })
})
