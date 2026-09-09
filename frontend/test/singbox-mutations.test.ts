import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import type { SingboxDoc } from '../src/entities/singbox/types'
import {
  addRule,
  connectSingbox,
  disconnectSingbox,
  isValidSingboxConnection,
  outboundSlot,
  singboxRefusalText,
} from '../src/entities/graph/singbox/mutations'

function doc(json: string): SingboxDoc {
  return parseSingbox(json).doc!
}

const BASE = doc(`{
  "outbounds": [
    {"type":"selector","tag":"free","outbounds":null},
    {"type":"selector","tag":"pinned","outbounds":["direct"],"remnawave":{"includeProxies":false}},
    {"type":"direct","tag":"direct"},
    {"type":"shadowsocks","tag":"ss","server":"1.2.3.4","server_port":443}
  ],
  "route": {"rules":[{"domain":"a.com","outbound":"direct"},{"action":"sniff"}]}
}`)

describe('допустимость коммутации sing-box', () => {
  it('правило и группа тянутся в группу и в выход', () => {
    expect(isValidSingboxConnection('rule:0', 'out:direct')).toBe(true)
    expect(isValidSingboxConnection('rule:0', 'group:free')).toBe(true)
    expect(isValidSingboxConnection('group:pinned', 'out:ss')).toBe(true)
  })

  it('в правило и во вход кабель не входит, из подстановки не выходит', () => {
    expect(isValidSingboxConnection('out:direct', 'rule:0')).toBe(false)
    // Источник здесь допустимый — проверяется именно запрет правила как ЦЕЛИ:
    // порядок правил задаёт список, а не кабель
    expect(isValidSingboxConnection('rule:0', 'rule:1')).toBe(false)
    expect(isValidSingboxConnection('rule:0', 'inbound:tun-in')).toBe(false)
    expect(isValidSingboxConnection('hosts:panel', 'out:direct')).toBe(false)
    expect(isValidSingboxConnection('rule:0', 'hosts:panel')).toBe(false)
  })
})

describe('коммутация sing-box', () => {
  it('правило меняет цель, а не копит их', () => {
    const res = connectSingbox(BASE, 'rule:0', 'group:free')
    expect(res.refusal).toBeUndefined()
    expect(res.doc!.route!.rules![0]!.outbound).toBe('free')
  })

  it('маршрутная цель снимает прежнее действие правила', () => {
    // При заданных сразу action и outbound ядро прочитает action: правило
    // осталось бы отбрасывающим, а кабель на холсте обещал бы маршрут
    const rejecting = doc(`{
      "outbounds": [{"type":"direct","tag":"direct"}],
      "route": {"rules":[{"domain":"a.com","action":"reject"}]}
    }`)
    const res = connectSingbox(rejecting, 'rule:0', 'out:direct')
    expect(res.refusal).toBeUndefined()
    expect(res.doc!.route!.rules![0]!.outbound).toBe('direct')
    expect(res.doc!.route!.rules![0]!.action).toBeUndefined()
  })

  it('повторное соединение — отказ с причиной, а не пустая правка', () => {
    const res = connectSingbox(BASE, 'rule:0', 'out:direct')
    expect(res.doc).toBeUndefined()
    expect(res.refusal).toBe('already-connected')
    expect(singboxRefusalText('already-connected')).toMatch(/уже/i)
  })

  it('в заполняемую панелью группу вручную не дописать', () => {
    // Список затрёт панель: запись в него исчезнет при первой же выдаче
    // подписки, а редактор отчитался бы об успехе
    const res = connectSingbox(BASE, 'group:free', 'out:ss')
    expect(res.doc).toBeUndefined()
    expect(res.refusal).toBe('panel-fills-group')
    expect(singboxRefusalText('panel-fills-group')).toMatch(/includeProxies/)
  })

  it('в закреплённую группу дописать можно', () => {
    const res = connectSingbox(BASE, 'group:pinned', 'out:ss')
    expect(res.refusal).toBeUndefined()
    expect(res.doc!.outbounds![1]!.outbounds).toEqual(['direct', 'ss'])
  })

  it('вход не мутируется', () => {
    // Документ свой, а не общий BASE: на общем правка на месте была бы уже
    // сделана соседним тестом и вернула бы «уже соединено», то есть проверка
    // копии молча превратилась бы в проверку повтора
    const own = doc(`{
      "outbounds": [
        {"type":"selector","tag":"pinned","outbounds":["direct"],"remnawave":{"includeProxies":false}},
        {"type":"direct","tag":"direct"},
        {"type":"shadowsocks","tag":"ss","server":"1.2.3.4"}
      ]
    }`)
    const before = JSON.stringify(own)
    connectSingbox(own, 'group:pinned', 'out:ss')
    expect(JSON.stringify(own)).toBe(before)
  })
})

describe('разрыв связи sing-box', () => {
  it('связь закреплённой группы разрывается', () => {
    const res = disconnectSingbox(BASE, 'e:sbgroup:pinned->out:direct')
    expect(res.doc!.outbounds![1]!.outbounds).toEqual([])
  })

  it('у правила связь не разорвать, только сменить', () => {
    // Правило без выхода — не правило: у ядра ему некуда отправлять трафик
    const res = disconnectSingbox(BASE, 'e:sbrule:0->out:direct')
    expect(res.refusal).toBe('rule-target-required')
  })

  it('связь с узлом подстановки создаёт панель, а не документ', () => {
    const res = disconnectSingbox(BASE, 'e:sbgroup:free->hosts:panel')
    expect(res.refusal).toBe('panel-hosts-edge')
    expect(singboxRefusalText('panel-hosts-edge')).toMatch(/панел/i)
  })
})

describe('правки структуры sing-box', () => {
  it('правило добавляется в конец и в указанную позицию', () => {
    const appended = addRule(BASE, { domain: 'b.com', outbound: 'direct' })
    expect(appended.route!.rules).toHaveLength(3)
    expect(appended.route!.rules![2]!.domain).toBe('b.com')
    const inserted = addRule(BASE, { domain: 'c.com', outbound: 'direct' }, 0)
    expect(inserted.route!.rules![0]!.domain).toBe('c.com')
  })
})

describe('outboundSlot различает списки', () => {
  it('outbounds и endpoints — общий узел на холсте, разные списки в документе', () => {
    const base = parseSingbox(`{
      "outbounds": [{"type":"direct","tag":"d"}],
      "endpoints": [{"type":"wireguard","tag":"w"}]
    }`).doc!
    expect(outboundSlot(base, 'w')).toEqual({ key: 'endpoints', at: 0 })
    expect(outboundSlot(base, 'd')).toEqual({ key: 'outbounds', at: 0 })
    expect(outboundSlot(base, 'zz')).toBeNull()
  })
})
