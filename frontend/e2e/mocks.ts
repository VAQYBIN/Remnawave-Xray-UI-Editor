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

export const TEMPLATE_UUID = '22222222-2222-4222-8222-222222222222'
export const NEW_TEMPLATE_UUID = '33333333-3333-4333-8333-333333333333'

export const TEMPLATE_JSON = {
  remnawave: {
    addVirtualHostAsOutbound: false,
    injectHosts: [
      { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy', selectFrom: 'HIDDEN' },
    ],
  },
  log: { loglevel: 'warning' },
  inbounds: [
    { tag: 'socks', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: { udp: true } },
  ],
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [{ type: 'field', domain: ['ya.ru'], outboundTag: 'proxy' }] },
}

export const TEMPLATE = {
  uuid: TEMPLATE_UUID,
  viewPosition: 0,
  name: 'Xray Default',
  tags: ['prod'],
  templateType: 'XRAY_JSON',
  templateJson: TEMPLATE_JSON,
  encodedTemplateYaml: null,
}

const TEMPLATE_HASH = 'c'.repeat(64)

/**
 * Маршруты шаблонов. Отдельно от mockApi: спекам профилей они не нужны, а
 * лишний перехват маскировал бы настоящие запросы, которые они и так проверяют.
 * `conflict: true` заставляет каждый PATCH отвечать 409 — сценарий конфликта.
 * `conflictOnce: true` — 409 только на первый PATCH, дальше 200: сценарий
 * «Перезаписать», где второе сохранение уходит с хэшем из тела конфликта.
 */
export async function mockTemplates(
  page: Page,
  opts: { conflict?: boolean; conflictOnce?: boolean } = {},
) {
  await page.route(`**/api/templates/${TEMPLATE_UUID}/backups`, (r) =>
    r.fulfill({ json: { backups: [] } }),
  )

  let patchCalls = 0
  await page.route(`**/api/templates/${TEMPLATE_UUID}`, (r) => {
    const method = r.request().method()
    if (method === 'DELETE') return r.fulfill({ json: { ok: true } })
    if (method === 'PATCH') {
      patchCalls += 1
      const conflictNow = opts.conflict || (opts.conflictOnce && patchCalls === 1)
      if (conflictNow) {
        return r.fulfill({
          status: 409,
          json: {
            message: 'Шаблон был изменён в панели после открытия',
            current: TEMPLATE,
            hash: 'd'.repeat(64),
          },
        })
      }
      return r.fulfill({ json: { template: TEMPLATE, hash: TEMPLATE_HASH } })
    }
    return r.fulfill({ json: { template: TEMPLATE, hash: TEMPLATE_HASH } })
  })

  // Новый шаблон, созданный в тесте: своя карточка, тот же JSON внутри
  const NEW_TEMPLATE = { ...TEMPLATE, uuid: NEW_TEMPLATE_UUID, name: 'New One' }
  await page.route(`**/api/templates/${NEW_TEMPLATE_UUID}`, (r) =>
    r.fulfill({ json: { template: NEW_TEMPLATE, hash: TEMPLATE_HASH } }),
  )
  await page.route(`**/api/templates/${NEW_TEMPLATE_UUID}/backups`, (r) =>
    r.fulfill({ json: { backups: [] } }),
  )

  await page.route('**/api/templates', (r) => {
    if (r.request().method() === 'POST') {
      return r.fulfill({ status: 201, json: { template: NEW_TEMPLATE } })
    }
    return r.fulfill({
      json: {
        templates: [
          TEMPLATE,
          // Редактор умеет два типа, и MIHOMO — второй: у него в списке есть
          // ссылка. Неоткрываемый тип нужен рядом, иначе проверка «ссылки нет»
          // осталась бы без предмета
          {
            uuid: '44444444-4444-4444-8444-444444444444',
            viewPosition: 1,
            name: 'Mihomo',
            templateType: 'MIHOMO',
            templateJson: null,
            encodedTemplateYaml: 'eA==',
          },
          {
            uuid: '55555555-5555-4555-8555-555555555555',
            viewPosition: 2,
            name: 'Clash',
            templateType: 'CLASH',
            templateJson: null,
            encodedTemplateYaml: 'eA==',
          },
        ],
      },
    })
  })
}

/**
 * Шаблон Mihomo. UUID тот же, что у записи `MIHOMO` в списке `mockTemplates`
 * выше: второй шаблон того же типа сломал бы утверждения списка, а редактор
 * всё равно читает содержимое отдельным запросом.
 *
 * Документ компактный, но настоящий: группа с маркером подстановки, вторая
 * группа через провайдера, сам провайдер и три правила. Порядок строк здесь
 * значим — сценарий правки проверяет НОМЕР строки, на которую форма вписала
 * поле (см. mihomo.spec.ts).
 */
