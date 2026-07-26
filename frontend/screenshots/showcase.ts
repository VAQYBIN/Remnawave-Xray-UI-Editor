import type { Page } from '@playwright/test'
import { mockApi } from '../e2e/mocks'

/**
 * Витринный конфиг для скриншотов README. Минимальный CONFIG из e2e/mocks.ts
 * для съёмки не годится: один inbound, два outbound и одно правило дают почти
 * пустой граф. Здесь заполнены все пять колонок, и конфиг обязан давать НОЛЬ
 * диагностик — значок проблемы на герой-кадре читается как «продукт сломан».
 *
 * Все адреса, ключи и идентификаторы вымышленные.
 */
export const SHOWCASE_UUID = '22222222-2222-4222-8222-222222222222'

const CONFIG = {
  log: { loglevel: 'warning' },
  dns: { servers: ['1.1.1.1', '8.8.8.8'] },
  inbounds: [
    {
      tag: 'vless-reality',
      port: 443,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none', flow: 'xtls-rprx-vision' },
      streamSettings: {
        network: 'raw',
        security: 'reality',
        realitySettings: {
          dest: 'www.cloudflare.com:443',
          serverNames: ['www.cloudflare.com'],
          privateKey: 'wJPbBTQmXqLKgOSzWq3LRYLnCoRqLdYcOJhLm3PbXGM',
          shortIds: ['6ba85179e30d4fc2'],
        },
      },
      sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
    },
    {
      tag: 'trojan-ws',
      port: 8443,
      protocol: 'trojan',
      settings: { clients: [] },
      streamSettings: {
        network: 'ws',
        security: 'tls',
        wsSettings: { path: '/ws' },
        tlsSettings: { serverName: 'node.example.com', alpn: ['h2', 'http/1.1'] },
      },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] },
    },
    {
      tag: 'hysteria2',
      port: 2096,
      protocol: 'hysteria2',
      settings: { clients: [] },
      streamSettings: {
        network: 'hysteria',
        security: 'tls',
        tlsSettings: {
          serverName: 'node.example.com',
          certificates: [{ certificateFile: '/etc/ssl/node.crt', keyFile: '/etc/ssl/node.key' }],
        },
        hysteriaSettings: { version: 2, up: '100 mbps', down: '200 mbps' },
      },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] },
    },
  ],
  outbounds: [
    { tag: 'direct', protocol: 'freedom', settings: {} },
    { tag: 'block', protocol: 'blackhole', settings: {} },
    {
      tag: 'warp',
      protocol: 'wireguard',
      settings: {
        secretKey: 'yBt7BM8lLmQZ0nHrTMBrLZ5x9nZmZQ0JnQ0oNlDpXGo=',
        address: ['172.16.0.2/32'],
        peers: [
          {
            publicKey: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
            endpoint: 'engage.cloudflareclient.com:2408',
          },
        ],
        reserved: [78, 135, 76],
      },
    },
    {
      tag: 'proxy-de',
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: 'de.example.com',
            port: 443,
            users: [{ id: '9f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d', flow: 'xtls-rprx-vision' }],
          },
        ],
      },
      streamSettings: { network: 'raw', security: 'tls' },
    },
    {
      tag: 'proxy-nl',
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: 'nl.example.com',
            port: 443,
            users: [{ id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', flow: 'xtls-rprx-vision' }],
          },
        ],
      },
      streamSettings: { network: 'raw', security: 'tls' },
    },
  ],
  // leastPing без observatory — ядро не стартует; секция обязательна
  observatory: {
    subjectSelector: ['proxy-'],
    probeUrl: 'https://www.gstatic.com/generate_204',
    probeInterval: '5m',
  },
  routing: {
    domainStrategy: 'IPIfNonMatch',
    rules: [
      { type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' },
      { type: 'field', ip: ['geoip:private'], outboundTag: 'block' },
      { type: 'field', protocol: ['bittorrent'], outboundTag: 'block' },
      { type: 'field', domain: ['geosite:openai', 'geosite:netflix'], outboundTag: 'warp' },
      { type: 'field', network: 'tcp,udp', balancerTag: 'foreign' },
    ],
    balancers: [
      {
        tag: 'foreign',
        selector: ['proxy-'],
        fallbackTag: 'direct',
        strategy: { type: 'leastPing' },
      },
    ],
  },
}

const PROFILE = {
  uuid: SHOWCASE_UUID,
  viewPosition: 0,
  name: 'Production',
  config: CONFIG,
  inbounds: [
    { uuid: 'i1', tag: 'vless-reality', type: 'vless', network: 'raw', security: 'reality', port: 443 },
    { uuid: 'i2', tag: 'trojan-ws', type: 'trojan', network: 'ws', security: 'tls', port: 8443 },
    { uuid: 'i3', tag: 'hysteria2', type: 'hysteria2', network: 'hysteria', security: 'tls', port: 2096 },
  ],
  nodes: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-20T12:00:00.000Z',
}

const SQUADS = [
  { uuid: 's1', name: 'Основной' },
  { uuid: 's2', name: 'Мобильные' },
]

// Связь сквадов с inbound'ами приходит не из конфига, а этой ручкой
const PROFILE_INBOUNDS = [
  { uuid: 'i1', tag: 'vless-reality', type: 'vless', network: 'raw', security: 'reality', port: 443, activeSquads: ['s1'] },
  { uuid: 'i2', tag: 'trojan-ws', type: 'trojan', network: 'ws', security: 'tls', port: 8443, activeSquads: ['s2'] },
  { uuid: 'i3', tag: 'hysteria2', type: 'hysteria2', network: 'hysteria', security: 'tls', port: 2096, activeSquads: ['s2'] },
]

/**
 * Поздний обработчик Playwright перекрывает ранний — тот же приём, что в
 * e2e/trace.spec.ts. Общий mockApi не трогаем: на него опирается 51 e2e-тест.
 */
export async function mockShowcase(page: Page) {
  await mockApi(page)
  await page.route('**/api/squads', (r) => r.fulfill({ json: { squads: SQUADS } }))
  // Geo загружены: иначе трассировка честно скажет «нет данных», и панель
  // разбора на скриншоте окажется пустой
  await page.route('**/api/tools/geo/match', (r) =>
    r.fulfill({
      json: {
        loaded: true,
        answers: {
          'geosite:category-ads-all': false,
          'geoip:private': false,
          'geosite:openai': true,
          'geosite:netflix': false,
        },
        missing: [],
      },
    }),
  )
  await page.route(`**/api/profiles/${SHOWCASE_UUID}/inbounds`, (r) =>
    r.fulfill({ json: { inbounds: PROFILE_INBOUNDS } }),
  )
  await page.route(`**/api/profiles/${SHOWCASE_UUID}`, (r) =>
    r.fulfill({ json: { profile: PROFILE } }),
  )
  await page.route('**/api/profiles', (r) => r.fulfill({ json: { profiles: [PROFILE] } }))
}
