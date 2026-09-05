import { describe, expect, it } from 'vitest'
import { analyzeIntegrity, XrayConfigSchema } from '../src/entities/xray/config'
import { predictedTags } from '../src/entities/xray/inject'
import {
  addInjectGroup,
  attachInjectGroupToBalancer,
  setRuleInjectGroup,
} from '../src/entities/graph/mutations'

const parse = (raw: unknown) => XrayConfigSchema.parse(raw)

const base = parse({
  remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [{}], balancers: [{ tag: 'bal', selector: [] }] },
})

describe('мутации групп подстановки', () => {
  it('добавляет группу с рабочими значениями по умолчанию', () => {
    const next = addInjectGroup(parse({ outbounds: [] }))
    expect(next.remnawave?.injectHosts).toHaveLength(1)
    expect(next.remnawave?.injectHosts?.[0]).toMatchObject({
      selector: { type: 'sameTagAsRecipient' },
      tagPrefix: 'proxy',
      selectFrom: 'HIDDEN',
    })
  })

  it('вторая группа получает неконфликтующий префикс', () => {
    const next = addInjectGroup(base)
    expect(next.remnawave?.injectHosts?.[1]?.tagPrefix).not.toBe('proxy')
  })

  // Тег proxy-2 панель отдаст ПЕРВОЙ группе (injectedTagOwners), и ребро от
  // правила к новой группе на глазах перескочило бы на соседнюю
  it('вторая группа не берёт тег, уже предсказанный первой', () => {
    const next = addInjectGroup(base)
    const prefix = next.remnawave!.injectHosts![1]!.tagPrefix!
    expect(predictedTags(base.remnawave!.injectHosts![0]!)).not.toContain(prefix)
  })

  it('группа не берёт тег существующего статического outbound’а', () => {
    const withProxy = parse({
      outbounds: [{ tag: 'proxy', protocol: 'freedom' }],
      routing: {},
    })
    const next = addInjectGroup(withProxy)
    expect(next.remnawave?.injectHosts?.[0]?.tagPrefix).not.toBe('proxy')
    expect(analyzeIntegrity(next).filter((i) => i.message.includes('«proxy»'))).toEqual([])
  })

  it('предсказанные теги двух групп после добавления не пересекаются', () => {
    const next = addInjectGroup(base)
    const [first, second] = next.remnawave!.injectHosts!.map((g) => predictedTags(g))
    expect(first!.filter((t) => second!.includes(t))).toEqual([])
  })

  // Префикс proxy-2 порождает proxy-2-2 и proxy-2-3 — и сам он ровно тот тег,
  // которым панель назовёт второй хост соседней группы proxy. Нумерация
  // кандидатов поэтому идёт без дефиса
  it('префикс новой группы не выглядит номерным вариантом соседа', () => {
    let config = base
    for (let n = 0; n < 4; n += 1) config = addInjectGroup(config)
    const prefixes = config.remnawave!.injectHosts!.map((g) => g.tagPrefix!)
    for (const prefix of prefixes) {
      const others = prefixes.filter((p) => p !== prefix)
      expect(others.some((p) => /^-\d+$/.test(prefix.slice(p.length)) && prefix.startsWith(p))).toBe(
        false,
      )
    }
  })

  it('правило цепляется за первый предсказанный тег группы', () => {
    const next = setRuleInjectGroup(base, 0, 0)
    expect(next.routing?.rules?.[0]?.outboundTag).toBe('proxy')
    expect(next.routing?.rules?.[0]?.balancerTag).toBeUndefined()
  })

  it('балансер цепляется за группу префиксом, а не точным тегом', () => {
    const next = attachInjectGroupToBalancer(base, 'bal', 0)
    expect(next.routing?.balancers?.[0]?.selector).toEqual(['proxy'])
  })

  it('повторное соединение ничего не дублирует', () => {
    const once = attachInjectGroupToBalancer(base, 'bal', 0)
    expect(attachInjectGroupToBalancer(once, 'bal', 0)).toBe(once)
  })

  // У группы с тегами от панели цепляться не за что: связь выразить нечем
  it('к группе с тегами от панели связь не создаётся', () => {
    const panelNamed = parse({
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true }] },
      outbounds: [],
      routing: { rules: [{}], balancers: [{ tag: 'bal', selector: [] }] },
    })
    expect(setRuleInjectGroup(panelNamed, 0, 0)).toBe(panelNamed)
    expect(attachInjectGroupToBalancer(panelNamed, 'bal', 0)).toBe(panelNamed)
  })

  // Обе мутации обязаны сверяться с одним и тем же tagScheme, а не повторять
  // предикат «схема prefix» каждая на свой лад — иначе при одновременно заданных
  // tagPrefix и useHostTagAsTag они расходятся в поведении (setRuleInjectGroup
  // шёл через predictedTags и отказывал, а attachInjectGroupToBalancer — нет)
  it('при tagPrefix и useHostTagAsTag сразу обе мутации ведут себя одинаково', () => {
    const ambiguous = parse({
      remnawave: {
        injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy', useHostTagAsTag: true }],
      },
      outbounds: [],
      routing: { rules: [{}], balancers: [{ tag: 'bal', selector: [] }] },
    })
    expect(setRuleInjectGroup(ambiguous, 0, 0)).toBe(ambiguous)
    expect(attachInjectGroupToBalancer(ambiguous, 'bal', 0)).toBe(ambiguous)
  })
})
