import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { withDummyOutbounds } from '../src/singbox/dummyOutbounds.js'

type Doc = {
  outbounds: { type: string; tag: string; outbounds?: string[]; remnawave?: unknown }[]
}

function fixture(name: 'default' | 'bundle' | 'legacy'): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/singbox/${name}.json`, import.meta.url), 'utf8'),
  )
}

describe('достройка sing-box перед проверкой ядром', () => {
  it('дописывает серверы в конец и заполняет ими группы', () => {
    const doc = withDummyOutbounds(fixture('default')) as Doc
    const selector = doc.outbounds.find((o) => o.type === 'selector')!
    const dummies = doc.outbounds.filter((o) => o.type === 'shadowsocks').map((o) => o.tag)
    expect(dummies.length).toBeGreaterThan(0)
    // Порядок значим: панель дописывает серверы В КОНЕЦ, и от позиции зависит,
    // какой выход станет дефолтным при пустом route.final
    expect(doc.outbounds.at(-1)!.tag).toBe(dummies.at(-1))
    expect(selector.outbounds).toEqual(expect.arrayContaining(dummies))
  })

  it('селектор получает и теги urltest-групп, а urltest — только прокси', () => {
    const doc = withDummyOutbounds(fixture('bundle')) as Doc
    const selector = doc.outbounds.find((o) => o.type === 'selector')!
    const urltest = doc.outbounds.find((o) => o.type === 'urltest')!
    expect(selector.outbounds).toContain(urltest.tag)
    expect(urltest.outbounds).not.toContain(urltest.tag)
  })

  it('группу с includeProxies: false не трогает', () => {
    const doc = withDummyOutbounds({
      outbounds: [
        { type: 'direct', tag: 'direct' },
        {
          type: 'selector',
          tag: 'fixed',
          outbounds: ['direct'],
          remnawave: { includeProxies: false },
        },
      ],
    }) as Doc
    const fixed = doc.outbounds.find((o) => o.tag === 'fixed')!
    expect(fixed.outbounds).toEqual(['direct'])
  })

  it('вырезает ключ remnawave: ядро строго к незнакомым полям', () => {
    const doc = withDummyOutbounds({
      outbounds: [
        { type: 'selector', tag: 'g', outbounds: [], remnawave: { includeProxies: false } },
      ],
    }) as Doc
    expect(doc.outbounds[0]!.remnawave).toBeUndefined()
    expect(JSON.stringify(doc)).not.toContain('remnawave')
  })

  it('вход не мутируется', () => {
    const input = { outbounds: [{ type: 'selector', tag: 'g', outbounds: null }] }
    const before = JSON.stringify(input)
    withDummyOutbounds(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('документ без outbounds не роняет достройку', () => {
    const doc = withDummyOutbounds({ route: { rules: [] } }) as Doc
    expect(Array.isArray(doc.outbounds)).toBe(true)
  })
})
