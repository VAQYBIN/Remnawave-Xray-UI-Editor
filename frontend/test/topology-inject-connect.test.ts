import { describe, expect, it } from 'vitest'
import { XrayConfigSchema } from '../src/entities/xray/config'
import { applyConnection, isValidConnection } from '../src/features/topology/TopologyView'

const parse = (raw: unknown) => XrayConfigSchema.parse(raw)

const config = parse({
  remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [{}], balancers: [{ tag: 'bal', selector: [] }] },
})

describe('коммутация с группами подстановки', () => {
  it('правило и балансер могут вести в группу', () => {
    expect(isValidConnection({ source: 'rule:0', target: 'inj:0' })).toBe(true)
    expect(isValidConnection({ source: 'bal:bal', target: 'inj:0' })).toBe(true)
  })

  // Группа — это выход, в неё нельзя войти из входа и из неё нельзя выйти
  it('прочие пары с группой недопустимы', () => {
    expect(isValidConnection({ source: 'in:vless', target: 'inj:0' })).toBe(false)
    expect(isValidConnection({ source: 'inj:0', target: 'out:direct' })).toBe(false)
    expect(isValidConnection({ source: 'inj:0', target: 'inj:0' })).toBe(false)
  })

  it('протяжка правило → группа ставит предсказанный тег', () => {
    const next = applyConnection(config, { source: 'rule:0', target: 'inj:0' })
    expect(next.routing?.rules?.[0]?.outboundTag).toBe('proxy')
  })

  it('протяжка балансер → группа добавляет префикс в селектор', () => {
    const next = applyConnection(config, { source: 'bal:bal', target: 'inj:0' })
    expect(next.routing?.balancers?.[0]?.selector).toEqual(['proxy'])
  })

  it('недопустимая пара возвращает тот же конфиг', () => {
    expect(applyConnection(config, { source: 'inj:0', target: 'out:direct' })).toBe(config)
  })
})
