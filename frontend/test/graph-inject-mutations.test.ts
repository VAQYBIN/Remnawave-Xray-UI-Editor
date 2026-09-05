import { describe, expect, it } from 'vitest'
import { XrayConfigSchema } from '../src/entities/xray/config'
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
