import { describe, expect, it } from 'vitest'
import {
  descendSingbox,
  nestedFields,
  nestedNamespaceDoc,
  sectionAtPath,
} from '../src/entities/singbox/docPath'

/** Тип элемента по пути: тесты подставляют его вручную, в редакторе — читается из документа */
function typeAt(types: Record<string, string>) {
  return (path: readonly (string | number)[]) => types[path.join('.')]
}

describe('маршрутизация словаря sing-box по дереву', () => {
  it('корневые контейнеры ведут в свои секции', () => {
    expect(descendSingbox('root', 'route', {})).toBe('route')
    expect(descendSingbox('root', 'dns', {})).toBe('dns')
    expect(descendSingbox('root', 'inbounds', {})).toBe('inbound')
    expect(descendSingbox('root', 'experimental', {})).toBe('experimental')
  })

  it('элемент outbounds — сервер, а группа выбирается по типу', () => {
    // Группа и сервер лежат в одном массиве и отличаются ТОЛЬКО полем type:
    // без него подсказка предлагала бы outbounds группе и url серверу
    expect(descendSingbox('root', 'outbounds', {})).toBe('outbound')
    expect(descendSingbox('root', 'outbounds', { type: 'selector' })).toBe('group')
    expect(descendSingbox('root', 'outbounds', { type: 'urltest' })).toBe('group')
    expect(descendSingbox('root', 'outbounds', { type: 'shadowsocks' })).toBe('outbound')
  })

  it('правила и наборы правил лежат внутри route', () => {
    expect(descendSingbox('route', 'rules', {})).toBe('route-rule')
    expect(descendSingbox('route', 'rule_set', {})).toBe('rule-set')
  })

  it('вложенные правила логического правила — те же правила маршрута', () => {
    // type: logical несёт rules с такими же условиями: своя секция для них была
    // бы копией route-rule, расходящейся с оригиналом на первом же поле
    expect(descendSingbox('route-rule', 'rules', {})).toBe('route-rule')
  })

  it('серверы DNS — своя секция', () => {
    expect(descendSingbox('dns', 'servers', {})).toBe('dns-server')
  })

  it('незнакомый ключ секции не даёт секции', () => {
    expect(descendSingbox('root', 'brand_new_section', {})).toBeUndefined()
    expect(descendSingbox(undefined, 'route', {})).toBeUndefined()
  })

  it('путь целиком разрешается в секцию', () => {
    const types = typeAt({ 'outbounds.1': 'selector' })
    expect(sectionAtPath([], types)).toBe('root')
    expect(sectionAtPath(['route'], types)).toBe('route')
    expect(sectionAtPath(['route', 'rules', 0], types)).toBe('route-rule')
    expect(sectionAtPath(['route', 'rules', 0, 'rules', 2], types)).toBe('route-rule')
    expect(sectionAtPath(['outbounds', 0], types)).toBe('outbound')
    expect(sectionAtPath(['outbounds', 1], types)).toBe('group')
    expect(sectionAtPath(['dns', 'servers', 0], types)).toBe('dns-server')
  })

  it('путь, уходящий в незнакомое, секции не имеет', () => {
    // Молчание лучше догадки: подсказка по чужой секции читается как знание
    expect(sectionAtPath(['route', 'rules', 0, 'whatever'], typeAt({}))).toBeUndefined()
  })

  it('вложенное отображение отдаёт свои листья и общее описание', () => {
    // В словаре ЕДИНСТВЕННЫЙ составной ключ — remnawave.includeProxies в секции
    // group (clash_api.* из брифа в SINGBOX_SECTIONS.experimental не существует:
    // там clash_api описан одним полем-объектом, а не набором вложенных ключей)
    const fields = nestedFields('group', 'remnawave')
    expect(fields.length).toBeGreaterThan(0)
    // Ключи листьев — КОРОТКИЕ: внутри отображения пишут includeProxies,
    // а не remnawave.includeProxies
    expect(fields.every((f) => !f.key.includes('.'))).toBe(true)
    expect(nestedNamespaceDoc('group', 'remnawave')).toMatch(/remnawave/)
    expect(nestedNamespaceDoc('group', 'no_such_key')).toBeUndefined()
  })
})
