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

  // Прежняя версия этого теста накладывала [] на фикстуру и сравнивала с ней же —
  // результат совпадает по построению applyEdits (правок нет — разбирать нечего),
  // само название группы или наличие анализа никак не проверялось. Это ложное
  // чувство покрытия главного заявления ветки («текст — источник истины, половинных
  // правок не бывает»), а не тест самого инварианта.
  //
  // Настоящая проверка: реальная операция на реальной фикстуре, которая ОБЯЗАНА
  // отказать целиком (новое имя группы не печатается в одну строку — тот же отказ,
  // которым `scalar()` защищает список `proxies` от порчи блочным скаляром), и
  // подтверждение, что после наложения пустого результата документ не тронут ни
  // одним байтом — не только «совпадает с самим собой», а «остался тем, чем был».
  it('операция, обязанная отказать на реальной фикстуре, не трогает ни одного байта', () => {
    const text = mihomoFixture('bundle')
    const md = parseMihomo(text)
    const edits = renameGroup(md, '🌍 VPN', 'a\nb')
    expect(edits).toEqual([])
    expect(applyEdits(text, edits)).toBe(text)
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

  it('C1: вставка в конец файла без завершающего \\n не склеивает строки', () => {
    const text = 'rules:\n  - MATCH,DIRECT'
    const out = edit(text, (md) => addRule(md, 'DOMAIN,a.com,VPN'))
    expect(out).toBe('rules:\n  - MATCH,DIRECT\n  - DOMAIN,a.com,VPN\n')
    expect(rulesOf(parseMihomo(out))).toHaveLength(2)
  })
})

/**
 * Сравнение построчно, устойчивое к операциям, меняющим ОБЩЕЕ число строк
 * (добавление/удаление правила или поля) — не только к правкам «на месте»
 * (rename, смена значения). Общий префикс и общий суффикс совпадающих строк
 * отрезаются с обеих сторон; то, что осталось между ними, и есть изменение.
 */
function changedLines(orig: string, out: string): { removed: number; added: number } {
  const a = orig.split('\n')
  const b = out.split('\n')
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1
  }
  return { removed: a.length - prefix - suffix, added: b.length - prefix - suffix }
}

describe('решение А: коллекции во flow-стиле — отказ', () => {
  it('setRuleTarget отказывает на rules: [...]', () => {
    const md = parseMihomo('rules: [A, B]\n')
    expect(setRuleTarget(md, 0, 'VPN')).toEqual([])
  })

  it('removeRule отказывает на rules: [...] (находка C2)', () => {
    const md = parseMihomo('rules: [A, B]\n')
    expect(removeRule(md, 0)).toEqual([])
  })

  it('addRule отказывает на rules: [...] (находка C2)', () => {
    const md = parseMihomo('rules: [A, B]\n')
    expect(addRule(md, 'DOMAIN,a.com,VPN')).toEqual([])
  })

  it('переименование отказывает целиком, если совпадение живёт в rules: [...]', () => {
    const text = 'proxy-groups:\n  - name: G\n    type: select\nrules: ["RULE-SET,yt,G"]\n'
    const md = parseMihomo(text)
    expect(renameGroup(md, 'G', 'G2')).toEqual([])
  })

  it('переименование отказывает целиком, если совпадение живёт в proxies: [x, y]', () => {
    const text =
      'proxy-groups:\n  - name: G\n    type: select\n  - name: Sel\n    type: select\n    proxies: [G, DIRECT]\n'
    const md = parseMihomo(text)
    expect(renameGroup(md, 'G', 'G2')).toEqual([])
  })
})

describe('решение Б: имя группы из слияния', () => {
  it('переименование отказывает целиком, а не переписывает только ссылки (I2)', () => {
    const text =
      'x-anchors:\n  base: &base\n    name: G\nproxy-groups:\n  - <<: *base\n    type: select\nrules:\n  - RULE-SET,yt,G\n'
    const md = parseMihomo(text)
    expect(fieldOrigin(md, 0, 'name')).toBe('merged')
    expect(renameGroup(md, 'G', 'H')).toEqual([])
  })
})

