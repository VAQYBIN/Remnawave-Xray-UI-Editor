import { describe, expect, it } from 'vitest'
import { connectMihomo, disconnectMihomo, isValidMihomoConnection } from '../src/entities/graph/mihomo/mutations'
import { applyEdits } from '../src/entities/mihomo/edits'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { rulesOf } from '../src/entities/mihomo/rules'
import { groupsOf } from '../src/entities/mihomo/groups'

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
