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
  })

  it('заводит группу в конец секции', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, addGroup(md, 'Новая'))
    const groups = groupsOf(parseMihomo(next))
    expect(groups.map((g) => g.name)).toEqual(['A', 'B', 'Новая'])
    expect(groups[2]!.type).toBe('select')
  })

  it('удаляет группу целиком, не задев соседей', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, removeGroup(md, 0))
    expect(groupsOf(parseMihomo(next)).map((g) => g.name)).toEqual(['B'])
    expect(next).toContain('enhanced-mode: fake-ip')
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

  it('перестановка за границы списка ничего не меняет', () => {
    const md = parseMihomo(DOC)
    expect(moveMihomoRule(md, 0, -1)).toEqual([])
    expect(moveMihomoRule(md, 1, 1)).toEqual([])
  })

  it('на эталонных шаблонах правка поля не трогает байты вне своего диапазона', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const text = mihomoFixture(name)
      const md = parseMihomo(text)
      const group = groupsOf(md)[0]
      if (group === undefined || group.type === undefined) continue
      const edits = setFieldAt(md, ['proxy-groups', group.index], 'type', 'fallback')
      if (edits.length === 0) continue
      const next = applyEdits(text, edits)
      const edit = edits[0]!
      expect(next.slice(0, edit.from), name).toBe(text.slice(0, edit.from))
      expect(next.slice(next.length - (text.length - edit.to)), name).toBe(text.slice(edit.to))
    }
  })
})
