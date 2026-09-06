import { describe, expect, it } from 'vitest'
import {
  connectMihomo,
  disconnectMihomo,
  isValidMihomoConnection,
  refusalText,
} from '../src/entities/graph/mihomo/mutations'
import { applyEdits } from '../src/entities/mihomo/edits'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { rulesOf } from '../src/entities/mihomo/rules'
import { groupsOf } from '../src/entities/mihomo/groups'
import { mihomoFixture } from './helpers'

const base =
  'proxy-groups:\n  - name: VPN\n    proxies:\n      - DIRECT\n  - name: Fast\n    include-all: true\n' +
  'rules:\n  - DOMAIN,a.com,DIRECT\n  - MATCH,VPN\n'

describe('допустимость соединений', () => {
  it('правило ведёт в группу, провайдера и встроенное имя', () => {
    expect(isValidMihomoConnection('rule:0', 'group:VPN')).toBe(true)
    expect(isValidMihomoConnection('rule:0', 'provider:ru')).toBe(true)
    expect(isValidMihomoConnection('rule:0', 'builtin:DIRECT')).toBe(true)
  })

  it('в правило и в узел подстановки кабель не входит', () => {
    expect(isValidMihomoConnection('group:VPN', 'rule:0')).toBe(false)
    expect(isValidMihomoConnection('hosts:VPN', 'group:VPN')).toBe(false)
    expect(isValidMihomoConnection('group:VPN', 'hosts:VPN')).toBe(false)
  })

  it('группа ведёт в группу', () => {
    expect(isValidMihomoConnection('group:VPN', 'group:Fast')).toBe(true)
  })
})

describe('соединение', () => {
  it('перенаправляет правило в группу', () => {
    const md = parseMihomo(base)
    const out = applyEdits(base, connectMihomo(md, 'rule:0', 'group:Fast').edits)
    expect(rulesOf(parseMihomo(out))[0]!.raw).toBe('DOMAIN,a.com,Fast')
  })

  it('добавляет группу в список другой группы', () => {
    const md = parseMihomo(base)
    const out = applyEdits(base, connectMihomo(md, 'group:VPN', 'group:Fast').edits)
    expect(groupsOf(parseMihomo(out))[0]!.proxies).toEqual(['DIRECT', 'Fast'])
  })

  it('повторное соединение ничего не меняет', () => {
    const md = parseMihomo(base)
    expect(connectMihomo(md, 'group:VPN', 'builtin:DIRECT').edits).toEqual([])
  })
})

describe('разрыв', () => {
  it('убирает имя из списка группы', () => {
    const md = parseMihomo(base)
    const out = applyEdits(base, disconnectMihomo(md, 'e:group:VPN->builtin:DIRECT').edits)
    expect(groupsOf(parseMihomo(out))[0]!.proxies).toEqual([])
  })

  it('разрыв ребра правила невозможен — у правила всегда есть цель', () => {
    const md = parseMihomo(base)
    const res = disconnectMihomo(md, 'e:rule:1->group:VPN')
    expect(res.edits).toEqual([])
    expect(res.refusal).toBe('invalid-pair')
  })
})

// Список в одну строку (`[DIRECT, Fast]`) — валидный YAML, но правки по диапазону
// одного элемента на такой строке задели бы и ключ, и соседние элементы. Обе
// операции обязаны отказать, а не портить документ.
const flowBase =
  'proxy-groups:\n  - name: VPN\n    proxies: [DIRECT, Fast]\n  - name: Fast\n    include-all: true\n' +
  'rules:\n  - MATCH,VPN\n'

describe('список в одну строку', () => {
  it('разрыв на flow-списке: правок нет, документ не изменился', () => {
    const md = parseMihomo(flowBase)
    const res = disconnectMihomo(md, 'e:group:VPN->builtin:DIRECT')
    expect(res.edits).toEqual([])
    expect(res.refusal).toBe('flow-list')
    expect(applyEdits(flowBase, res.edits)).toBe(flowBase)
  })

  it('соединение на flow-списке: правок нет, документ не изменился', () => {
    const md = parseMihomo(flowBase)
    const res = connectMihomo(md, 'group:VPN', 'builtin:REJECT')
    expect(res.edits).toEqual([])
    expect(res.refusal).toBe('flow-list')
    expect(applyEdits(flowBase, res.edits)).toBe(flowBase)
  })
})

