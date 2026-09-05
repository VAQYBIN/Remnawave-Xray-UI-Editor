import { describe, expect, it } from 'vitest'
import { connectMihomo, disconnectMihomo, isValidMihomoConnection } from '../src/entities/graph/mihomo/mutations'
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
    const out = applyEdits(base, connectMihomo(md, 'rule:0', 'group:Fast'))
    expect(rulesOf(parseMihomo(out))[0]!.raw).toBe('DOMAIN,a.com,Fast')
  })

  it('добавляет группу в список другой группы', () => {
    const md = parseMihomo(base)
    const out = applyEdits(base, connectMihomo(md, 'group:VPN', 'group:Fast'))
    expect(groupsOf(parseMihomo(out))[0]!.proxies).toEqual(['DIRECT', 'Fast'])
  })

  it('повторное соединение ничего не меняет', () => {
    const md = parseMihomo(base)
    expect(connectMihomo(md, 'group:VPN', 'builtin:DIRECT')).toEqual([])
  })
})

describe('разрыв', () => {
  it('убирает имя из списка группы', () => {
    const md = parseMihomo(base)
    const out = applyEdits(base, disconnectMihomo(md, 'e:group:VPN->builtin:DIRECT'))
    expect(groupsOf(parseMihomo(out))[0]!.proxies).toEqual([])
  })

  it('разрыв ребра правила невозможен — у правила всегда есть цель', () => {
    const md = parseMihomo(base)
    expect(disconnectMihomo(md, 'e:rule:1->group:VPN')).toEqual([])
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
    const edits = disconnectMihomo(md, 'e:group:VPN->builtin:DIRECT')
    expect(edits).toEqual([])
    expect(applyEdits(flowBase, edits)).toBe(flowBase)
  })

  it('соединение на flow-списке: правок нет, документ не изменился', () => {
    const md = parseMihomo(flowBase)
    const edits = connectMihomo(md, 'group:VPN', 'builtin:REJECT')
    expect(edits).toEqual([])
    expect(applyEdits(flowBase, edits)).toBe(flowBase)
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
    const edits = connectMihomo(md, `group:${group.name}`, 'builtin:DIRECT')
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
    const out = applyEdits(emptyBlock, connectMihomo(md, 'group:VPN', 'builtin:DIRECT'))
    expect(groupsOf(parseMihomo(out))[0]!.proxies).toEqual(['DIRECT'])
  })
})