describe('решение В и I1: детерминизм и конфликт правок', () => {
  it('порядок совпадающих по началу правок не влияет на результат (I1)', () => {
    const text = 'abcdefgh'
    const zeroWidth = { from: 5, to: 5, insert: 'Z' }
    const wider = { from: 5, to: 8, insert: 'XXX' }
    expect(applyEdits(text, [zeroWidth, wider])).toBe(applyEdits(text, [wider, zeroWidth]))
  })

  it('две вставки нулевой длины в одну точку — исключение (решение В)', () => {
    expect(() => applyEdits('abcdef', [{ from: 2, to: 2, insert: 'X' }, { from: 2, to: 2, insert: 'Y' }]))
      .toThrow(/пересек/i)
    // и в обратном порядке — тоже, а не «как повезёт»
    expect(() => applyEdits('abcdef', [{ from: 2, to: 2, insert: 'Y' }, { from: 2, to: 2, insert: 'X' }]))
      .toThrow(/пересек/i)
  })

  it('правка задом наперёд — исключение', () => {
    expect(() => applyEdits('abcdef', [{ from: 3, to: 1, insert: 'x' }])).toThrow()
  })

  it('правка за границами текста — исключение', () => {
    expect(() => applyEdits('abcdef', [{ from: 0, to: 100, insert: 'x' }])).toThrow()
    expect(() => applyEdits('abcdef', [{ from: -1, to: 2, insert: 'x' }])).toThrow()
  })
})

describe('решение Г и I3: строка правила печатается сериализатором', () => {
  it('C4: переименование не портит правило в кавычках с экранированием', () => {
    const text =
      "proxy-groups:\n  - name: Mike's\n    type: select\nrules:\n  - 'RULE-SET,yt,Mike''s'\n  - MATCH,DIRECT\n"
    const out = edit(text, (md) => renameGroup(md, "Mike's", 'Bob'))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(groupsOf(parsed)[0]!.name).toBe('Bob')
    expect(rulesOf(parsed)[0]!.rule?.target).toBe('Bob')
  })

  it('I3: переименование в значение с двоеточием и решёткой не превращает правило в отображение', () => {
    const text = 'proxy-groups:\n  - name: A\n    type: select\nrules:\n  - RULE-SET,yt,A\n  - MATCH,DIRECT\n'
    const out = edit(text, (md) => renameGroup(md, 'A', 'B: c #d'))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(groupsOf(parsed)[0]!.name).toBe('B: c #d')
    expect(rulesOf(parsed)[0]!.rule?.target).toBe('B: c #d')
  })

  it('I3: смена цели правила квотится сериализатором, если нужно', () => {
    const text = 'rules:\n  - MATCH,DIRECT\n'
    const out = edit(text, (md) => setRuleTarget(md, 0, 'B: c #d'))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(rulesOf(parsed)[0]!.rule?.target).toBe('B: c #d')
  })
})

describe('I4: переименование обходит все места, где живёт имя группы', () => {
  it('sub-rules, dialer-proxy у proxies[]/групп и listeners[].proxy', () => {
    const text = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      '  - name: H',
      '    type: relay',
      '    dialer-proxy: G',
      'proxies:',
      '  - name: p1',
      '    type: vmess',
      '    dialer-proxy: G',
      'sub-rules:',
      '  chain:',
      '    - DOMAIN,a.com,G',
      'listeners:',
      '  - name: l1',
      '    type: http',
      '    proxy: G',
      'rules:',
      '  - MATCH,DIRECT',
      '',
    ].join('\n')
    const out = edit(text, (md) => renameGroup(md, 'G', 'G2'))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(out).toContain('name: G2')
    expect((out.match(/dialer-proxy: G2/g) ?? []).length).toBe(2)
    expect(out).toContain('- DOMAIN,a.com,G2')
    expect(out).toContain('proxy: G2')
    expect(out).not.toContain('G\n')
  })
})