// Пустой блочный список — самый частый случай в живых шаблонах: панель сама
// нальёт хостов в `proxies:` группы подстановки, поэтому у ключа нет элементов,
// а иногда и вовсе нет seq-узла (значение — null). Раньше соединение с такой
// группой молча ничего не делало.
describe('пустой блочный список', () => {
  it('соединение с группой из default.yaml, где proxies содержит только маркер', () => {
    const fixture = mihomoFixture('default')
    const md = parseMihomo(fixture)
    const group = groupsOf(md).find((g) => g.hasMarker)!
    const edits = connectMihomo(md, `group:${group.name}`, 'builtin:DIRECT').edits
    // Чистая вставка (from === to), а не замена — строка ключа с маркером не тронута
    expect(edits).toHaveLength(1)
    expect(edits[0]!.from).toBe(edits[0]!.to)

    const out = applyEdits(fixture, edits)
    const parsedOut = parseMihomo(out)
    const groupOut = groupsOf(parsedOut).find((g) => g.name === group.name)!
    expect(groupOut.proxies).toEqual(['DIRECT'])
    expect(groupOut.hasMarker).toBe(true)

    // Остальные байты документа не тронуты: вырезав ровно вставленный кусок, получаем оригинал
    const edit = edits[0]!
    const withoutInsert = out.slice(0, edit.from) + out.slice(edit.from + edit.insert.length)
    expect(withoutInsert).toBe(fixture)
  })

  it('соединение с группой, у которой блочный список пуст', () => {
    const emptyBlock =
      'proxy-groups:\n  - name: VPN\n    type: select\n    proxies:\n  - name: Fast\n    include-all: true\n' +
      'rules:\n  - MATCH,VPN\n'
    const md = parseMihomo(emptyBlock)
    const out = applyEdits(emptyBlock, connectMihomo(md, 'group:VPN', 'builtin:DIRECT').edits)
    expect(groupsOf(parseMihomo(out))[0]!.proxies).toEqual(['DIRECT'])
  })
})

// Конец файла без завершающего перевода строки — сквозная слабость вставок по
// `indexOf('\n', ...)`: когда его нет, наивная точка вставки — это конец файла,
// но это ещё СЕРЕДИНА последней строки (после неё нет \n), и новый элемент
// приклеивается к ключу/предыдущему элементу на одной строке — невалидный YAML.
// Сравнение только текста такое пропустило бы, поэтому здесь дополнительно
// проверяем, что результат вообще разбирается и без ошибок YAML-парсера.
describe('конец файла без перевода строки', () => {
  it('пустой список, ключ — последняя строка файла', () => {
    const noEol =
      'proxy-groups:\n  - name: Fast\n    include-all: true\n  - name: VPN\n    type: select\n    proxies:'
    const md = parseMihomo(noEol)
    const out = applyEdits(noEol, connectMihomo(md, 'group:VPN', 'builtin:DIRECT').edits)
    const parsedOut = parseMihomo(out)
    expect(parsedOut.issues).toEqual([])
    expect(groupsOf(parsedOut).find((g) => g.name === 'VPN')!.proxies).toEqual(['DIRECT'])
  })

  it('непустой список, последний элемент — последняя строка файла', () => {
    const noEol = 'proxy-groups:\n  - name: VPN\n    proxies:\n      - DIRECT'
    const md = parseMihomo(noEol)
    const out = applyEdits(noEol, connectMihomo(md, 'group:VPN', 'builtin:REJECT').edits)
    const parsedOut = parseMihomo(out)
    expect(parsedOut.issues).toEqual([])
    expect(groupsOf(parsedOut).find((g) => g.name === 'VPN')!.proxies).toEqual(['DIRECT', 'REJECT'])
  })
})

