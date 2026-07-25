import { describe, expect, it, vi } from 'vitest'
import { fetchExternal, isPrivateAddress } from '../src/net/guard.js'

describe('isPrivateAddress', () => {
  it('loopback, приватные и link-local диапазоны IPv4 закрыты', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('10.1.2.3')).toBe(true)
    expect(isPrivateAddress('172.16.0.1')).toBe(true)
    expect(isPrivateAddress('172.31.255.255')).toBe(true)
    expect(isPrivateAddress('192.168.1.1')).toBe(true)
    // Облачные метаданные — главная цель SSRF
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
    expect(isPrivateAddress('0.0.0.0')).toBe(true)
    expect(isPrivateAddress('100.64.0.1')).toBe(true)
    expect(isPrivateAddress('224.0.0.1')).toBe(true)
  })

  it('соседние публичные адреса не задеты', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('172.15.0.1')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false)
    expect(isPrivateAddress('192.167.1.1')).toBe(false)
    expect(isPrivateAddress('140.82.121.4')).toBe(false)
  })

  it('IPv6: loopback, ULA, link-local и multicast закрыты', () => {
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('::')).toBe(true)
    expect(isPrivateAddress('fc00::1')).toBe(true)
    expect(isPrivateAddress('fd12:3456::1')).toBe(true)
    expect(isPrivateAddress('fe80::1')).toBe(true)
    expect(isPrivateAddress('ff02::1')).toBe(true)
    expect(isPrivateAddress('2606:4700::1111')).toBe(false)
  })

  it('IPv4-mapped адрес проверяется как IPv4 — иначе обход через ::ffff:127.0.0.1', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false)
  })

  it('неразбираемый адрес считаем небезопасным', () => {
    expect(isPrivateAddress('не-адрес')).toBe(true)
  })
})

const PUBLIC_LOOKUP = async () => [{ address: '140.82.121.4' }]
const PRIVATE_LOOKUP = async () => [{ address: '127.0.0.1' }]

function okFetch(body = 'data') {
  return vi.fn(async () => new Response(body, { status: 200 }))
}

describe('fetchExternal', () => {
  it('публичный хост скачивается', async () => {
    const fetchImpl = okFetch()
    const res = await fetchExternal('https://example.test/f.dat', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookupImpl: PUBLIC_LOOKUP,
    })
    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('приватный адрес отклоняется до запроса', async () => {
    const fetchImpl = okFetch()
    await expect(
      fetchExternal('http://localhost/f.dat', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        lookupImpl: PRIVATE_LOOKUP,
      }),
    ).rejects.toThrow(/внутренн/i)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allowPrivate разрешает внутреннее зеркало осознанно', async () => {
    const fetchImpl = okFetch()
    const res = await fetchExternal('http://mirror.local/f.dat', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookupImpl: PRIVATE_LOOKUP,
      allowPrivate: true,
    })
    expect(res.status).toBe(200)
  })

  it('если хоть один адрес хоста приватный — отказ (DNS может вернуть несколько)', async () => {
    const fetchImpl = okFetch()
    await expect(
      fetchExternal('https://evil.test/f.dat', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        lookupImpl: async () => [{ address: '140.82.121.4' }, { address: '169.254.169.254' }],
      }),
    ).rejects.toThrow(/внутренн/i)
  })

  it('редирект проходится вручную и каждый хоп проверяется', async () => {
    // GitHub releases всегда редиректит на CDN — редиректы обязаны работать
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://cdn.test/f.dat' } }),
      )
      .mockResolvedValueOnce(new Response('data', { status: 200 }))
    const res = await fetchExternal('https://example.test/f.dat', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookupImpl: PUBLIC_LOOKUP,
    })
    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    // redirect: 'manual' — иначе fetch пройдёт хоп сам, без проверки адреса
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).redirect).toBe('manual')
  })

  it('редирект на приватный адрес отклоняется — классический обход проверки', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }),
      )
      .mockResolvedValueOnce(new Response('secrets', { status: 200 }))
    let call = 0
    await expect(
      fetchExternal('https://example.test/f.dat', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        lookupImpl: async () => [{ address: call++ === 0 ? '140.82.121.4' : '169.254.169.254' }],
      }),
    ).rejects.toThrow(/внутренн/i)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('цепочка редиректов ограничена', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://loop.test/f.dat' } }),
    )
    await expect(
      fetchExternal('https://example.test/f.dat', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        lookupImpl: PUBLIC_LOOKUP,
      }),
    ).rejects.toThrow(/редирект/i)
  })

  it('редирект без Location — ошибка, а не бесконечное ожидание', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302 }))
    await expect(
      fetchExternal('https://example.test/f.dat', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        lookupImpl: PUBLIC_LOOKUP,
      }),
    ).rejects.toThrow(/Location/i)
  })

  it('нехттп-схема отклоняется', async () => {
    await expect(
      fetchExternal('file:///etc/passwd', {
        fetchImpl: okFetch() as unknown as typeof fetch,
        lookupImpl: PUBLIC_LOOKUP,
      }),
    ).rejects.toThrow(/http/i)
  })
})