describe('C3 и I5: вставка поля не портит соседей', () => {
  it('C3: поле добавляется, даже если первый ключ группы — блочная коллекция с маркером', () => {
    const text =
      'proxy-groups:\n  - proxies:\n      - a\n      # LEAVE THIS LINE!\n    name: g\n    type: select\n'
    const out = edit(text, (md) => setGroupField(md, 0, 'hidden', true))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(out).toContain('hidden: true')
    expect(out.split('LEAVE THIS LINE!')).toHaveLength(2)
  })

  it('I5: хвостовой комментарий остаётся на своей строке, а не переезжает на новое поле', () => {
    const text = 'proxy-groups:\n  - name: g  # важный\n    type: select\n'
    const out = edit(text, (md) => setGroupField(md, 0, 'hidden', true))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(out).toContain('name: g  # важный')
    expect(out).toContain('hidden: true')
    expect(out).not.toContain('true  # важный')
  })
})

describe('минорная находка: пустое значение ключа', () => {
  it('«type:» без значения получает пробел, а не склеивается', () => {
    const text = 'proxy-groups:\n  - name: a\n    type:\n'
    const out = edit(text, (md) => setGroupField(md, 0, 'type', 'url-test'))
    expect(out).toBe('proxy-groups:\n  - name: a\n    type: url-test\n')
  })
})

describe('I6: каждая операция проверена на настоящей фикстуре', () => {
  it('setGroupField (own): меняет ровно одну строку в simple.yaml', () => {
    const text = mihomoFixture('simple')
    const md = parseMihomo(text)
    // группа №3 — «♻️ БезVPN», у неё собственное поле hidden: true
    expect(groupsOf(md)[3]!.name).toBe('♻️ БезVPN')
    const out = applyEdits(text, setGroupField(md, 3, 'hidden', false))
    expect(changedLines(text, out)).toEqual({ removed: 1, added: 1 })
    expect(parseMihomo(out).issues).toHaveLength(0)
    expect(groupsOf(parseMihomo(out))[3]!.hidden).toBe(false)
  })

  it('setGroupField (absent): добавляет ровно одну строку в simple.yaml', () => {
    const text = mihomoFixture('simple')
    const md = parseMihomo(text)
    expect(groupsOf(md)[0]!.name).toBe('🌍 VPN')
    const out = applyEdits(text, setGroupField(md, 0, 'lazy', true))
    expect(changedLines(text, out)).toEqual({ removed: 0, added: 1 })
    expect(parseMihomo(out).issues).toHaveLength(0)
    expect(out).toContain('lazy: true')
  })

  it('setRuleTarget: меняет ровно одну строку в default.yaml', () => {
    const text = mihomoFixture('default')
    const md = parseMihomo(text)
    const out = applyEdits(text, setRuleTarget(md, 0, 'VPN'))
    expect(changedLines(text, out)).toEqual({ removed: 1, added: 1 })
    expect(parseMihomo(out).issues).toHaveLength(0)
    expect(rulesOf(parseMihomo(out))[0]!.rule?.target).toBe('VPN')
  })

  it('removeRule: убирает ровно одну строку в default.yaml', () => {
    const text = mihomoFixture('default')
    const md = parseMihomo(text)
    const out = applyEdits(text, removeRule(md, 1))
    expect(changedLines(text, out)).toEqual({ removed: 1, added: 0 })
    expect(parseMihomo(out).issues).toHaveLength(0)
    expect(rulesOf(parseMihomo(out))).toHaveLength(2)
  })

  it('addRule: добавляет ровно одну строку в default.yaml', () => {
    const text = mihomoFixture('default')
    const md = parseMihomo(text)
    const out = applyEdits(text, addRule(md, 'DOMAIN,test.com,VPN', 0))
    expect(changedLines(text, out)).toEqual({ removed: 0, added: 1 })
    expect(parseMihomo(out).issues).toHaveLength(0)
    expect(rulesOf(parseMihomo(out))).toHaveLength(4)
  })

  it('renameGroup: маркеры выживают во всех трёх фикстурах при пустом попадании', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const text = mihomoFixture(name)
      // группы с таким именем нет ни в одной фикстуре — операция обязана быть no-op
      expect(renameGroup(parseMihomo(text), '__нет-такой-группы__', 'x')).toEqual([])
    }
  })
})

