import { describe, expect, it } from 'vitest'
import { realityTargetsOf } from '../src/entities/xray'
import type { XrayConfig } from '../src/entities/xray'

function withInbound(inbound: unknown): XrayConfig {
  return { inbounds: [inbound], outbounds: [] } as unknown as XrayConfig
}

describe('realityTargetsOf', () => {
  it('берёт target и serverNames', () => {
    const config = withInbound({
      tag: 'reality-in',
      protocol: 'vless',
      streamSettings: {
        network: 'tcp',
        security: 'reality',
        realitySettings: { target: 'www.microsoft.com:443', serverNames: ['www.microsoft.com'] },
      },
    })
    expect(realityTargetsOf(config)).toEqual([
      {
        inboundTag: 'reality-in',
        target: 'www.microsoft.com:443',
        serverNames: ['www.microsoft.com'],
      },
    ])
  })

  it('понимает устаревшее имя dest', () => {
    const config = withInbound({
      tag: 'a',
      protocol: 'vless',
      streamSettings: { security: 'reality', realitySettings: { dest: 'example.com:443' } },
    })
    expect(realityTargetsOf(config)[0]!.target).toBe('example.com:443')
  })

  it('дописывает порт 443, если его нет', () => {
    const config = withInbound({
      tag: 'a',
      protocol: 'vless',
      streamSettings: { security: 'reality', realitySettings: { target: 'example.com' } },
    })
    expect(realityTargetsOf(config)[0]!.target).toBe('example.com:443')
  })

  it('inbound не на reality пропускается', () => {
    const config = withInbound({
      tag: 'a',
      protocol: 'vless',
      streamSettings: { security: 'tls', realitySettings: { target: 'example.com:443' } },
    })
    expect(realityTargetsOf(config)).toEqual([])
  })

  it('reality без цели пропускается — проверять нечего', () => {
    const config = withInbound({
      tag: 'a',
      protocol: 'vless',
      streamSettings: { security: 'reality', realitySettings: { serverNames: ['a.test'] } },
    })
    expect(realityTargetsOf(config)).toEqual([])
  })

  it('пустой конфиг — пустой список', () => {
    expect(realityTargetsOf({ inbounds: [], outbounds: [] } as unknown as XrayConfig)).toEqual([])
  })
})
