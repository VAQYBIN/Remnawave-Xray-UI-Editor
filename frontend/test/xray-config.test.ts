import { describe, expect, it } from 'vitest'
import { DnsSchema, LogSchema, RoutingRuleSchema, validateXrayConfig, XrayConfigSchema } from '../src/entities/xray'

const fullConfig = {
  log: { loglevel: 'warning' },
  inbounds: [
    {
      tag: 'vless-in',
      port: 443,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: { network: 'tcp', security: 'reality', realitySettings: { dest: 'x.com:443' } },
    },
  ],
  outbounds: [
    { tag: 'direct', protocol: 'freedom', settings: {} },
    { tag: 'block', protocol: 'blackhole', settings: {} },
    {
      tag: 'warp-out',
      protocol: 'wireguard',
      settings: { secretKey: 'KEY', address: ['172.16.0.2/32'], peers: [{ publicKey: 'PK', endpoint: 'e:2408' }] },
    },
  ],
  routing: {
    rules: [
      { type: 'field', inboundTag: ['vless-in'], domain: ['geosite:openai'], outboundTag: 'warp-out' },
      { type: 'field', protocol: ['bittorrent'], outboundTag: 'block' },
    ],
  },
  dns: { servers: ['1.1.1.1', { address: '8.8.8.8', unknownOpt: true }] },
  policy: { levels: { '0': { handshake: 4 } } },
  unknownSection: { anything: [1, 2, 3] },
}

describe('XrayConfigSchema', () => {
  it('passthrough round-trip: parse возвращает deep-equal объект', () => {
    expect(XrayConfigSchema.parse(fullConfig)).toEqual(fullConfig)
  })
})

describe('validateXrayConfig', () => {
  it('валидный конфиг — ok без ошибок', () => {
    const res = validateXrayConfig(JSON.stringify(fullConfig))
    expect(res.ok).toBe(true)
    expect(res.issues.filter((i) => i.level === 'error')).toHaveLength(0)
    expect(res.config).toEqual(fullConfig)
  })

  it('битый JSON — ошибка на русском', () => {
    const res = validateXrayConfig('{ "inbounds": [ }')
    expect(res.ok).toBe(false)
    expect(res.issues[0]!.level).toBe('error')
    expect(res.issues[0]!.message).toMatch(/Некорректный JSON/)
  })

  it('inbound без tag — ошибка схемы с путём', () => {
    const bad = { ...fullConfig, inbounds: [{ port: 1, protocol: 'vless' }] }
    const res = validateXrayConfig(JSON.stringify(bad))
    expect(res.ok).toBe(false)
    expect(res.issues.some((i) => i.path.startsWith('inbounds.0') && i.level === 'error')).toBe(true)
  })

  it('дубликат тега и висячая ссылка правила — предупреждения', () => {
    const cfg = {
      inbounds: [
        { tag: 'a', port: 1, protocol: 'vless' },
        { tag: 'a', port: 2, protocol: 'trojan' },
      ],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{ type: 'field', outboundTag: 'missing-out' }] },
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(res.ok).toBe(true) // warnings не блокируют
    const w = res.issues.filter((i) => i.level === 'warning')
    expect(w.some((i) => i.message.includes('Дубликат тега'))).toBe(true)
    expect(w.some((i) => i.message.includes('missing-out'))).toBe(true)
  })

  it('дубликат outbound-тега и висячий inboundTag — предупреждения', () => {
    const cfg = {
      inbounds: [{ tag: 'a', port: 1, protocol: 'vless' }],
      outbounds: [
        { tag: 'direct', protocol: 'freedom' },
        { tag: 'direct', protocol: 'blackhole' },
      ],
      routing: { rules: [{ type: 'field', inboundTag: ['missing-in'], outboundTag: 'direct' }] },
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    const w = res.issues.filter((i) => i.level === 'warning')
    expect(w.some((i) => i.message.includes('Дубликат тега outbound «direct»'))).toBe(true)
    expect(w.some((i) => i.message.includes('missing-in'))).toBe(true)
  })

  it('повторяющийся порт inbound — предупреждение', () => {
    const cfg = {
      inbounds: [
        { tag: 'a', port: 443, protocol: 'vless' },
        { tag: 'b', port: 443, protocol: 'trojan' },
      ],
      outbounds: [],
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(res.issues.some((i) => i.level === 'warning' && i.message.includes('443'))).toBe(true)
  })
})

describe('RoutingRuleSchema — source', () => {
  it('парсит source как массив строк', () => {
    const parsed = RoutingRuleSchema.parse({ type: 'field', source: ['192.168.0.0/24'], outboundTag: 'direct' })
    expect(parsed.source).toEqual(['192.168.0.0/24'])
  })
})

describe('DnsSchema', () => {
  it('servers: строки и объекты вперемешку', () => {
    const parsed = DnsSchema.parse({
      servers: [
        '8.8.8.8',
        { address: '1.1.1.1', port: 53, domains: ['geosite:openai'], expectIPs: ['geoip:us'], skipFallback: true },
      ],
      hosts: { 'example.com': '1.2.3.4', 'multi.example.com': ['1.2.3.4', '5.6.7.8'] },
      queryStrategy: 'UseIPv4',
      tag: 'dns-inbound',
    })
    expect(parsed.servers?.[0]).toBe('8.8.8.8')
    expect(typeof parsed.servers?.[1]).toBe('object')
    expect(parsed.queryStrategy).toBe('UseIPv4')
  })

  it('servers не-массивом — ошибка', () => {
    expect(DnsSchema.safeParse({ servers: '8.8.8.8' }).success).toBe(false)
  })
})

describe('LogSchema', () => {
  it('парсит loglevel/access/error/dnsLog', () => {
    const parsed = LogSchema.parse({ loglevel: 'warning', access: 'none', error: '/var/log/xray.log', dnsLog: true })
    expect(parsed.loglevel).toBe('warning')
    expect(parsed.dnsLog).toBe(true)
  })
})

describe('XrayConfigSchema — dns и log типизированы', () => {
  it('битый dns.servers ловится на уровне конфига', () => {
    const res = XrayConfigSchema.safeParse({ dns: { servers: 'nope' } })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues[0].path.join('.')).toBe('dns.servers')
    }
  })
})