// Находка ревью (раунд 3): `stringify(name)` без `lineWidth: 0` молча переносит
// длинное значение с пробелом на две строки — сплайс вставляет в документ
// разорванный посередине скаляр, YAML перестаёт разбираться без единой
// диагностики. Достижимо обычным действием пользователя: длинное имя группы,
// пришедшее в список `proxies`.
describe('находка 1 (раунд 3): длинное имя не переносится сериализатором', () => {
  const longName = 'Очень длинное имя группы с несколькими пробелами которое обязано остаться в одной строке'

  it('добавление в непустой список — вставка остаётся одной строкой', () => {
    const md = parseMihomo(base)
    const edits = connectMihomo(md, 'group:VPN', `group:${longName}`).edits
    expect(edits).toHaveLength(1)
    // ровно один перевод строки — завершающий; переноса самого значения нет
    expect((edits[0]!.insert.match(/\n/g) ?? []).length).toBe(1)
    const out = applyEdits(base, edits)
    const parsedOut = parseMihomo(out)
    expect(parsedOut.issues).toEqual([])
    expect(groupsOf(parsedOut)[0]!.proxies).toContain(longName)
  })

  it('добавление в пустой список — вставка остаётся одной строкой', () => {
    const emptyBlock =
      'proxy-groups:\n  - name: VPN\n    type: select\n    proxies:\n  - name: Fast\n    include-all: true\n' +
      'rules:\n  - MATCH,VPN\n'
    const md = parseMihomo(emptyBlock)
    const edits = connectMihomo(md, 'group:VPN', `group:${longName}`).edits
    expect(edits).toHaveLength(1)
    expect((edits[0]!.insert.match(/\n/g) ?? []).length).toBe(1)
    const out = applyEdits(emptyBlock, edits)
    const parsedOut = parseMihomo(out)
    expect(parsedOut.issues).toEqual([])
    expect(groupsOf(parsedOut)[0]!.proxies).toEqual([longName])
  })
})

// Находка ревью (раунд 5): в этом модуле те же две точки печати имени, что и
// `scalar()` в `entities/mihomo/edits.ts`, не проверяли результат на перевод
// строки — тот же класс дефекта (раунд 4), просто не долетевший до соседнего
// модуля. Валидный документ («a\nb» — обычный YAML double-quote escape, а не
// испорченный ввод) со значением, содержащим перевод строки, при печати без
// проверки даёт блочный скаляр (`|-`) вместо одной строки — сплайс вставляет
// многострочный кусок туда, где список проксей ждёт ровно одну новую строку.
describe('находка (раунд 5): перевод строки в имени группы даёт отказ, а не порчу', () => {
  const withNewlineName =
    'proxy-groups:\n  - name: VPN\n    proxies:\n      - DIRECT\n  - name: "a\\nb"\n    include-all: true\n' +
    'rules:\n  - MATCH,VPN\n'

  it('документ валиден и группа с таким именем действительно есть', () => {
    expect(parseMihomo(withNewlineName).issues).toEqual([])
    expect(groupsOf(parseMihomo(withNewlineName)).some((g) => g.name === 'a\nb')).toBe(true)
  })

  it('соединение с такой группой отказывает — правок нет, документ не меняется', () => {
    const md = parseMihomo(withNewlineName)
    const res = connectMihomo(md, 'group:VPN', `group:${'a\nb'}`)
    expect(res.edits).toEqual([])
    expect(res.refusal).toBe('unprintable-name')
    expect(applyEdits(withNewlineName, res.edits)).toBe(withNewlineName)
  })

  it('то же самое для ветки с пустым списком proxies', () => {
    const emptyBlock =
      'proxy-groups:\n  - name: VPN\n    type: select\n    proxies:\n  - name: "a\\nb"\n    include-all: true\n' +
      'rules:\n  - MATCH,VPN\n'
    const md = parseMihomo(emptyBlock)
    const res = connectMihomo(md, 'group:VPN', `group:${'a\nb'}`)
    expect(res.edits).toEqual([])
    expect(res.refusal).toBe('unprintable-name')
    expect(applyEdits(emptyBlock, res.edits)).toBe(emptyBlock)
  })
})

// SUB-RULE — третье поле правила это имя подсписка в sub-rules, а не группы:
// перетаскивание кабеля с такого узла на группу дало бы `SUB-RULE,...,VPN`,
// который ядро не примет (уже учтено в validate.ts и edits.ts).
const subRuleBase =
  'proxy-groups:\n  - name: VPN\n    proxies:\n      - DIRECT\n' +
  'sub-rules:\n  ru:\n    - DOMAIN,a.com,DIRECT\n' +
  'rules:\n  - SUB-RULE,(NETWORK,tcp),ru\n  - DOMAIN,b.com,DIRECT\n  - MATCH,VPN\n'

