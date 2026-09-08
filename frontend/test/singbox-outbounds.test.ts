import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import {
  defaultRoute,
  documentGetsPanelServers,
  groupsOf,
  panelFilledTags,
  panelFillsGroup,
} from '../src/entities/singbox/outbounds'
import type { SingboxDoc } from '../src/entities/singbox/types'
import { singboxFixture } from './helpers'

function fixtureDoc(name: 'default' | 'bundle' | 'legacy'): SingboxDoc {
  return parseSingbox(singboxFixture(name)).doc!
}

function doc(json: string): SingboxDoc {
  return parseSingbox(json).doc!
}

describe('подстановка панели в группы', () => {
  it('в selector попадают прокси и urltest, в urltest — только прокси', () => {
    const d = doc(`{"outbounds":[
      {"type":"vless","tag":"srv"},
      {"type":"urltest","tag":"auto","outbounds":[]},
      {"type":"selector","tag":"sel","outbounds":[]},
      {"type":"direct","tag":"direct"}
    ]}`)
    const groups = groupsOf(d)
    const auto = groups.find((g) => g.tag === 'auto')!
    const sel = groups.find((g) => g.tag === 'sel')!
    expect(panelFilledTags(d, auto)).toEqual(['srv'])
    expect(panelFilledTags(d, sel)).toEqual(['srv', 'auto'])
    // direct — не прокси-протокол: панель его в списки не кладёт
    expect(panelFilledTags(d, sel)).not.toContain('direct')
  })

  it('includeProxies: false выключает подстановку для группы', () => {
    const d = doc(`{"outbounds":[
      {"type":"vless","tag":"srv"},
      {"type":"selector","tag":"fixed","outbounds":["srv"],"remnawave":{"includeProxies":false}}
    ]}`)
    const fixed = groupsOf(d)[0]!
    expect(panelFillsGroup(fixed)).toBe(false)
    expect(panelFilledTags(d, fixed)).toEqual([])
  })

  it('документ считается получающим серверы, пока хоть одна группа их ждёт', () => {
    const open = doc(`{"outbounds":[{"type":"selector","tag":"g","outbounds":null}]}`)
    const closed = doc(
      `{"outbounds":[{"type":"selector","tag":"g","outbounds":["direct"],"remnawave":{"includeProxies":false}}]}`,
    )
    expect(documentGetsPanelServers(open)).toBe(true)
    expect(documentGetsPanelServers(closed)).toBe(false)
  })
})

describe('дефолтный маршрут', () => {
  it('final задан — он и есть дефолт', () => {
    const d = doc(`{"outbounds":[{"type":"direct","tag":"d"},{"type":"selector","tag":"g"}],"route":{"final":"g"}}`)
    expect(defaultRoute(d)).toEqual({ tag: 'g', fromFinal: true })
  })

  it('final пуст — ядро берёт ПЕРВЫЙ выход', () => {
    const d = doc(`{"outbounds":[{"type":"direct","tag":"d"},{"type":"selector","tag":"g"}]}`)
    expect(defaultRoute(d)).toEqual({ tag: 'd', fromFinal: false })
  })

  it('выходов нет — дефолта нет', () => {
    expect(defaultRoute(doc('{}'))).toEqual({ tag: undefined, fromFinal: false })
  })

  it('на настоящих шаблонах дефолт разный, и разница только в порядке', () => {
    // Тот самый случай, ради которого дефолт вообще называется вслух:
    // в bundle несовпавший трафик идёт напрямую, в панельном — в прокси
    expect(defaultRoute(fixtureDoc('bundle'))).toEqual({ tag: 'direct', fromFinal: false })
    expect(defaultRoute(fixtureDoc('default'))).toEqual({ tag: '→ Remnawave', fromFinal: false })
  })
})
