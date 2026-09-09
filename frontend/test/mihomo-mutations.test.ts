import { describe, expect, it } from 'vitest'
import {
  connectMihomo,
  disconnectMihomo,
  isValidMihomoConnection,
  refusalText,
} from '../src/entities/graph/mihomo/mutations'
import { buildMihomoGraph } from '../src/entities/graph/mihomo/buildGraph'
import { applyMihomoOps } from '../src/entities/mihomo/write'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { rulesOf } from '../src/entities/mihomo/rules'
import { groupsOf } from '../src/entities/mihomo/groups'

const base =
  'proxy-groups:\n  - name: VPN\n    proxies:\n      - DIRECT\n  - name: Fast\n    include-all: true\n' +
  'rules:\n  - DOMAIN,a.com,DIRECT\n  - MATCH,VPN\n'

// Тот же документ с подсписком правил: у него есть и ребро правила в подсписок
// (`e:rule:0->subrule:block`), и обычное ребро группы
const subBase =
  'proxy-groups:\n  - name: VPN\n    proxies:\n      - DIRECT\n' +
  'sub-rules:\n  block:\n    - MATCH,REJECT\n' +
  'rules:\n  - SUB-RULE,(NETWORK,udp),block\n'

// Группа, получающая хосты от панели (`include-all`) и держащая обычную
// запись в `proxies`: на одной фикстуре есть и ребро в узел подстановки, и
// разрываемое ребро группы
const hostsBase = 'proxy-groups:\n  - name: VPN\n    include-all: true\n    proxies:\n      - DIRECT\n'

describe('допустимость соединений', () => {
  it('правило ведёт в группу, провайдера, сервер и встроенное имя', () => {
    expect(isValidMihomoConnection('rule:0', 'group:VPN')).toBe(true)
    expect(isValidMihomoConnection('rule:0', 'provider:ru')).toBe(true)
    expect(isValidMihomoConnection('rule:0', 'proxy:s')).toBe(true)
    expect(isValidMihomoConnection('rule:0', 'builtin:DIRECT')).toBe(true)
  })

  it('в правило и в узел подстановки кабель не входит', () => {
    expect(isValidMihomoConnection('group:VPN', 'rule:0')).toBe(false)
    expect(isValidMihomoConnection('hosts:VPN', 'group:VPN')).toBe(false)
    expect(isValidMihomoConnection('group:VPN', 'hosts:VPN')).toBe(false)
  })

  it('группа ведёт в группу и в сервер', () => {
    expect(isValidMihomoConnection('group:VPN', 'group:Fast')).toBe(true)
    expect(isValidMihomoConnection('group:VPN', 'proxy:s')).toBe(true)
  })

  it('подсписок не коммутируется кабелем ни как источник, ни как цель', () => {
    expect(isValidMihomoConnection('subrule:block', 'group:VPN')).toBe(false)
    expect(isValidMihomoConnection('rule:0', 'subrule:block')).toBe(false)
    expect(isValidMihomoConnection('group:VPN', 'subrule:block')).toBe(false)
  })

  it('SUB-RULE не коммутируется как обычное правило', () => {
    expect(isValidMihomoConnection('rule:0', 'group:VPN', 'SUB-RULE')).toBe(false)
    expect(isValidMihomoConnection('rule:1', 'group:VPN')).toBe(true)
    expect(isValidMihomoConnection('rule:1', 'group:VPN', 'DOMAIN')).toBe(true)
  })
})

