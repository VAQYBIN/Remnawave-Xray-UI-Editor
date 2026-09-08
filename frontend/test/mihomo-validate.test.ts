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

  // Содержимое подсписка проверяется теми же правилами, что и основной список:
  // это правила Mihomo, а не другой язык. Раньше проверялся только основной, и
  // одна и та же опечатка давала предупреждение в `rules` и тишину тремя
  // строками ниже — молчание при этом читалось как «всё в порядке».
  describe('содержимое sub-rules', () => {
    const withSub = (body: string) =>
      `sub-rules:${'\n'}  ru:${'\n'}${body}rules:${'\n'}  - SUB-RULE,(NETWORK,tcp),ru${'\n'}  - MATCH,DIRECT${'\n'}`

    it('неизвестный тип правила виден и внутри подсписка', () => {
      expect(messages(withSub('    - ДОМЕН,a.com,DIRECT\n')).join(' ')).toContain(
        'Неизвестный тип правила',
      )
    })

    it('неизвестная цель внутри подсписка тоже называется', () => {
      expect(messages(withSub('    - DOMAIN,a.com,нет-такой-группы\n')).join(' ')).toContain(
        'нет-такой-группы',
      )
    })

    it('необъявленный набор правил внутри подсписка тоже называется', () => {
      expect(messages(withSub('    - RULE-SET,нет-набора,DIRECT\n')).join(' ')).toContain(
        'не объявлен в rule-providers',
      )
    })

    it('правило после MATCH недостижимо и внутри подсписка', () => {
      const text = withSub('    - MATCH,DIRECT\n    - DOMAIN,a.com,DIRECT\n')
      expect(messages(text).join(' ')).toContain('никогда не сработает')
    })

    it('место проблемы — путь до правила подсписка, а не до секции', () => {
      // По этому пути резолвер графа ведёт на карточку подсписка; отдельных
      // узлов у его правил нет, поэтому глубже пути и не нужно
      const issues = validateMihomo(parseMihomo(withSub('    - ДОМЕН,a.com,DIRECT\n')))
      const found = issues.find((i) => i.message.includes('Неизвестный тип правила'))
      expect(found?.parts).toEqual(['sub-rules', 'ru', 0])
    })

    it('подсписку без MATCH не предъявляют отсутствие MATCH', () => {
      // Вывод «трафик пойдёт напрямую» верен только для основного списка. В
      // подсписке «ничего не совпало» выводит ОБРАТНО в основной список, и
      // требовать там MATCH значило бы требовать ошибку
      const text = withSub('    - DOMAIN,a.com,DIRECT\n')
      const about = messages(text).filter((m) => m.includes('нет MATCH'))
      expect(about).toEqual([])
    })

    it('значение подсписка не список — предупреждение, а не тишина', () => {
      // Ядру здесь нечего исполнять, а трассировка на таком подсписке встаёт.
      // Сказать об этом в диагностиках дешевле, чем ждать трассировки
      const text = 'sub-rules:\n  ru: DIRECT\nrules:\n  - SUB-RULE,(NETWORK,tcp),ru\n  - MATCH,DIRECT\n'
      expect(messages(text).join(' ')).toContain('не список правил')
    })
  })
  it('правило после MATCH недостижимо', () => {
    const text = 'rules:\n  - MATCH,DIRECT\n  - DOMAIN,a.com,DIRECT\n'
    expect(messages(text).join(' ')).toContain('никогда не сработает')
  })

  it('отсутствие MATCH — предупреждение', () => {
    expect(messages('rules:\n  - DOMAIN,a.com,DIRECT\n').join(' ')).toContain('MATCH')
  })

  it('правило-алиас — валидный YAML, ни одной ошибки; предупреждение честно про якорь', () => {
    const text = 'rules:\n  - &r1 MATCH,DIRECT\n  - *r1\n'
    const issues = validateMihomo(parseMihomo(text))
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
    expect(issues.map((i) => i.message).join(' ')).toMatch(/алиас|якор/i)
  })

  it('алиас в конце списка не даёт ложного «нет MATCH» — содержимое якоря редактору не видно', () => {
    const text = 'rules:\n  - &r1 DOMAIN,a.com,DIRECT\n  - *r1\n'
    const issues = validateMihomo(parseMihomo(text))
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
    expect(issues.map((i) => i.message).join(' ')).not.toMatch(/нет MATCH/)
  })

  it('include-proxies: true у группы — предупреждение, ключ значим только у провайдера', () => {
    const text = 'proxy-groups:\n  - name: a\n    remnawave:\n      include-proxies: true\n'
    expect(messages(text).join(' ')).toContain('proxy-providers')
  })

  it('незнакомый модификатор правила — предупреждение (опечатка no-resolv вместо no-resolve)', () => {
    const text = 'rules:\n  - DOMAIN,a.com,DIRECT,no-resolv\n'
    expect(messages(text).join(' ')).toContain('no-resolv')
  })

  it('известный модификатор правила не даёт диагностики', () => {
    const text = 'rules:\n  - DOMAIN,a.com,DIRECT,no-resolve\n'
    expect(messages(text).some((m) => m.includes('модифи'))).toBe(false)
  })
})
