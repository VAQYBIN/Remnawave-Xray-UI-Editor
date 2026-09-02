import type { Page } from '@playwright/test'

export const UUID = '11111111-1111-4111-8111-111111111111'

export const CONFIG = {
  log: { loglevel: 'warning' },
  dns: { servers: ['1.1.1.1'] },
  inbounds: [
    {
      tag: 'vless-in',
      port: 443,
      protocol: 'vless',
      settings: { clients: [{ id: 'e2e-client-uuid', email: 'user@test' }], decryption: 'none' },
      streamSettings: { network: 'tcp', security: 'none' },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] },
    },
  ],
  outbounds: [
    { tag: 'direct', protocol: 'freedom', settings: {} },
    { tag: 'block', protocol: 'blackhole', settings: {} },
  ],
  routing: { rules: [{ type: 'field', inboundTag: ['vless-in'], outboundTag: 'direct' }] },
}

export const PROFILE = {
  uuid: UUID,
  viewPosition: 0,
  name: 'E2E Profile',
  config: CONFIG,
  inbounds: [{ uuid: 'i1', tag: 'vless-in', type: 'vless', network: 'tcp', security: 'none', port: 443 }],
  nodes: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

// Каждый тест Playwright получает свежий контекст (чистый localStorage) — черновики не утекают между тестами
export async function mockApi(page: Page) {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { authenticated: true } }))
  await page.route('**/api/squads', (r) => r.fulfill({ json: { squads: [] } }))
  // Срок токена панели: «неизвестен» — статус-бар при этом молчит
  await page.route('**/api/panel/token', (r) =>
    r.fulfill({ json: { expiresAt: null, daysLeft: null, expired: false, expiringSoon: false } }),
  )
  // Обработчики просмотра идут раньше общего '**/api/geo': порядок здесь важен,
  // ранний маршрут Playwright перехватывает запрос первым
  await page.route('**/api/geo/geosite/categories', (r) =>
    r.fulfill({ json: { categories: [{ code: 'GOOGLE', count: 2 }] } }),
  )
  await page.route('**/api/geo/geosite/categories/**', (r) =>
    r.fulfill({
      json: {
        code: 'GOOGLE',
        total: 2,
        offset: 0,
        domains: [
          { type: 'domain', value: 'google.com', attributes: [] },
          { type: 'full', value: 'api.google.com', attributes: ['cn'] },
        ],
      },
    }),
  )
  await page.route('**/api/geo', (r) =>
    r.fulfill({
      json: {
        geosite: { url: 'https://example.test/dlc.dat', present: false },
        geoip: { url: 'https://example.test/geoip.dat', present: false },
      },
    }),
  )
  await page.route('**/api/tools/geo/match', (r) =>
    r.fulfill({ json: { loaded: false, answers: {}, missing: [] } }),
  )
  await page.route('**/api/tools/xray-test', (r) =>
    r.fulfill({ json: { available: false, ok: false, errors: [], warnings: [], injected: [] } }),
  )
  await page.route(`**/api/profiles/${UUID}/inbounds`, (r) => r.fulfill({ json: { inbounds: [] } }))
  await page.route(`**/api/profiles/${UUID}/backups/b1.json`, (r) =>
    r.fulfill({ json: { savedAt: '2026-07-10T10:00:00.000Z', profile: { ...PROFILE, config: CONFIG } } }),
  )
  await page.route(`**/api/profiles/${UUID}/backups`, (r) =>
    r.fulfill({
      json: { backups: [{ file: 'b1.json', savedAt: '2026-07-10T10:00:00.000Z', profileName: 'E2E Profile' }] },
    }),
  )
  await page.route(`**/api/profiles/${UUID}`, (r) => r.fulfill({ json: { profile: PROFILE } }))
  await page.route('**/api/profiles', (r) => r.fulfill({ json: { profiles: [PROFILE] } }))
}
