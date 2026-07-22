import { describe, expect, it } from 'vitest'
import {
  allowedNetworks,
  allowedSecurities,
  flowNetworkIssue,
  hysteriaCertificateIssue,
  normalizeNetwork,
  securityNetworkIssue,
} from '../src/entities/xray'

describe('normalizeNetwork', () => {
  it('raw → tcp, отсутствие → tcp, остальное как есть', () => {
    expect(normalizeNetwork('raw')).toBe('tcp')
    expect(normalizeNetwork(undefined)).toBe('tcp')
    expect(normalizeNetwork('ws')).toBe('ws')
  })
})

describe('allowedNetworks', () => {
  it('reality — только tcp/xhttp/grpc', () => {
    expect(allowedNetworks('reality')).toEqual(['tcp', 'xhttp', 'grpc'])
  })

  it('tls и none — все транспорты', () => {
    expect(allowedNetworks('tls')).toContain('hysteria')
    expect(allowedNetworks('none')).toContain('ws')
    expect(allowedNetworks(undefined)).toContain('httpupgrade')
  })
})

describe('allowedSecurities', () => {
  it('hysteria — только tls', () => {
    expect(allowedSecurities('hysteria')).toEqual(['tls'])
  })

  it('ws и httpupgrade — без reality', () => {
    expect(allowedSecurities('ws')).toEqual(['none', 'tls'])
    expect(allowedSecurities('httpupgrade')).toEqual(['none', 'tls'])
  })

  it('tcp, raw, grpc, xhttp — все три', () => {
    expect(allowedSecurities('tcp')).toEqual(['none', 'tls', 'reality'])
    expect(allowedSecurities('raw')).toEqual(['none', 'tls', 'reality'])
    expect(allowedSecurities('grpc')).toEqual(['none', 'tls', 'reality'])
    expect(allowedSecurities('xhttp')).toEqual(['none', 'tls', 'reality'])
  })
})

describe('securityNetworkIssue', () => {
  it('совместимые пары — null', () => {
    expect(securityNetworkIssue('reality', 'tcp')).toBeNull()
    expect(securityNetworkIssue('reality', 'raw')).toBeNull()
    expect(securityNetworkIssue('reality', 'grpc')).toBeNull()
    expect(securityNetworkIssue('reality', 'xhttp')).toBeNull()
    expect(securityNetworkIssue('tls', 'ws')).toBeNull()
    expect(securityNetworkIssue(undefined, 'ws')).toBeNull()
  })

  it('reality поверх ws/httpupgrade/hysteria — русское сообщение', () => {
    expect(securityNetworkIssue('reality', 'ws')).toMatch(/Reality несовместим/)
    expect(securityNetworkIssue('reality', 'httpupgrade')).toMatch(/Reality несовместим/)
    expect(securityNetworkIssue('reality', 'hysteria')).toMatch(/Reality несовместим/)
  })

  it('hysteria без tls — сообщение; с tls — null', () => {
    expect(securityNetworkIssue('none', 'hysteria')).toMatch(/hysteria требует/)
    expect(securityNetworkIssue(undefined, 'hysteria')).toMatch(/hysteria требует/)
    expect(securityNetworkIssue('tls', 'hysteria')).toBeNull()
  })
})

describe('flowNetworkIssue', () => {
  it('vision поверх raw/tcp — ок; поверх остальных — сообщение', () => {
    expect(flowNetworkIssue('xtls-rprx-vision', 'tcp')).toBeNull()
    expect(flowNetworkIssue('xtls-rprx-vision', 'raw')).toBeNull()
    expect(flowNetworkIssue('xtls-rprx-vision', 'ws')).toMatch(/только поверх raw/)
    expect(flowNetworkIssue('xtls-rprx-vision-udp443', 'grpc')).toMatch(/только поверх raw/)
  })

  it('без flow — всегда null', () => {
    expect(flowNetworkIssue(undefined, 'ws')).toBeNull()
    expect(flowNetworkIssue('', 'ws')).toBeNull()
  })
})

describe('hysteriaCertificateIssue', () => {
  it('hysteria + tls без certificates — сообщение', () => {
    expect(hysteriaCertificateIssue('hysteria', 'tls', {})).toMatch(/сертификат/)
    expect(hysteriaCertificateIssue('hysteria', 'tls', undefined)).toMatch(/сертификат/)
    expect(hysteriaCertificateIssue('hysteria', 'tls', { certificates: [] })).toMatch(/сертификат/)
  })

  it('с certificates — null; не-hysteria и не-tls — null (покрыто securityNetworkIssue)', () => {
    expect(hysteriaCertificateIssue('hysteria', 'tls', { certificates: [{}] })).toBeNull()
    expect(hysteriaCertificateIssue('tcp', 'tls', {})).toBeNull()
    expect(hysteriaCertificateIssue('hysteria', 'none', {})).toBeNull()
  })
})
