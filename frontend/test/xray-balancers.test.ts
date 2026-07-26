import { describe, expect, it } from 'vitest'
import {
  balancerCandidates, expandSelector, findBalancer, matchPrefixes,
} from '../src/entities/xray/balancers'
import { ensureObservatorySection, subjectCovers } from '../src/entities/xray/observatory'
import { validateXrayConfig } from '../src/entities/xray/config'

const base = () => ({
  outbounds: [
    { tag: 'proxy-de', protocol: 'vless' },
    { tag: 'proxy-nl', protocol: 'vless' },
    { tag: 'direct', protocol: 'freedom' },
  ],
  routing: {
    rules: [],
    balancers: [{ tag: 'bal-eu', selector: ['proxy-'], strategy: { type: 'leastPing' } }],
  },
})

describe('balancers', () => {
  it('matchPrefixes выбирает теги по префиксу, а не по подстроке', () => {
    expect(matchPrefixes(['proxy-de', 'proxy-nl', 'direct', 'my-proxy-x'], ['proxy-'])).toEqual([
      'proxy-de',
      'proxy-nl',
    ])
  })

  it('пустой и отсутствующий selector не дают кандидатов', () => {
    expect(matchPrefixes(['a', 'b'], [])).toEqual([])
    expect(matchPrefixes(['a', 'b'], undefined)).toEqual([])
  })

  it('balancerCandidates считает кандидатов по конфигу', () => {
    const cfg = base()
    expect(balancerCandidates(cfg, cfg.routing.balancers[0]!)).toEqual(['proxy-de', 'proxy-nl'])
    expect(balancerCandidates(cfg, { tag: 'x', selector: ['proxy-de'] })).toEqual(['proxy-de'])
  })

  it('findBalancer ищет по тегу', () => {
    expect(findBalancer(base(), 'bal-eu')?.selector).toEqual(['proxy-'])
    expect(findBalancer(base(), 'нет')).toBeUndefined()
  })

  it('expandSelector разворачивает префикс в точные теги без выброшенного', () => {
    const cfg = base()
    const next = expandSelector(cfg, 'bal-eu', 'proxy-nl')
    expect(next.routing!.balancers![0]!.selector).toEqual(['proxy-de'])
    expect(cfg.routing.balancers[0]!.selector).toEqual(['proxy-']) // вход не мутирован
  })

  it('expandSelector на неизвестном балансере возвращает тот же конфиг', () => {
    const cfg = base()
    expect(expandSelector(cfg, 'нет', 'proxy-nl')).toBe(cfg)
  })

  it('subjectCovers работает по префиксу', () => {
    expect(subjectCovers(['proxy-'], 'proxy-de')).toBe(true)
    expect(subjectCovers(['proxy-de'], 'proxy-nl')).toBe(false)
    expect(subjectCovers(undefined, 'proxy-de')).toBe(false)
  })

  it('ensureObservatorySection создаёт секцию и дополняет subjectSelector, не затирая чужое', () => {
    const created = ensureObservatorySection(base(), 'observatory', ['proxy-de'])
    expect(created.observatory).toEqual({ subjectSelector: ['proxy-de'] })

    const extended = ensureObservatorySection(
      { ...base(), burstObservatory: { subjectSelector: ['other'], pingConfig: { interval: '1m' } } },
      'burst',
      ['proxy-de', 'other'],
    )
    expect(extended.burstObservatory).toEqual({
      subjectSelector: ['other', 'proxy-de'],
      pingConfig: { interval: '1m' },
    })
  })

  it('ensureObservatorySection ничего не делает, когда всё уже покрыто', () => {
    const cfg = { ...base(), observatory: { subjectSelector: ['proxy-'] } }
    expect(ensureObservatorySection(cfg, 'observatory', ['proxy-de'])).toBe(cfg)
  })

  it('схема принимает балансер и обсерваторию и не теряет чужие поля', () => {
    const text = JSON.stringify({
      outbounds: [{ tag: 'proxy-de', protocol: 'vless' }],
      routing: {
        balancers: [
          {
            tag: 'bal',
            selector: ['proxy-'],
            fallbackTag: 'proxy-de',
            strategy: { type: 'leastLoad', settings: { expected: 2 } },
            futureField: 1,
          },
        ],
      },
      observatory: { subjectSelector: ['proxy-'], probeUrl: 'https://x/generate_204', unknown: true },
      burstObservatory: { subjectSelector: ['proxy-'], pingConfig: { interval: '1m', sampling: 10 } },
    })
    const res = validateXrayConfig(text)
    expect(res.ok).toBe(true)
    expect(res.config).toEqual(JSON.parse(text))
  })

  it('незнакомая стратегия не рушит разбор конфига', () => {
    const text = JSON.stringify({
      outbounds: [{ tag: 'proxy-de', protocol: 'vless' }],
      routing: {
        balancers: [{ tag: 'bal', selector: ['proxy-'], strategy: { type: 'futureStrategy' } }],
      },
    })
    expect(validateXrayConfig(text).ok).toBe(true)
  })
})
