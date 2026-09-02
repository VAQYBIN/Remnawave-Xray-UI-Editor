import { describe, expect, it } from 'vitest'
import { XrayConfigSchema } from '../src/entities/xray/config'
import { buildGraph, COLUMN_X, layoutColumns } from '../src/entities/graph/buildGraph'

const parse = (raw: unknown) => XrayConfigSchema.parse(raw)

const config = parse({
  remnawave: {
    injectHosts: [
      { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy', selectFrom: 'HIDDEN' },
      { selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true },
    ],
  },
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [] },
})

describe('узлы подстановки', () => {
  it('строятся по одному на группу', () => {
    const { nodes } = buildGraph(config)
    const inject = nodes.filter((n) => n.data.kind === 'inject')
    expect(inject.map((n) => n.id)).toEqual(['inj:0', 'inj:1'])
  })

  it('несут подпись селектора, пул и предсказанные теги', () => {
    const { nodes } = buildGraph(config)
    const first = nodes.find((n) => n.id === 'inj:0')!
    expect(first.data).toMatchObject({
      kind: 'inject',
      index: 0,
      selector: 'тег ~ ^RU-',
      selectFrom: 'HIDDEN',
      scheme: 'prefix',
      tags: ['proxy', 'proxy-2', 'proxy-3'],
    })
  })

  it('у группы с тегами от панели список тегов пуст', () => {
    const { nodes } = buildGraph(config)
    expect(nodes.find((n) => n.id === 'inj:1')!.data).toMatchObject({ scheme: 'panel', tags: [] })
  })

  it('без директив узлов подстановки нет', () => {
    const { nodes } = buildGraph(parse({ outbounds: [{ tag: 'direct', protocol: 'freedom' }] }))
    expect(nodes.some((n) => n.data.kind === 'inject')).toBe(false)
  })

  // Инжектируемые outbound'ы панель вставляет в начало массива — на холсте они
  // тоже стоят выше статических, в той же колонке
  it('ложатся в колонку outbound выше статических выходов', () => {
    const placed = layoutColumns(buildGraph(config).nodes)
    const inj0 = placed.find((n) => n.id === 'inj:0')!
    const direct = placed.find((n) => n.id === 'out:direct')!
    expect(inj0.position.x).toBe(COLUMN_X.outbound)
    expect(direct.position.x).toBe(COLUMN_X.outbound)
    expect(inj0.position.y).toBeLessThan(direct.position.y)
  })
})