describe('соединение', () => {
  it('кабель правило → сервер меняет цель правила одной операцией set', () => {
    const md = parseMihomo('proxies:\n  - name: s\n    type: direct\nrules:\n  - DOMAIN,a.com,DIRECT\n')
    expect(connectMihomo(md, 'rule:0', 'proxy:s')).toEqual({
      ops: [{ op: 'set', path: ['rules', 0], value: 'DOMAIN,a.com,s' }],
    })
  })

  it('перенаправляет правило в группу и правка применяется писателем', () => {
    const md = parseMihomo(base)
    const res = connectMihomo(md, 'rule:0', 'group:Fast')
    const { md: next } = applyMihomoOps(md, res.ops)
    expect(rulesOf(next)[0]!.raw).toBe('DOMAIN,a.com,Fast')
  })

  it('кабель группа → группа дописывает участника; flow-список больше не отказ', () => {
    const md = parseMihomo(
      'proxy-groups:\n  - name: A\n    type: select\n    proxies: []\n  - name: B\n    type: select\n',
    )
    expect(connectMihomo(md, 'group:A', 'group:B')).toEqual({
      ops: [{ op: 'insert', path: ['proxy-groups', 0, 'proxies'], index: 0, value: 'B' }],
    })
    expect(connectMihomo(md, 'group:B', 'group:A')).toEqual({
      ops: [{ op: 'insert', path: ['proxy-groups', 1, 'proxies'], index: 0, value: 'A' }],
    })
  })

  it('группа без ключа proxies вообще получает его через операцию insert', () => {
    // Прежний `no-proxies-key` больше не существует: операция создаёт
    // недостающие звенья пути сама (это и есть «режим модели заводит ключи»)
    const md = parseMihomo(['proxy-groups:', '  - name: A', '    type: select', ''].join('\n'))
    const res = connectMihomo(md, 'group:A', 'builtin:REJECT')
    expect(res.refusal).toBeUndefined()
    const { md: next } = applyMihomoOps(md, res.ops)
    expect(groupsOf(next)[0]!.proxies).toEqual(['REJECT'])
  })

  it('повторное соединение ничего не меняет', () => {
    const md = parseMihomo(base)
    expect(connectMihomo(md, 'group:VPN', 'builtin:DIRECT').ops).toEqual([])
    expect(connectMihomo(md, 'group:VPN', 'builtin:DIRECT').refusal).toBe('already-connected')
  })

  it('из узла подстановки кабель не тянется', () => {
    const md = parseMihomo('proxy-groups:\n  - name: A\n')
    expect(connectMihomo(md, 'hosts:root', 'group:A').refusal).toBe('invalid-pair')
  })
})

describe('разрыв', () => {
  it('убирает имя из списка группы одной операцией remove', () => {
    const md = parseMihomo(base)
    const res = disconnectMihomo(md, 'e:group:VPN->builtin:DIRECT')
    expect(res).toEqual({ ops: [{ op: 'remove', path: ['proxy-groups', 0, 'proxies', 0] }] })
    const { md: next } = applyMihomoOps(md, res.ops)
    expect(groupsOf(next)[0]!.proxies).toEqual([])
  })

  it('разрыв ребра правила невозможен — у правила всегда есть цель', () => {
    const md = parseMihomo(base)
    const res = disconnectMihomo(md, 'e:rule:1->group:VPN')
    expect(res.ops).toEqual([])
    // Причина обязана называть НАСТОЯЩЕЕ основание, а не узел подстановки,
    // которого в этом ребре нет вовсе.
    expect(res.refusal).toBe('rule-target-required')
    expect(refusalText(res.refusal!)).toMatch(/цель обязательна/)
  })

  it('разрыв ребра подсписка отказывает по тому же основанию, что и у правила', () => {
    const md = parseMihomo(subBase)
    const res = disconnectMihomo(md, 'e:subrule:block->builtin:REJECT')
    expect(res.ops).toEqual([])
    expect(res.refusal).toBe('rule-target-required')
  })

  it('разрыв ребра SUB-RULE → подсписок объясняется тем же, а не узлом подстановки', () => {
    const md = parseMihomo(subBase)
    const res = disconnectMihomo(md, 'e:rule:0->subrule:block')
    expect(res.ops).toEqual([])
    expect(res.refusal).toBe('rule-target-required')
    expect(refusalText(res.refusal!)).not.toMatch(/подстановк/)
  })

  it('разрыв связи с узлом подстановки — панель дописывает хосты сама, разрывать нечего', () => {
    const md = parseMihomo(hostsBase)
    // Сначала убеждаемся, что такое ребро в графе ВООБЩЕ бывает: иначе тест
    // проверял бы id, которого никто не создаёт
    expect(buildMihomoGraph(md).edges.map((e) => e.id)).toContain('e:group:VPN->hosts:VPN')

    const res = disconnectMihomo(md, 'e:group:VPN->hosts:VPN')
    expect(res.ops).toEqual([])
    expect(res.refusal).toBe('panel-hosts-edge')
    const text = refusalText(res.refusal!)
    expect(text).toMatch(/создаёт панель/)
    expect(text).toMatch(/разрывать нечего/)
    expect(text).toMatch(/include-proxies/)
    // Маркер декоративен — текст про него не говорит вовсе
    expect(text).not.toMatch(/LEAVE THIS LINE/)
  })

  it('на той же фикстуре с узлом подстановки обычное ребро группы разрывается', () => {
    const md = parseMihomo(hostsBase)
    const res = disconnectMihomo(md, 'e:group:VPN->builtin:DIRECT')
    expect(res.refusal).toBeUndefined()
    const { md: next } = applyMihomoOps(md, res.ops)
    expect(groupsOf(next)[0]!.proxies).toEqual([])
  })

  it('разрыв ребра, которого нет в списке', () => {
    const md = parseMihomo(
      ['proxy-groups:', '  - name: A', '    proxies:', '      - DIRECT', ''].join('\n'),
    )
    expect(disconnectMihomo(md, 'e:group:A->builtin:REJECT').refusal).toBe('not-found')
  })

  // Ревью находка: `group.proxies` (из `groups.ts`) строится через `toJSON` и
  // отбрасывает элементы, которые не разобрались строкой (число без кавычек и
  // т.п.) — индекс в этом урезанном списке смещён относительно документа.
  // `proxies: [123, DIRECT]` даёт `group.proxies === ['DIRECT']`, и наивный
  // `indexOf('DIRECT')` вернул бы 0, а не настоящий индекс 1 — `remove` стёр
  // бы число, а не DIRECT.
  it('число без кавычек перед участником не сбивает индекс удаления', () => {
    const text = ['proxy-groups:', '  - name: A', '    proxies: [123, DIRECT]', ''].join('\n')
    const md = parseMihomo(text)
    const res = disconnectMihomo(md, 'e:group:A->builtin:DIRECT')
    expect(res.refusal).toBeUndefined()
    expect(res.ops).toEqual([{ op: 'remove', path: ['proxy-groups', 0, 'proxies', 1] }])
    const { md: next } = applyMihomoOps(md, res.ops)
    expect(next.text).not.toContain('DIRECT')
    expect(next.text).toContain('123')
  })
})

