import { describe, expect, it } from 'vitest'
import { traceRoute, type GeoAnswers, type XrayConfig } from '../src/entities/xray'

const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }
const target = { address: 'example.com', port: 443, network: 'tcp' } as const

const template = (extra: Record<string, unknown> = {}): XrayConfig =>
  ({
    remnawave: {
      injectHosts: [
        { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy', selectFrom: 'HIDDEN' },
      ],
    },
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [] },
    ...extra,
  }) as unknown as XrayConfig

describe('трассировка шаблона подписки', () => {
  it('дефолтный маршрут уходит в подстановку, а не в первый статический выход', () => {
    const res = traceRoute(template(), target, NO_GEO)
    expect(res.winner?.ruleIndex).toBeNull()
    expect(res.winner?.injected).toMatchObject({ groupIndex: 0, selectFrom: 'HIDDEN' })
    expect(res.winner?.outboundTag).toBe('proxy')
    expect(res.caveats.join(' ')).toContain('в начало массива')
  })

  it('без групп подстановки дефолт прежний — первый статический выход', () => {
    const config = {
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [] },
    } as unknown as XrayConfig
    const res = traceRoute(config, target, NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: null, outboundTag: 'direct', balancerTag: undefined })
  })

  it('победившее правило с предсказанным тегом помечается как подстановка', () => {
    const config = template({
      routing: { rules: [{ type: 'field', domain: ['example.com'], outboundTag: 'proxy-2' }] },
    })
    const res = traceRoute(config, target, NO_GEO)
    expect(res.winner?.ruleIndex).toBe(0)
    expect(res.winner?.injected?.groupIndex).toBe(0)
    expect(res.caveats.join(' ')).toContain('подставит панель')
  })

  it('правило со статическим тегом подстановкой не помечается', () => {
    const config = template({
      routing: { rules: [{ type: 'field', domain: ['example.com'], outboundTag: 'direct' }] },
    })
    expect(traceRoute(config, target, NO_GEO).winner?.injected).toBeUndefined()
  })

  it('кандидаты балансера, которых подставит панель, названы отдельно', () => {
    const config = template({
      routing: {
        rules: [{ type: 'field', domain: ['example.com'], balancerTag: 'bal' }],
        balancers: [{ tag: 'bal', selector: ['proxy'] }],
      },
    })
    const res = traceRoute(config, target, NO_GEO)
    expect(res.winner?.injectedTags).toEqual(['proxy', 'proxy-2', 'proxy-3'])
    expect(res.caveats.join(' ')).toContain('знает только панель')
  })

  it('теги из примечаний хостов: маршрут не выдумывается', () => {
    const config = {
      remnawave: {
        injectHosts: [{ selector: { type: 'tagRegex', pattern: '^RU-' }, useHostRemarkAsTag: true }],
      },
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [] },
    } as unknown as XrayConfig
    const res = traceRoute(config, target, NO_GEO)
    expect(res.winner?.outboundTag).toBeUndefined()
    expect(res.winner?.injected?.groupIndex).toBe(0)
    expect(res.caveats.join(' ')).toContain('предсказать')
  })
})
