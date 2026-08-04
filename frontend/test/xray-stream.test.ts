import { describe, expect, it } from 'vitest'
import { RealitySettingsSchema, SniffingSchema, StreamSettingsSchema, TlsSettingsSchema } from '../src/entities/xray'

describe('TlsSettingsSchema', () => {
  it('парсит полный tlsSettings из документации и сохраняет неизвестные поля', () => {
    const input = {
      serverName: 'example.com',
      rejectUnknownSni: false,
      alpn: ['h2', 'http/1.1'],
      minVersion: '1.2',
      maxVersion: '1.3',
      fingerprint: 'chrome',
      certificates: [{ certificateFile: '/etc/ssl/cert.pem', keyFile: '/etc/ssl/key.pem' }],
      echServerKeys: 'abc',
    }
    const parsed = TlsSettingsSchema.parse(input)
    expect(parsed.maxVersion).toBe('1.3')
    expect(parsed.rejectUnknownSni).toBe(false)
    expect(parsed.certificates?.[0]?.certificateFile).toBe('/etc/ssl/cert.pem')
    expect((parsed as Record<string, unknown>).echServerKeys).toBe('abc')
  })

  it('inline-сертификат (certificate/key массивами строк) парсится', () => {
    const parsed = TlsSettingsSchema.parse({
      certificates: [{ certificate: ['-----BEGIN CERTIFICATE-----'], key: ['-----BEGIN KEY-----'], usage: 'encipherment' }],
    })
    expect(parsed.certificates?.[0]?.certificate).toEqual(['-----BEGIN CERTIFICATE-----'])
  })

  it('certificates не-массивом — ошибка', () => {
    expect(TlsSettingsSchema.safeParse({ certificates: 'nope' }).success).toBe(false)
  })
})

describe('RealitySettingsSchema', () => {
  it('парсит клиентские поля outbound-Reality', () => {
    const parsed = RealitySettingsSchema.parse({
      serverName: 'example.com',
      fingerprint: 'chrome',
      shortId: 'ab12',
      password: 'PUBKEY_BASE64URL',
      spiderX: '/',
    })
    expect(parsed.serverName).toBe('example.com')
    expect(parsed.shortId).toBe('ab12')
    expect(parsed.password).toBe('PUBKEY_BASE64URL')
  })

  it('знает minClientVer и maxClientVer', () => {
    const parsed = RealitySettingsSchema.parse({ minClientVer: '0.0.0', maxClientVer: '99.0.0' })
    expect(parsed.minClientVer).toBe('0.0.0')
    expect(parsed.maxClientVer).toBe('99.0.0')
  })
})

describe('SniffingSchema', () => {
  it('парсит metadataOnly', () => {
    expect(SniffingSchema.parse({ enabled: true, metadataOnly: false }).metadataOnly).toBe(false)
  })
})

describe('StreamSettingsSchema — транспорты', () => {
  it('ws: headers как record строк, heartbeatPeriod', () => {
    const parsed = StreamSettingsSchema.parse({
      network: 'ws',
      wsSettings: { path: '/ws?ed=2560', host: 'cdn.example.com', headers: { 'X-A': 'b' }, heartbeatPeriod: 10 },
    })
    expect(parsed.wsSettings?.heartbeatPeriod).toBe(10)
    expect(parsed.wsSettings?.headers?.['X-A']).toBe('b')
  })

  it('grpc: authority и multiMode', () => {
    const parsed = StreamSettingsSchema.parse({
      network: 'grpc',
      grpcSettings: { serviceName: 'svc', authority: 'a.example.com', multiMode: true },
    })
    expect(parsed.grpcSettings?.authority).toBe('a.example.com')
  })

  it('xhttp: path/host/mode типизированы, extra сохраняется', () => {
    const parsed = StreamSettingsSchema.parse({
      network: 'xhttp',
      xhttpSettings: { path: '/api', host: 'front.example.com', mode: 'packet-up', extra: { xmux: { maxConcurrency: '16-32' } } },
    })
    expect(parsed.xhttpSettings?.mode).toBe('packet-up')
    expect(parsed.xhttpSettings?.extra).toBeDefined()
  })

  it('rawSettings принимается наравне с tcpSettings', () => {
    const parsed = StreamSettingsSchema.parse({
      network: 'raw',
      rawSettings: { acceptProxyProtocol: true },
    })
    expect(parsed.rawSettings?.acceptProxyProtocol).toBe(true)
  })

  it('hysteria-транспорт с finalmask.quicParams', () => {
    const parsed = StreamSettingsSchema.parse({
      network: 'hysteria',
      security: 'tls',
      hysteriaSettings: { version: 2, up: '100mbps', down: '300mbps', masquerade: { type: 'file', dir: '/var/www' } },
      finalmask: { quicParams: { congestion: 'brutal', brutalUp: 100, brutalDown: 300 } },
    })
    expect(parsed.hysteriaSettings?.version).toBe(2)
    expect(parsed.finalmask?.quicParams?.congestion).toBe('brutal')
  })

  it('sockopt: dialerProxy строкой, tcpFastOpen bool или number', () => {
    const a = StreamSettingsSchema.parse({ sockopt: { dialerProxy: 'warp', tcpFastOpen: true } })
    const b = StreamSettingsSchema.parse({ sockopt: { tcpFastOpen: 256, mark: 255 } })
    expect(a.sockopt?.dialerProxy).toBe('warp')
    expect(b.sockopt?.tcpFastOpen).toBe(256)
    expect(StreamSettingsSchema.safeParse({ sockopt: { tcpFastOpen: 'yes' } }).success).toBe(false)
  })
})
