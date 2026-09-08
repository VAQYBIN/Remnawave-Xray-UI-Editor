import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import type { SingboxDoc, SingboxOutbound } from '../src/entities/singbox/types'
import {
  addRule,
  connectSingbox,
  disconnectSingbox,
  isValidSingboxConnection,
  moveRule,
  outboundByTag,
  removeAt,
  singboxRefusalText,
  withOutboundAt,
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

  it('правило переезжает вверх и вниз, а на границе отказывает', () => {
    const down = moveRule(BASE, 0, 1)
    expect(down.doc!.route!.rules![1]!.domain).toBe('a.com')
    expect(moveRule(BASE, 0, -1).refusal).toBe('not-found')
  })

  it('замена элемента переживает переименование тега', () => {
    // Ищем по ПРЕЖНЕМУ тегу: форма вправе его сменить, и поиск по новому не
    // нашёл бы ничего, молча потеряв правку
    const next = withOutboundAt(BASE, 'ss', { type: 'shadowsocks', tag: 'ss-2', server: '1.2.3.4' })
    expect(next.outbounds![3]!.tag).toBe('ss-2')
    expect(next.outbounds).toHaveLength(4)
  })

  it('удаляются и правило, и выход', () => {
    expect(removeAt(BASE, 'rule:1').doc!.route!.rules).toHaveLength(1)
    expect(removeAt(BASE, 'out:ss').doc!.outbounds).toHaveLength(3)
    expect(removeAt(BASE, 'hosts:panel').refusal).toBe('panel-hosts-edge')
  })

  it('конечная точка удаляется и читается тем же узлом, что и выход', () => {
    // Граф рисует `endpoints` карточкой `out:<tag>` наравне с `outbounds`.
    // Отвечать «не найдено» про узел, который пользователь видит на холсте,
    // значит объяснять отказ несуществующей причиной
    const withEndpoint = doc(`{
      "outbounds": [{"type":"direct","tag":"direct"}],
      "endpoints": [{"type":"wireguard","tag":"wg","address":["10.0.0.2/32"]}]
    }`)
    const after = removeAt(withEndpoint, 'out:wg')
    expect(after.refusal).toBeUndefined()
    expect(after.doc!.endpoints).toHaveLength(0)
    expect(after.doc!.outbounds).toHaveLength(1)
    expect(outboundByTag(withEndpoint, 'wg')?.type).toBe('wireguard')
    // Писатель обязан видеть ровно то же, что читатель: иначе форма на карточке
    // конечной точки принимала бы правку и молча возвращала прежний документ
    const renamed = withOutboundAt(withEndpoint, 'wg', {
      type: 'wireguard',
      tag: 'wg-2',
    } as SingboxOutbound)
    expect(renamed.endpoints![0]!.tag).toBe('wg-2')
  })
})
