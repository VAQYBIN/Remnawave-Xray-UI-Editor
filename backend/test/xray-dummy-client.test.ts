import { describe, expect, it } from 'vitest'
import { DUMMY_UUID, withDummyClients } from '../src/xray/dummyClient.js'

describe('withDummyClients', () => {
  it('подставляет клиента в vless с пустым clients', () => {
    const src = {
      inbounds: [
        { tag: 'vless-in', protocol: 'vless', settings: { clients: [], decryption: 'none' } },
      ],
    }
    const { config, injected } = withDummyClients(src)
    const clients = (config as any).inbounds[0].settings.clients
    expect(clients).toEqual([{ id: DUMMY_UUID, email: 'xray-ui-editor@test' }])
    expect(injected).toEqual(['vless-in'])
  })

  it('не трогает inbound с настоящими пользователями', () => {
    const src = {
      inbounds: [{ tag: 'a', protocol: 'vless', settings: { clients: [{ id: 'real' }] } }],
    }
    const { config, injected } = withDummyClients(src)
    expect((config as any).inbounds[0].settings.clients).toEqual([{ id: 'real' }])
    expect(injected).toEqual([])
  })

  it('в trojan подставляет пароль, а не UUID', () => {
    const { config } = withDummyClients({
      inbounds: [{ tag: 't', protocol: 'trojan', settings: {} }],
    })
    expect((config as any).inbounds[0].settings.clients[0].password).toBeTypeOf('string')
    expect((config as any).inbounds[0].settings.clients[0].id).toBeUndefined()
  })

  it('для shadowsocks-2022 даёт ключ ровно нужной длины', () => {
    const { config } = withDummyClients({
      inbounds: [
        {
          tag: 's',
          protocol: 'shadowsocks',
          settings: { method: '2022-blake3-aes-128-gcm', clients: [] },
        },
      ],
    })
    const password = (config as any).inbounds[0].settings.clients[0].password as string
    expect(Buffer.from(password, 'base64')).toHaveLength(16)
  })

  it('shadowsocks без method получает метод на клиенте', () => {
    const { config } = withDummyClients({
      inbounds: [{ tag: 's', protocol: 'shadowsocks', settings: {} }],
    })
    expect((config as any).inbounds[0].settings.clients[0].method).toBe('chacha20-ietf-poly1305')
  })

  it('одиночный shadowsocks с паролем в settings не трогается', () => {
    const src = {
      inbounds: [
        { tag: 's', protocol: 'shadowsocks', settings: { password: 'p', method: 'aes-128-gcm' } },
      ],
    }
    const { config, injected } = withDummyClients(src)
    expect((config as any).inbounds[0].settings.clients).toBeUndefined()
    expect(injected).toEqual([])
  })

  it('протоколы без пользователей не трогаются', () => {
    const src = {
      inbounds: [{ tag: 'd', protocol: 'dokodemo-door', settings: { address: '1.1.1.1' } }],
    }
    expect(withDummyClients(src).injected).toEqual([])
  })

  it('исходный объект не мутируется', () => {
    const src = { inbounds: [{ tag: 'a', protocol: 'vless', settings: { clients: [] } }] }
    withDummyClients(src)
    expect(src.inbounds[0]!.settings.clients).toEqual([])
  })

  it('не-объект возвращается как есть', () => {
    expect(withDummyClients('нет').config).toBe('нет')
    expect(withDummyClients(null).injected).toEqual([])
  })
})
