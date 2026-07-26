import { describe, expect, it } from 'vitest'
import { BALANCE_DEFAULTS, planBalance, validateBalance } from '../src/entities/xray/recipes/balance'
import type { XrayConfig } from '../src/entities/xray'

const base = () =>
  ({
    outbounds: [
      { tag: 'proxy-de', protocol: 'vless' },
      { tag: 'proxy-nl', protocol: 'vless' },
      { tag: 'direct', protocol: 'freedom' },
    ],
    routing: { rules: [{ domain: ['example.com'], outboundTag: 'proxy-de' }] },
  }) as XrayConfig

const params = {
  ...BALANCE_DEFAULTS,
  tag: 'bal-eu',
  members: ['proxy-de', 'proxy-nl'],
  strategy: 'leastPing' as const,
  fallbackTag: 'direct',
  repoint: true,
}

describe('рецепт «Балансировка»', () => {
  it('создаёт балансер с точными тегами и обсерваторию', () => {
    const plan = planBalance(base(), params)
    expect(plan.config.routing!.balancers).toEqual([
      {
        tag: 'bal-eu',
        selector: ['proxy-de', 'proxy-nl'],
        fallbackTag: 'direct',
        strategy: { type: 'leastPing' },
      },
    ])
    expect(plan.config.observatory).toEqual({ subjectSelector: ['proxy-de', 'proxy-nl'] })
  })

  it('переводит правила выбранных выходов на балансер', () => {
    const plan = planBalance(base(), params)
    expect(plan.config.routing!.rules![0]).toEqual({ domain: ['example.com'], balancerTag: 'bal-eu' })
  })

  it('без repoint правила не трогает', () => {
    const plan = planBalance(base(), { ...params, repoint: false })
    expect(plan.config.routing!.rules![0]).toEqual({ domain: ['example.com'], outboundTag: 'proxy-de' })
  })

  it('идемпотентен: повторное применение ничего не добавляет', () => {
    const once = planBalance(base(), params).config
    const twice = planBalance(once, params)
    expect(twice.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(twice.config).toEqual(once)
  })

  it('не мутирует вход', () => {
    const cfg = base()
    planBalance(cfg, params)
    expect(cfg.routing!.rules![0]).toEqual({ domain: ['example.com'], outboundTag: 'proxy-de' })
    expect(cfg.routing!.balancers).toBeUndefined()
  })

  it('валидация ловит короткий список, fallback внутри списка и пустой тег', () => {
    expect(validateBalance({ ...params, members: ['proxy-de'] })).toMatch(/выберите/i)
    expect(validateBalance({ ...params, fallbackTag: 'proxy-de' })).toMatch(/запасной/i)
    expect(validateBalance({ ...params, tag: '' })).toMatch(/тег/i)
    expect(validateBalance(params)).toBeNull()
  })
})
