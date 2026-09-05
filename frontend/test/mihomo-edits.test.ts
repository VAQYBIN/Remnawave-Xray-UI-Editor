import { describe, expect, it } from 'vitest'
import {
  addRule, applyEdits, fieldOrigin, removeRule, renameGroup, setGroupField, setRuleTarget,
} from '../src/entities/mihomo/edits'
import { groupsOf } from '../src/entities/mihomo/groups'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { rulesOf } from '../src/entities/mihomo/rules'
import { mihomoFixture } from './helpers'

const edit = (text: string, make: (md: ReturnType<typeof parseMihomo>) => ReturnType<typeof renameGroup>) =>
  applyEdits(text, make(parseMihomo(text)))

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

describe('переименование группы', () => {
  it('меняет имя и все ссылки на него', () => {
    const text = mihomoFixture('simple')
    const out = edit(text, (md) => renameGroup(md, '▶️ YouTube', '▶️ Ютуб'))
    expect(out).toContain('name: ▶️ Ютуб')
    expect(out).toContain('RULE-SET,youtube,▶️ Ютуб')
    expect(out).not.toContain('▶️ YouTube')
  })

  it('не трогает байты вне правки', () => {
    const text = mihomoFixture('simple')
    const out = edit(text, (md) => renameGroup(md, '▶️ YouTube', '▶️ Ютуб'))
    const changed = out.split('\n').filter((line, i) => line !== text.split('\n')[i])
    // Ровно две строки: объявление группы и правило, ведущее в неё
    expect(changed).toHaveLength(2)
  })

  it('маркеры, якоря и слияния переживают правку', () => {
    const text = mihomoFixture('simple')
    const out = edit(text, (md) => renameGroup(md, '▶️ YouTube', '▶️ Ютуб'))
    const count = (s: string, needle: string) => s.split(needle).length - 1
    expect(count(out, 'LEAVE THIS LINE!')).toBe(count(text, 'LEAVE THIS LINE!'))
    expect(count(out, '<<:')).toBe(count(text, '<<:'))
    expect(count(out, '&rp_domain')).toBe(count(text, '&rp_domain'))
  })

  it('пустой список правок оставляет файл побайтово тем же', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const text = mihomoFixture(name)
      expect(applyEdits(text, [])).toBe(text)
    }
  })
})

describe('поля группы', () => {
  it('меняет тип группы', () => {
    const text = 'proxy-groups:\n  - name: a\n    type: select\n'
    const out = edit(text, (md) => setGroupField(md, 0, 'type', 'url-test'))
    expect(out).toBe('proxy-groups:\n  - name: a\n    type: url-test\n')
  })

  it('добавляет отсутствующее поле с отступом группы', () => {
    const text = 'proxy-groups:\n  - name: a\n    type: select\n'
    const out = edit(text, (md) => setGroupField(md, 0, 'hidden', true))
    expect(out).toContain('    hidden: true')
    expect(groupsOf(parseMihomo(out))[0]!.hidden).toBe(true)
  })

  it('значение из слияния правкой не трогается', () => {
    const text =
      'x-anchors:\n  base: &base\n    type: select\nproxy-groups:\n  - name: a\n    <<: *base\n'
    const md = parseMihomo(text)
    expect(fieldOrigin(md, 0, 'type')).toBe('merged')
    expect(setGroupField(md, 0, 'type', 'url-test')).toEqual([])
  })

  it('собственное поле рядом со слиянием правится', () => {
    const text =
      'x-anchors:\n  base: &base\n    lazy: true\nproxy-groups:\n  - name: a\n    <<: *base\n    type: select\n'
    const md = parseMihomo(text)
    expect(fieldOrigin(md, 0, 'type')).toBe('own')
    expect(setGroupField(md, 0, 'type', 'url-test')).not.toEqual([])
  })
})

describe('правила', () => {
  it('меняет цель правила, не трогая условие', () => {
    const text = 'rules:\n  - IP-CIDR,17.0.0.0/8,DIRECT,no-resolve\n'
    const out = edit(text, (md) => setRuleTarget(md, 0, 'VPN'))
    expect(out).toBe('rules:\n  - IP-CIDR,17.0.0.0/8,VPN,no-resolve\n')
  })

  it('удаляет правило вместе со строкой', () => {
    const text = 'rules:\n  - DOMAIN,a.com,DIRECT\n  - MATCH,DIRECT\n'
    const out = edit(text, (md) => removeRule(md, 0))
    expect(out).toBe('rules:\n  - MATCH,DIRECT\n')
  })

  it('вставляет правило перед указанным', () => {
    const text = 'rules:\n  - MATCH,DIRECT\n'
    const out = edit(text, (md) => addRule(md, 'DOMAIN,a.com,VPN', 0))
    expect(out).toBe('rules:\n  - DOMAIN,a.com,VPN\n  - MATCH,DIRECT\n')
    expect(rulesOf(parseMihomo(out))).toHaveLength(2)
  })

  it('вставка в конец списка', () => {
    const text = 'rules:\n  - DOMAIN,a.com,VPN\n'
    const out = edit(text, (md) => addRule(md, 'MATCH,DIRECT'))
    expect(out).toBe('rules:\n  - DOMAIN,a.com,VPN\n  - MATCH,DIRECT\n')
  })
})