// Комбинированный тест из брифа задачи: алиас, слияние, «не список», SUB-RULE
// как источник, «уже соединены», подстановка панели, обязательная цель
// правила и успешный разрыв — на одной фикстуре, шесть разных отказов.
describe('коммутация объясняет отказ', () => {
  const md = parseMihomo(
    [
      'x:',
      '  l: &l',
      '    - DIRECT',
      '  m: &m',
      '    proxies: [DIRECT]',
      'proxy-groups:',
      '  - name: A',
      '    type: select',
      '    proxies: *l',
      '  - name: B',
      '    type: select',
      '    <<: *m',
      '  - name: C',
      '    type: select',
      '    proxies: oops',
      '  - name: D',
      '    type: select',
      '    proxies: [DIRECT]',
      'rules:',
      '  - SUB-RULE,(NETWORK,tcp),sub',
      '',
    ].join('\n'),
  )

  it('список задан ссылкой на якорь', () => {
    expect(connectMihomo(md, 'group:A', 'builtin:REJECT').refusal).toBe('alias-list')
  })

  it('список пришёл через слияние', () => {
    expect(connectMihomo(md, 'group:B', 'builtin:REJECT').refusal).toBe('merged-list')
  })

  it('под ключом proxies не список', () => {
    expect(connectMihomo(md, 'group:C', 'builtin:REJECT').refusal).toBe('proxies-not-a-list')
  })

  it('имя уже в списке', () => {
    expect(connectMihomo(md, 'group:D', 'builtin:DIRECT').refusal).toBe('already-connected')
  })

  it('SUB-RULE не может быть источником обычной коммутации', () => {
    expect(connectMihomo(md, 'rule:0', 'group:A').refusal).toBe('sub-rule-source')
  })

  it('связь с узлом подстановки не разрывается', () => {
    expect(disconnectMihomo(md, 'e:group:D->hosts:D').refusal).toBe('panel-hosts-edge')
  })

  it('связь правила не разрывается — только смена цели', () => {
    expect(disconnectMihomo(md, 'e:rule:0->subrule:sub').refusal).toBe('rule-target-required')
  })

  it('обычная связь группы D разрывается успешно', () => {
    expect(disconnectMihomo(md, 'e:group:D->builtin:DIRECT')).toEqual({
      ops: [{ op: 'remove', path: ['proxy-groups', 3, 'proxies', 0] }],
    })
  })
})