export const MIHOMO_UUID = '44444444-4444-4444-8444-444444444444'

export const MIHOMO_YAML = `mode: rule
log-level: info

proxy-groups:
  - name: Основная
    type: select
    proxies:
      - Резерв
      # LEAVE THIS LINE!

  - name: Резерв
    type: url-test
    url: https://captive.apple.com/generate_204
    interval: 300
    use:
      - backup

proxy-providers:
  backup:
    type: http
    url: https://example.test/backup.yaml
    path: ./backup.yaml
    interval: 86400

rules:
  - DOMAIN-SUFFIX,ya.ru,Основная
  - GEOIP,RU,DIRECT
  - MATCH,Основная
`

/** Содержимое шаблона из каталога — намеренно ДРУГОЙ документ: по имени группы
 *  видно, что импорт действительно заменил содержимое редактора */
export const CATALOG_MIHOMO_YAML = `mode: rule

proxy-groups:
  - name: Каталог
    type: select
    proxies:
      # LEAVE THIS LINE!

rules:
  - MATCH,Каталог
`

/** base64 от utf-8, как хранит панель: в именах групп бывает кириллица */
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')

const MIHOMO_HASH = 'e'.repeat(64)

export const MIHOMO_TEMPLATE = {
  uuid: MIHOMO_UUID,
  viewPosition: 1,
  name: 'Mihomo',
  tags: [],
  templateType: 'MIHOMO',
  templateJson: null,
  encodedTemplateYaml: b64(MIHOMO_YAML),
}

/**
 * Индекс каталога: три записи, одна из них — типа, которого в контракте панели
 * нет (`SINGBOX_LEGACY`). Диалог обязан показать её с пометкой, а не уронить
 * список.
 */
export const CATALOG_ENTRIES = [
  {
    name: 'mihomo-default',
    type: 'MIHOMO',
    author: 'legiz-ru',
    url: 'https://raw.example.test/templates/mihomo-default.yaml',
  },
  {
    name: 'xray-default',
    type: 'XRAY_JSON',
    author: 'remnawave',
    url: 'https://raw.example.test/templates/xray-default.json',
  },
  {
    name: 'singbox-legacy',
    type: 'SINGBOX_LEGACY',
    author: 'community',
    url: 'https://raw.example.test/templates/singbox-legacy.json',
  },
]

const CATALOG_CONTENT: Record<string, string> = {
  [CATALOG_ENTRIES[0]!.url]: CATALOG_MIHOMO_YAML,
  [CATALOG_ENTRIES[1]!.url]: JSON.stringify({ outbounds: [{ tag: 'direct', protocol: 'freedom' }] }, null, 2),
  [CATALOG_ENTRIES[2]!.url]: '{"outbounds":[]}',
}

/**
 * Маршруты редактора Mihomo. Отдельно от `mockTemplates`: тем спекам нужен
 * список шаблонов, а этим — содержимое одного и инструменты вокруг него.
 * `core` задаёт ответ проверки ядром — сценарию отчёта нужен принявший вердикт.
 */
export async function mockMihomo(
  page: Page,
  opts: { core?: { available: boolean; ok: boolean; errors: string[] } } = {},
) {
  await page.route(`**/api/templates/${MIHOMO_UUID}/backups`, (r) =>
    r.fulfill({ json: { backups: [] } }),
  )
  await page.route(`**/api/templates/${MIHOMO_UUID}`, (r) =>
    r.fulfill({ json: { template: MIHOMO_TEMPLATE, hash: MIHOMO_HASH } }),
  )

  // Регулярками, а не глобами: `**/api/catalog/template*` поймал бы и индекс
  // (`/templates`), и порядок перехвата пришлось бы держать в голове
  await page.route(/\/api\/catalog\/templates$/, (r) =>
    r.fulfill({ json: { templates: CATALOG_ENTRIES } }),
  )
  await page.route(/\/api\/catalog\/template\?/, (r) => {
    const url = new URL(r.request().url()).searchParams.get('url') ?? ''
    const content = CATALOG_CONTENT[url]
    if (content === undefined) {
      return r.fulfill({ status: 400, json: { message: 'Такой ссылки в каталоге нет' } })
    }
    return r.fulfill({ json: { content } })
  })

  await page.route('**/api/tools/mihomo-test', (r) =>
    r.fulfill({ json: opts.core ?? { available: true, ok: true, errors: [] } }),
  )
}
