import { describe, expect, it } from 'vitest'
import { XrayConfigSchema } from '../src/entities/xray/config'
import { buildGraph } from '../src/entities/graph/buildGraph'

const parse = (raw: unknown) => XrayConfigSchema.parse(raw)

describe('рёбра к группам подстановки', () => {
  it('балансер соединяется с группой, чьи теги попали под селектор', () => {
    const config = parse({
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { balancers: [{ tag: 'bal', selector: ['proxy'] }], rules: [] },
    })
    const { edges } = buildGraph(config)
    expect(edges.map((e) => e.id)).toContain('e:bal:bal->inj:0')
    // Ребра к несуществующему узлу out:proxy быть не должно — React Flow его отбросит
    expect(edges.some((e) => e.target === 'out:proxy')).toBe(false)
  })

  it('правило соединяется с группой по предсказанному тегу', () => {
    const config = parse({
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{ outboundTag: 'proxy-2' }] },
    })
    const { edges } = buildGraph(config)
    expect(edges.map((e) => e.id)).toContain('e:rule:0->inj:0')
  })

  it('статические выходы по-прежнему получают свои рёбра', () => {
    const config = parse({
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { balancers: [{ tag: 'bal', selector: ['proxy', 'direct'] }], rules: [{ outboundTag: 'direct' }] },
    })
    const { edges } = buildGraph(config)
    expect(edges.map((e) => e.id)).toContain('e:bal:bal->out:direct')
    expect(edges.map((e) => e.id)).toContain('e:rule:0->out:direct')
  })

  // Теги знает только панель — выводить связи не из чего, и выдумывать нельзя
  it('к группе с тегами от панели рёбер не выводится', () => {
    const config = parse({
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true }] },
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { balancers: [{ tag: 'bal', selector: ['что-угодно'] }], rules: [{ outboundTag: 'нечто' }] },
    })
    const { edges } = buildGraph(config)
    expect(edges.some((e) => e.target.startsWith('inj:'))).toBe(false)
  })

  it('запасной выход балансера на предсказанный тег группы ведёт к её узлу', () => {
    const config = parse({
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { balancers: [{ tag: 'bal', selector: ['direct'], fallbackTag: 'proxy-2' }], rules: [] },
    })
    const { edges } = buildGraph(config)
    expect(edges.map((e) => e.id)).toContain('e:bal:bal->fb:proxy-2')
    expect(edges.find((e) => e.id === 'e:bal:bal->fb:proxy-2')?.target).toBe('inj:0')
  })

  it('запасной выход балансера на несуществующий тег ребра не даёт', () => {
    const config = parse({
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { balancers: [{ tag: 'bal', selector: ['direct'], fallbackTag: 'ghost' }], rules: [] },
    })
    const { edges } = buildGraph(config)
    expect(edges.some((e) => e.id.startsWith('e:bal:bal->fb:'))).toBe(false)
  })
})