describe('Раунд 2, критическая находка: висячие ссылки при переименовании', () => {
  it('переименование 🌍 VPN в simple.yaml не оставляет ни одной ссылки на старое имя', () => {
    const text = mihomoFixture('simple')
    const md = parseMihomo(text)
    const edits = renameGroup(md, '🌍 VPN', '🌍 ВПН')
    // это не должен быть отказ — находки Part А достаточно, чтобы починить всё
    expect(edits.length).toBeGreaterThan(0)
    const out = applyEdits(text, edits)
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    // сильный тест по просьбе координатора: старое имя не встречается НИ РАЗУ —
    // ни как самостоятельное значение, ни как суффикс после `#`
    expect(out).not.toContain('🌍 VPN')
    expect(groupsOf(parsed).some((g) => g.name === '🌍 ВПН')).toBe(true)
  })

  it('чинит и якорь rule-providers.proxy (через двойное слияние), и DNS-суффикс #<имя>', () => {
    const text = mihomoFixture('simple')
    const out = edit(text, (md) => renameGroup(md, '🌍 VPN', '🌍 ВПН'))
    // якорь pr_http.proxy: 🌍 VPN — единственная физическая запись, её тянут
    // ВСЕ rule-providers через rp_domain/rp_ipcidr/rp_classical
    expect(out).toContain('proxy: 🌍 ВПН')
    // якорь dns_proxy — две DNS-строки с суффиксом #🌍 VPN
    expect((out.match(/dns-query#🌍 ВПН/g) ?? []).length).toBe(2)
    expect(out).not.toContain('#🌍 VPN')
  })

  it('находит ссылку в proxy-providers[].proxy — верхнеуровневый ключ, не override.dialer-proxy', () => {
    const text = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      'proxy-providers:',
      '  p1:',
      '    type: http',
      '    url: https://example.com/list',
      '    proxy: G',
      'rules:',
      '  - MATCH,DIRECT',
      '',
    ].join('\n')
    const out = edit(text, (md) => renameGroup(md, 'G', 'G2'))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(out).toContain('proxy: G2')
    expect(out).not.toContain('proxy: G\n')
  })

  it('находит ссылку в rule-providers[].proxy — верхнеуровневый ключ набора правил', () => {
    const text = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      'rule-providers:',
      '  r1:',
      '    type: http',
      '    behavior: domain',
      '    url: https://example.com/list',
      '    path: ./r1.mrs',
      '    proxy: G',
      'rules:',
      '  - MATCH,DIRECT',
      '',
    ].join('\n')
    const out = edit(text, (md) => renameGroup(md, 'G', 'G2'))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(out).toContain('proxy: G2')
    expect(out).not.toContain('proxy: G\n')
  })
})

describe('Раунд 2, остаток 1: решение А распространено на добавление поля группе', () => {
  it('setGroupField отказывает, если группа целиком записана во flow-стиле', () => {
    const text = 'proxy-groups: [{name: a, type: select}]\n'
    const md = parseMihomo(text)
    expect(setGroupField(md, 0, 'hidden', true)).toEqual([])
  })

  it('setGroupField по-прежнему меняет СОБСТВЕННОЕ поле flow-группы (замена скаляра безопасна)', () => {
    const text = 'proxy-groups: [{name: a, type: select}]\n'
    const md = parseMihomo(text)
    const out = applyEdits(text, setGroupField(md, 0, 'type', 'url-test'))
    expect(out).toBe('proxy-groups: [{name: a, type: url-test}]\n')
  })
})

describe('Раунд 2, остаток 2: addRule печатает правило сериализатором', () => {
  it('addRule квотит значение, если сериализатор считает нужным', () => {
    const text = 'rules:\n  - MATCH,DIRECT\n'
    const md = parseMihomo(text)
    const out = applyEdits(text, addRule(md, 'DOMAIN,a.com,B: c #d', 0))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(rulesOf(parsed)).toHaveLength(2)
    expect(rulesOf(parsed)[0]!.rule?.target).toBe('B: c #d')
  })

  it('addRule отказывает, если raw не разбирается как правило', () => {
    const text = 'rules:\n  - MATCH,DIRECT\n'
    const md = parseMihomo(text)
    expect(addRule(md, 'непонятно-что-это')).toEqual([])
  })
})

describe('Раунд 3, находка 1: сериализатор не должен переносить длинные строки', () => {
  it('переброс кабеля с длинного правила на другую группу даёт разбираемый документ', () => {
    const text = mihomoFixture('simple')
    const md = parseMihomo(text)
    // индекс 4 — самая длинная строка правила в фикстуре (OR c четырьмя условиями)
    expect(rulesOf(md)[4]!.rule?.target).toBe('♻️ БезVPN')
    const out = applyEdits(text, setRuleTarget(md, 4, '⚡️ Fastest'))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(rulesOf(parsed)[4]!.rule?.target).toBe('⚡️ Fastest')
  })

  it('переименование ♻️ БезVPN в имя с пробелом на simple.yaml больше не отказывает ложно', () => {
    const text = mihomoFixture('simple')
    const md = parseMihomo(text)
    const edits = renameGroup(md, '♻️ БезVPN', '♻️ Без ВПН')
    // до фикса постусловие отказывало: превью не разбиралось из-за переноса строки
    expect(edits.length).toBeGreaterThan(0)
    const out = applyEdits(text, edits)
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(out).not.toContain('♻️ БезVPN')
  })
})

describe('Раунд 3, находка 2: обход не переписывает то, что ссылкой не является', () => {
  it('переименование не трогает filter соседней группы, совпавший по значению с именем', () => {
    const text = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      '  - name: Sel',
      '    type: select',
      '    filter: G',
      'rules:',
      '  - MATCH,DIRECT',
      '',
    ].join('\n')
    const out = edit(text, (md) => renameGroup(md, 'G', 'G2'))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(out).toContain('name: G2')
    expect(out).toContain('filter: G\n')
    expect(out).not.toContain('filter: G2')
  })

  it('переименование не трогает exclude-filter', () => {
    const text = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      '  - name: Sel',
      '    type: select',
      '    exclude-filter: G',
      'rules:',
      '  - MATCH,DIRECT',
      '',
    ].join('\n')
    const out = edit(text, (md) => renameGroup(md, 'G', 'G2'))
    // именно эта пара условий и различает «нашли и починили» от «ничего не сделали»
    expect(out).toContain('name: G2')
    expect(out).toContain('exclude-filter: G\n')
  })

  it('переименование не трогает name другой сущности (прокси), совпавшее по значению', () => {
    const text = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      'proxies:',
      '  - name: G',
      '    type: vmess',
      '    server: 1.2.3.4',
      'rules:',
      '  - MATCH,DIRECT',
      '',
    ].join('\n')
    const out = edit(text, (md) => renameGroup(md, 'G', 'G2'))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    // объявление группы переименовано, а вот имя прокси — другая сущность, не трогаем
    expect(out).toContain('proxy-groups:\n  - name: G2')
    expect(out).toContain('proxies:\n  - name: G\n')
  })

  it('переименование не трогает значения hosts, совпавшие по значению', () => {
    const text = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      'hosts:',
      '  somehost.local: G',
      'rules:',
      '  - MATCH,DIRECT',
      '',
    ].join('\n')
    const out = edit(text, (md) => renameGroup(md, 'G', 'G2'))
    expect(out).toContain('name: G2')
    expect(out).toContain('somehost.local: G\n')
  })

  it('SUB-RULE ссылается на подсписок, а не на группу — цель не переименовывается', () => {
    const text = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      'sub-rules:',
      '  G:',
      '    - DOMAIN,a.com,DIRECT',
      'rules:',
      '  - SUB-RULE,(NETWORK,tcp),G',
      '  - MATCH,DIRECT',
      '',
    ].join('\n')
    const md = parseMihomo(text)
    const out = edit(text, (m) => renameGroup(m, 'G', 'G2'))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(out).toContain('name: G2')
    expect(out).toContain('SUB-RULE,(NETWORK,tcp),G\n')
    expect(out).not.toContain('SUB-RULE,(NETWORK,tcp),G2')
    expect(rulesOf(md)[0]!.rule?.type).toBe('SUB-RULE')
  })
})

