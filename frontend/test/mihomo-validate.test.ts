import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { resolveTarget } from '../src/entities/mihomo/resolve'
import { validateMihomo } from '../src/entities/mihomo/validate'
import { mihomoFixture } from './helpers'

const messages = (yaml: string) => validateMihomo(parseMihomo(yaml)).map((i) => i.message)

describe('разрешение имени цели', () => {
  it('различает группу, провайдера и встроенное имя', () => {
    const md = parseMihomo(
      'proxy-groups:\n  - name: VPN\nproxy-providers:\n  ru:\n    type: inline\n',
    )
    expect(resolveTarget(md, 'VPN')).toBe('group')
    expect(resolveTarget(md, 'ru')).toBe('provider')
    expect(resolveTarget(md, 'DIRECT')).toBe('builtin')
    expect(resolveTarget(md, 'что-то')).toBe('unknown')
  })
})

describe('диагностики', () => {
  it('эталонные шаблоны проходят без ошибок', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const errors = validateMihomo(parseMihomo(mihomoFixture(name))).filter((i) => i.level === 'error')
      expect(errors, `${name}: ${errors.map((e) => e.message).join('; ')}`).toEqual([])
    }
  })

  it('неизвестное имя цели — предупреждение, а не ошибка: это может быть хост панели', () => {
    const issues = validateMihomo(
      parseMihomo('proxy-groups:\n  - name: VPN\nrules:\n  - MATCH,🇫🇮 Finland1\n'),
    )
    expect(issues.every((i) => i.level === 'warning')).toBe(true)
    expect(issues.map((i) => i.message).join(' ')).toContain('🇫🇮 Finland1')
  })

  it('неразобранная строка правила — ошибка', () => {
    expect(messages('rules:\n  - DIRECT\n').join(' ')).toContain('не похоже на правило')
  })

  it('дублирование имён групп — ошибка', () => {
    const issues = validateMihomo(parseMihomo('proxy-groups:\n  - name: a\n  - name: a\n'))
    expect(issues.some((i) => i.level === 'error' && i.message.includes('повторяется'))).toBe(true)
  })

  it('цикл групп — ошибка', () => {
    const issues = validateMihomo(
      parseMihomo('proxy-groups:\n  - name: a\n    proxies:\n      - b\n  - name: b\n    proxies:\n      - a\n'),
    )
    expect(issues.some((i) => i.level === 'error' && i.message.includes('кольцо'))).toBe(true)
  })

  it('маркер при include-proxies: false — предупреждение о пустой группе', () => {
    const text =
      'proxy-groups:\n  - name: a\n    remnawave:\n      include-proxies: false\n    proxies:\n      # LEAVE THIS LINE!\n'
    expect(messages(text).join(' ')).toContain('останется пустой')
  })

  it('два способа выборки сразу — предупреждение', () => {
    const text =
      'proxy-groups:\n  - name: a\n    remnawave:\n      select-random-proxy: true\n      shuffle-proxies-order: true\n'
    expect(messages(text).join(' ')).toContain('одновременно')
  })

  it('ссылка на несуществующий набор правил — предупреждение', () => {
    expect(messages('rules:\n  - RULE-SET,нет-такого,DIRECT\n').join(' ')).toContain('нет-такого')
  })

  // У SUB-RULE третье поле — имя подсписка правил, а НЕ имя группы. Проверять его
  // как цель значит ругаться на каждый корректный шаблон с подправилами.
  it('SUB-RULE проверяется по sub-rules, а не по группам', () => {
    const good = 'sub-rules:\n  ru:\n    - MATCH,DIRECT\nrules:\n  - SUB-RULE,(NETWORK,tcp),ru\n  - MATCH,DIRECT\n'
    expect(messages(good).join(' ')).not.toContain('ru')
    const bad = 'rules:\n  - SUB-RULE,(NETWORK,tcp),нет-такого\n  - MATCH,DIRECT\n'
    expect(messages(bad).join(' ')).toContain('подсписок')
  })

  it('правило после MATCH недостижимо', () => {
    const text = 'rules:\n  - MATCH,DIRECT\n  - DOMAIN,a.com,DIRECT\n'
    expect(messages(text).join(' ')).toContain('никогда не сработает')
  })

  it('отсутствие MATCH — предупреждение', () => {
    expect(messages('rules:\n  - DOMAIN,a.com,DIRECT\n').join(' ')).toContain('MATCH')
  })
})
