import { describe, expect, it } from 'vitest'
import { isPrivateAddress } from '../src/entities/xray'

describe('isPrivateAddress', () => {
  it('приватные диапазоны IPv4', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })

  it('публичные IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '203.0.113.7']) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })

  it('приватные IPv6, в том числе в скобках', () => {
    for (const ip of ['::1', '[::1]', 'fd00::1', 'fc00::1', 'fe80::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false)
  })

  it('локальные имена и суффиксы', () => {
    for (const host of ['localhost', 'LOCALHOST', 'nas.local', 'panel.internal', 'router.lan', 'pi.home.arpa', 'server.local.']) {
      expect(isPrivateAddress(host), host).toBe(true)
    }
  })

  it('обычный домен считается публичным — как и в ядре', () => {
    expect(isPrivateAddress('example.com')).toBe(false)
    expect(isPrivateAddress('vpn.mydomain.net')).toBe(false)
  })

  it('пустая строка не считается приватной', () => {
    expect(isPrivateAddress('')).toBe(false)
    expect(isPrivateAddress('   ')).toBe(false)
  })
})