describe('Раунд 3, находка 3: постусловие ловит правила, до которых обход не достаёт', () => {
  it('правило верхнего уровня, заданное алиасом на список, блокирует переименование целиком', () => {
    const text = [
      'x-anchors:',
      '  base: &base',
      '    - MATCH,G',
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      'rules: *base',
      '',
    ].join('\n')
    const md = parseMihomo(text)
    // обычный обход это правило не видит (алиас), поэтому раньше правка молча
    // проходила бы, оставляя реальный маршрут указывающим на несуществующую группу
    expect(renameGroup(md, 'G', 'G2')).toEqual([])
  })

  it('tunnels в CSV-форме с именем группы последним полем строки блокирует переименование', () => {
    const text = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      'tunnels:',
      '  - tcp,127.0.0.1:7888,G',
      'rules:',
      '  - MATCH,DIRECT',
      '',
    ].join('\n')
    const md = parseMihomo(text)
    expect(renameGroup(md, 'G', 'G2')).toEqual([])
  })
})

describe('Раунд 4, хвост 1: use ссылается на провайдеров, а не на группы', () => {
  it('переименование не трогает use — объявление провайдера остаётся прежним', () => {
    const text = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      '  - name: Sel',
      '    type: select',
      '    use:',
      '      - G',
      'proxy-providers:',
      '  G:',
      '    type: http',
      '    url: https://example.com/list',
      'rules:',
      '  - MATCH,DIRECT',
      '',
    ].join('\n')
    const out = edit(text, (md) => renameGroup(md, 'G', 'G2'))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(out).toContain('name: G2')
    expect(out).toContain('use:\n      - G\n')
    expect(out).toContain('proxy-providers:\n  G:\n')
  })
})

