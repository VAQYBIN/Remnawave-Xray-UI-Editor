import { describe, expect, it } from 'vitest'
import { canonicalize, hashTemplateJson } from '../src/templates/hash.js'

describe('хэш содержимого шаблона', () => {
  // Порядок ключей в JSON незначим, порядок элементов массива — значим
  it('не зависит от порядка ключей', () => {
    const a = { outbounds: [{ tag: 'direct', protocol: 'freedom' }], dns: { servers: ['1.1.1.1'] } }
    const b = { dns: { servers: ['1.1.1.1'] }, outbounds: [{ protocol: 'freedom', tag: 'direct' }] }
    expect(hashTemplateJson(a)).toBe(hashTemplateJson(b))
  })

  it('зависит от порядка элементов массива', () => {
    expect(hashTemplateJson({ rules: [1, 2] })).not.toBe(hashTemplateJson({ rules: [2, 1] }))
  })

  it('меняется при изменении значения', () => {
    expect(hashTemplateJson({ a: 1 })).not.toBe(hashTemplateJson({ a: 2 }))
  })

  // У YAML-типов templateJson равен null — хэш обязан считаться, а не падать
  it('переживает null и undefined', () => {
    expect(hashTemplateJson(null)).toBe(hashTemplateJson(undefined))
    expect(hashTemplateJson(null)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('canonicalize сортирует ключи рекурсивно и не трогает массивы', () => {
    expect(JSON.stringify(canonicalize({ b: 1, a: { d: 2, c: [3, 1] } }))).toBe(
      '{"a":{"c":[3,1],"d":2},"b":1}',
    )
  })
})