describe('SUB-RULE не коммутируется как обычное правило', () => {
  it('isValidMihomoConnection отказывает, когда передан тип правила SUB-RULE', () => {
    expect(isValidMihomoConnection('rule:0', 'group:VPN', 'SUB-RULE')).toBe(false)
  })

  it('isValidMihomoConnection пропускает обычное правило (тип не задан либо не SUB-RULE)', () => {
    expect(isValidMihomoConnection('rule:1', 'group:VPN')).toBe(true)
    expect(isValidMihomoConnection('rule:1', 'group:VPN', 'DOMAIN')).toBe(true)
  })

  it('connectMihomo не даёт правок при соединении с узла правила SUB-RULE', () => {
    const md = parseMihomo(subRuleBase)
    const res = connectMihomo(md, 'rule:0', 'group:VPN')
    expect(res.edits).toEqual([])
    expect(res.refusal).toBe('sub-rule-source')
    expect(applyEdits(subRuleBase, res.edits)).toBe(subRuleBase)
  })

  it('connectMihomo по-прежнему коммутирует обычное правило', () => {
    const md = parseMihomo(subRuleBase)
    const out = applyEdits(subRuleBase, connectMihomo(md, 'rule:1', 'group:VPN').edits)
    expect(rulesOf(parseMihomo(out))[1]!.raw).toBe('DOMAIN,b.com,VPN')
  })
})

describe('коммутация объясняет отказ', () => {
  it('список в одну строку: правка сломала бы YAML', () => {
    const md = parseMihomo(['proxy-groups:', '  - name: A', '    proxies: [DIRECT]', ''].join('\n'))
    const res = connectMihomo(md, 'group:A', 'builtin:REJECT')
    expect(res.edits).toEqual([])
    expect(res.refusal).toBe('flow-list')
    expect(refusalText(res.refusal!)).toMatch(/одну строку/)
  })

  it('список участников пришёл через слияние: правка задела бы все места якоря', () => {
    const md = parseMihomo(
      [
        'x-anchors:',
        '  base: &base',
        '    proxies:',
        '      - DIRECT',
        'proxy-groups:',
        '  - name: A',
        '    <<: *base',
        '',
      ].join('\n'),
    )
    const res = connectMihomo(md, 'group:A', 'builtin:REJECT')
    expect(res.edits).toEqual([])
    expect(res.refusal).toBe('merged-list')
    expect(refusalText(res.refusal!)).toMatch(/якор/)
  })

  it('ключа proxies нет вовсе — структуру группы не выдумываем', () => {
    const md = parseMihomo(['proxy-groups:', '  - name: A', '    type: select', ''].join('\n'))
    const res = connectMihomo(md, 'group:A', 'builtin:REJECT')
    expect(res.refusal).toBe('no-proxies-key')
  })

  it('имя уже в списке — соединять нечего', () => {
    const md = parseMihomo(
      ['proxy-groups:', '  - name: A', '    proxies:', '      - DIRECT', ''].join('\n'),
    )
    expect(connectMihomo(md, 'group:A', 'builtin:DIRECT').refusal).toBe('already-connected')
  })

  it('из узла подстановки кабель не тянется', () => {
    const md = parseMihomo('proxy-groups:\n  - name: A\n')
    expect(connectMihomo(md, 'hosts:root', 'group:A').refusal).toBe('invalid-pair')
  })

  it('успешная коммутация причины не несёт', () => {
    const md = parseMihomo(
      ['proxy-groups:', '  - name: A', '    proxies:', '      - DIRECT', ''].join('\n'),
    )
    const res = connectMihomo(md, 'group:A', 'builtin:REJECT')
    expect(res.edits).toHaveLength(1)
    expect(res.refusal).toBeUndefined()
  })

  it('разрыв ребра, которого нет в списке', () => {
    const md = parseMihomo(
      ['proxy-groups:', '  - name: A', '    proxies:', '      - DIRECT', ''].join('\n'),
    )
    expect(disconnectMihomo(md, 'e:group:A->builtin:REJECT').refusal).toBe('not-found')
  })

  // Зеркало группового случая (раунд 5, `withNewlineName`): перевод строки в
  // ИМЕНИ ЦЕЛИ правила заставляет `setRuleTarget` печатать всю строку правила
  // как блочный скаляр — вставить его на место одной строки нельзя, ветка
  // отказа обязана быть достижимой и различимой от остальных причин.
  it('соединение правила с целью, чьё имя содержит перевод строки, отказывает как unprintable-rule', () => {
    const md = parseMihomo(['rules:', '  - DOMAIN,a.com,DIRECT', ''].join('\n'))
    const res = connectMihomo(md, 'rule:0', `group:${'a\nb'}`)
    expect(res.edits).toEqual([])
    expect(res.refusal).toBe('unprintable-rule')
  })
})