describe('Раунд 4, хвост 2: под dns правится только суффикс после #', () => {
  it('голое значение в nameserver и nameserver-policy не трогается, суффикс — трогается', () => {
    const text = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      'dns:',
      '  nameserver:',
      '    - G',
      '    - https://8.8.8.8/dns-query#G',
      '  nameserver-policy:',
      '    "some.domain": G',
      'rules:',
      '  - MATCH,DIRECT',
      '',
    ].join('\n')
    const out = edit(text, (md) => renameGroup(md, 'G', 'G2'))
    const parsed = parseMihomo(out)
    expect(parsed.issues).toHaveLength(0)
    expect(out).toContain('name: G2')
    // голое значение в nameserver — НЕ ссылка (нет # перед именем), не трогаем
    expect(out).toContain('nameserver:\n    - G\n')
    // суффикс после # — ссылка, чиним
    expect(out).toContain('dns-query#G2')
    expect(out).not.toContain('dns-query#G\n')
    // голое значение в nameserver-policy — тоже не ссылка
    expect(out).toContain('"some.domain": G\n')
  })
})

describe('Раунд 4, хвост 3: перевод строки в значении даёт отказ, а не порчу', () => {
  it('setRuleTarget отказывает, если новая цель содержит перевод строки', () => {
    const text = 'rules:\n  - MATCH,DIRECT\n'
    const md = parseMihomo(text)
    expect(setRuleTarget(md, 0, 'a\nb')).toEqual([])
  })

  it('addRule отказывает, если правило содержит перевод строки', () => {
    const text = 'rules:\n  - MATCH,DIRECT\n'
    const md = parseMihomo(text)
    expect(addRule(md, 'DOMAIN,a.com,a\nb')).toEqual([])
  })

  it('setGroupField (own) отказывает, если значение содержит перевод строки', () => {
    const text = 'proxy-groups:\n  - name: a\n    type: select\n'
    const md = parseMihomo(text)
    expect(setGroupField(md, 0, 'type', 'a\nb')).toEqual([])
  })

  it('setGroupField (absent) отказывает, если значение содержит перевод строки', () => {
    const text = 'proxy-groups:\n  - name: a\n    type: select\n'
    const md = parseMihomo(text)
    expect(setGroupField(md, 0, 'hidden', 'a\nb')).toEqual([])
  })

  it('renameGroup отказывает целиком, если новое имя содержит перевод строки', () => {
    const text = 'proxy-groups:\n  - name: G\n    type: select\nrules:\n  - MATCH,DIRECT\n'
    const md = parseMihomo(text)
    expect(renameGroup(md, 'G', 'a\nb')).toEqual([])
  })
})