describe('analyzeIntegrity — матрица совместимости (план 4)', () => {
  it('reality поверх ws у inbound — ошибка', () => {
    const cfg = {
      inbounds: [
        { tag: 'a', port: 443, protocol: 'vless', streamSettings: { network: 'ws', security: 'reality' } },
      ],
      outbounds: [],
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(
      res.issues.some(
        (i) => i.level === 'error' && i.path === 'inbounds.0.streamSettings' && i.message.includes('Reality несовместим'),
      ),
    ).toBe(true)
  })

  it('reality поверх ws у outbound — ошибка', () => {
    const cfg = {
      inbounds: [],
      outbounds: [
        { tag: 'chain', protocol: 'vless', streamSettings: { network: 'ws', security: 'reality' } },
      ],
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(res.issues.some((i) => i.level === 'error' && i.path === 'outbounds.0.streamSettings')).toBe(true)
  })

  it('flow vision поверх ws (settings.flow) — ошибка', () => {
    const cfg = {
      inbounds: [
        {
          tag: 'a',
          port: 443,
          protocol: 'vless',
          settings: { clients: [], decryption: 'none', flow: 'xtls-rprx-vision' },
          streamSettings: { network: 'ws', security: 'tls' },
        },
      ],
      outbounds: [],
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(res.issues.some((i) => i.level === 'error' && i.path === 'inbounds.0.settings.flow')).toBe(true)
  })

  it('flow у outbound vless (vnext) поверх grpc — ошибка', () => {
    const cfg = {
      inbounds: [],
      outbounds: [
        {
          tag: 'chain',
          protocol: 'vless',
          settings: { vnext: [{ address: 'a', port: 443, users: [{ id: 'u', flow: 'xtls-rprx-vision' }] }] },
          streamSettings: { network: 'grpc', security: 'reality' },
        },
      ],
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(
      res.issues.some((i) => i.level === 'error' && i.path === 'outbounds.0.settings.vnext.0.users.0.flow'),
    ).toBe(true)
  })

  it('hysteria с tls без сертификатов — ошибка; с сертификатом — нет', () => {
    const mk = (tlsSettings: unknown) => ({
      inbounds: [
        { tag: 'h', port: 443, protocol: 'hysteria', streamSettings: { network: 'hysteria', security: 'tls', tlsSettings } },
      ],
      outbounds: [],
    })
    const bad = validateXrayConfig(JSON.stringify(mk({})))
    expect(bad.issues.some((i) => i.level === 'error' && i.message.includes('сертификат'))).toBe(true)
    const good = validateXrayConfig(JSON.stringify(mk({ certificates: [{ certificateFile: '/c', keyFile: '/k' }] })))
    expect(good.issues.filter((i) => i.level === 'error')).toHaveLength(0)
  })

  it('совместимые комбинации не дают ошибок (reality+grpc, vision+tcp)', () => {
    const cfg = {
      inbounds: [
        {
          tag: 'a',
          port: 443,
          protocol: 'vless',
          settings: { clients: [], decryption: 'none', flow: 'xtls-rprx-vision' },
          streamSettings: { network: 'tcp', security: 'reality', realitySettings: {} },
        },
        { tag: 'b', port: 444, protocol: 'trojan', streamSettings: { network: 'grpc', security: 'reality' } },
      ],
      outbounds: [],
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(res.issues.filter((i) => i.level === 'error')).toHaveLength(0)
  })
})

describe('analyzeIntegrity — ссылки и правила (план 4)', () => {
  it('dialerProxy на несуществующий тег — предупреждение; на существующий — нет', () => {
    const mk = (dialerProxy: string) => ({
      inbounds: [],
      outbounds: [
        { tag: 'proxy', protocol: 'vless', streamSettings: { network: 'tcp', sockopt: { dialerProxy } } },
        { tag: 'warp', protocol: 'wireguard' },
      ],
    })
    const bad = validateXrayConfig(JSON.stringify(mk('ghost')))
    expect(
      bad.issues.some(
        (i) =>
          i.level === 'warning' &&
          i.path === 'outbounds.0.streamSettings.sockopt.dialerProxy' &&
          i.message.includes('ghost'),
      ),
    ).toBe(true)
    const good = validateXrayConfig(JSON.stringify(mk('warp')))
    expect(good.issues).toHaveLength(0)
  })

  it('balancerTag: на несуществующий — предупреждение, на существующий — нет', () => {
    const mk = (balancers: unknown[]) => ({
      inbounds: [],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { balancers, rules: [{ type: 'field', balancerTag: 'lb' }] },
    })
    const bad = validateXrayConfig(JSON.stringify(mk([])))
    expect(bad.issues.some((i) => i.level === 'warning' && i.path === 'routing.rules.0.balancerTag')).toBe(true)
    const good = validateXrayConfig(JSON.stringify(mk([{ tag: 'lb', selector: ['direct'] }])))
    expect(good.issues).toHaveLength(0)
  })

  it('домен без префикса — предупреждение с перечислением', () => {
    const cfg = {
      inbounds: [],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{ type: 'field', domain: ['geosite:openai', 'example', 'raw-sub'], outboundTag: 'direct' }] },
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    const w = res.issues.find((i) => i.path === 'routing.rules.0.domain')
    expect(w?.level).toBe('warning')
    expect(w?.message).toContain('example')
    expect(w?.message).toContain('raw-sub')
    expect(w?.message).not.toContain('geosite:openai')
  })

  it('битый порт правила — ошибка; корректный список — нет', () => {
    const mk = (port: string) => ({
      inbounds: [],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{ type: 'field', port, outboundTag: 'direct' }] },
    })
    const bad = validateXrayConfig(JSON.stringify(mk('70000')))
    expect(bad.issues.some((i) => i.level === 'error' && i.path === 'routing.rules.0.port')).toBe(true)
    const src = validateXrayConfig(
      JSON.stringify({
        inbounds: [],
        outbounds: [{ tag: 'direct', protocol: 'freedom' }],
        routing: { rules: [{ type: 'field', sourcePort: 'abc', outboundTag: 'direct' }] },
      }),
    )
    expect(src.issues.some((i) => i.level === 'error' && i.path === 'routing.rules.0.sourcePort')).toBe(true)
    const good = validateXrayConfig(JSON.stringify(mk('443,1000-2000')))
    expect(good.issues.filter((i) => i.level === 'error')).toHaveLength(0)
  })
})
