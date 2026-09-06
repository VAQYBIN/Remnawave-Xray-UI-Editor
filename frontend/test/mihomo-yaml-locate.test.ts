import { describe, expect, it } from 'vitest'
import { parseMihomo, validateMihomo } from '../src/entities/mihomo'
import { mihomoDiagnostics } from '../src/features/editor/yamlLocate'
import type { ValidationIssue } from '../src/entities/xray'

const DOC = [
  'proxy-groups:',
  '  - name: A',
  '    type: select',
  '    proxies:',
  '      - НЕТ ТАКОГО',
  '  - name: A',
  '    type: select',
  'rules:',
  '  - MATCH,A',
  '',
].join('\n')

/** Полный прогон линтера: разбор один, как в YamlView */
function diagnose(text: string) {
  const md = parseMihomo(text)
  return mihomoDiagnostics(md, validateMihomo(md))
}

function issue(parts: (string | number)[], message: string): ValidationIssue {
  return { parts, path: parts.join('.'), message, level: 'error' }
}

describe('диагностики YAML-вкладки', () => {
  it('ведут к месту пути в тексте', () => {
    const [found] = mihomoDiagnostics(parseMihomo(DOC), [issue(['proxy-groups', 1, 'name'], 'дубль')])
    expect(DOC.slice(found.from, found.to)).toBe('A')
    expect(found.message).toBe('proxy-groups.1.name: дубль')
  })

  it('путь, оборвавшийся на середине, показывают у глубочайшего предка', () => {
    const [found] = mihomoDiagnostics(parseMihomo(DOC), [issue(['proxy-groups', 0, 'interval'], 'нет поля')])
    expect(DOC.slice(found.from, found.to)).toContain('name: A')
  })

  it('пути, которого в документе нет, не ищут места и не падают', () => {
    const [found] = mihomoDiagnostics(parseMihomo(DOC), [issue(['dns', 'nameserver'], 'нет секции')])
    expect(found.from).toBe(0)
    expect(found.to).toBe(0)
    expect(found.message).toContain('место в документе не определено')
  })

  it('пустой путь — тоже без места', () => {
    const [found] = mihomoDiagnostics(parseMihomo(DOC), [{ parts: [], path: '', message: 'общая', level: 'warning' }])
    expect(found).toMatchObject({ from: 0, to: 0, severity: 'warning' })
  })

  it('настоящие проблемы шаблона попадают на свои узлы', () => {
    const found = diagnose(DOC)
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((d) => !d.message.includes('место в документе не определено'))).toBe(true)
  })

  it('синтаксическая ошибка встаёт на своё место, а не в начало документа', () => {
    const broken = 'mode: rule\ndns:\n  enable: [\nlog-level: info\n'
    const found = diagnose(broken)
    const syntax = found.filter((d) => d.message.startsWith('Синтаксис YAML'))
    expect(syntax.length).toBeGreaterThan(0)
    for (const d of syntax) {
      expect(d.severity).toBe('error')
      expect(d.from).toBeGreaterThan(0)
      expect(d.to).toBeLessThanOrEqual(broken.length)
      // место в документе теперь известно — приписки быть не должно
      expect(d.message).not.toContain('место в документе не определено')
    }
    // и в начало документа та же ошибка вторым маркером не дублируется
    expect(found.filter((d) => d.from === 0 && d.to === 0)).toHaveLength(0)
  })
})
