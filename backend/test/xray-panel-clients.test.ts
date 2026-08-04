import { describe, expect, it } from 'vitest'
import { DUMMY_UUID } from '../src/xray/dummyClient.js'
import { withPanelClients } from '../src/xray/panelClients.js'

const draft = {
  inbounds: [
    { tag: 'vless-in', protocol: 'vless', settings: { clients: [], decryption: 'none' } },
    { tag: 'new-in', protocol: 'vless', settings: { clients: [], decryption: 'none' } },
  ],
}

describe('withPanelClients', () => {
  it('берёт клиента панели по совпадению тега', () => {
    const computed = {
      inbounds: [
        {
          tag: 'vless-in',
          protocol: 'vless',
          settings: { clients: [{ id: 'real-1', email: 'a@panel', flow: 'xtls-rprx-vision' }] },
        },
      ],
    }
    const { config, injected } = withPanelClients(draft, computed)
    const clients = (config as any).inbounds[0].settings.clients
    expect(clients).toEqual([{ id: 'real-1', email: 'a@panel', flow: 'xtls-rprx-vision' }])
    expect(injected).toContainEqual({ tag: 'vless-in', source: 'panel' })
  })

  // Боевой профиль содержит тысячи пользователей: во временный файл проверки
  // им незачем ехать целиком
  it('берёт ровно одного клиента, даже если панель прислала много', () => {
    const computed = {
      inbounds: [
        {
          tag: 'vless-in',
          protocol: 'vless',
          settings: { clients: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
        },
      ],
    }
    const { config } = withPanelClients(draft, computed)
    expect((config as any).inbounds[0].settings.clients).toEqual([{ id: 'a' }])
  })

  it('inbound без пары в панели получает фиктивного клиента', () => {
    const computed = { inbounds: [{ tag: 'vless-in', protocol: 'vless', settings: { clients: [{ id: 'real-1' }] } }] }
    const { config, injected } = withPanelClients(draft, computed)
    expect((config as any).inbounds[1].settings.clients[0].id).toBe(DUMMY_UUID)
    expect(injected).toContainEqual({ tag: 'new-in', source: 'dummy' })
  })

  it('без computed всё уходит в фиктивных — проверка работает при недоступной панели', () => {
    const { config, injected } = withPanelClients(draft)
    expect((config as any).inbounds[0].settings.clients[0].id).toBe(DUMMY_UUID)
    expect(injected).toEqual([
      { tag: 'vless-in', source: 'dummy' },
      { tag: 'new-in', source: 'dummy' },
    ])
  })

  it('inbound с настоящими пользователями в черновике не трогаем', () => {
    const withReal = { inbounds: [{ tag: 'x', protocol: 'vless', settings: { clients: [{ id: 'mine' }] } }] }
    const computed = { inbounds: [{ tag: 'x', protocol: 'vless', settings: { clients: [{ id: 'panel' }] } }] }
    const { config, injected } = withPanelClients(withReal, computed)
    expect((config as any).inbounds[0].settings.clients).toEqual([{ id: 'mine' }])
    expect(injected).toEqual([])
  })

  it('пустой clients у панели не считается парой', () => {
    const computed = { inbounds: [{ tag: 'vless-in', protocol: 'vless', settings: { clients: [] } }] }
    const { injected } = withPanelClients(draft, computed)
    expect(injected).toEqual([
      { tag: 'vless-in', source: 'dummy' },
      { tag: 'new-in', source: 'dummy' },
    ])
  })

  it('исходный черновик не мутируется', () => {
    const src = { inbounds: [{ tag: 'vless-in', protocol: 'vless', settings: { clients: [] } }] }
    withPanelClients(src, { inbounds: [{ tag: 'vless-in', settings: { clients: [{ id: 'p' }] } }] })
    expect(src.inbounds[0]!.settings.clients).toEqual([])
  })
})