describe('renameGroup при дубликате имени', () => {
  it('документ с двумя группами одного имени — операция отказывает целиком', () => {
    // Дубликат имени — допустимое состояние документа (диагностика уже
    // помечает его ошибкой, но документ читается и рисуется). find() по имени
    // переименовал бы первую попавшуюся, вторая осталась бы сиротой без
    // единого способа её переименовать — лучше не делать ничего, чем половину.
    const text =
      'proxy-groups:\n  - name: G\n    type: select\n  - name: G\n    include-all: true\n' +
      'rules:\n  - MATCH,G\n'
    const md = parseMihomo(text)
    expect(renameGroup(md, 'G', 'G2')).toEqual([])
  })

  it('уникальное имя по-прежнему переименовывается', () => {
    const text = 'proxy-groups:\n  - name: G\n    type: select\nrules:\n  - MATCH,G\n'
    const md = parseMihomo(text)
    expect(renameGroup(md, 'G', 'G2').length).toBeGreaterThan(0)
  })
})

// Находка 5 финального ревью: проверка неоднозначности стояла только на ИСХОДНОМ
// имени, а операция молча создавала ту же неоднозначность на стороне ЦЕЛИ. Порча
// не молчаливая (диагностики загораются), но НЕОБРАТИМАЯ редактором: после неё
// `matches.length !== 1` отказывает на любом переименовании обеих групп.
describe('финальное ревью: переименование в занятое имя', () => {
  const TWO = [
    'proxy-groups:',
    '  - name: A',
    '    proxies:',
    '      - DIRECT',
    '  - name: B',
    '    proxies:',
    '      - A',
    'rules:',
    '  - MATCH,A',
    '',
  ].join('\n')

  it('отказывает, если целевое имя уже занято', () => {
    const md = parseMihomo(TWO)
    expect(renameGroup(md, 'A', 'B')).toEqual([])
    // Симметрия с проверкой источника: две группы под одним именем — то самое
    // состояние, из-за которого renameGroup отказывает, и заводить его нельзя
    expect(renameGroup(parseMihomo(TWO), 'B', 'A')).toEqual([])
  })

  it('на свободное имя та же фикстура переименовывается', () => {
    const out = edit(TWO, (md) => renameGroup(md, 'A', 'C'))
    expect(parseMihomo(out).issues).toEqual([])
    const names = groupsOf(parseMihomo(out)).map((g) => g.name)
    expect(names).toEqual(['C', 'B'])
    expect(groupsOf(parseMihomo(out))[1]!.proxies).toEqual(['C'])
    expect(out).toContain('MATCH,C')
  })
})
