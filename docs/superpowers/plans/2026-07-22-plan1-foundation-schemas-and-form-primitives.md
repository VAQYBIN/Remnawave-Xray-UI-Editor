# План 1 «Фундамент»: полные zod-схемы + примитивы форм

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширить zod-модель Xray-конфига до полного прагматичного Remnawave-набора полей и добавить переиспользуемые примитивы форм, на которых планы 2–4 построят UI.

**Architecture:** Слой `entities/xray` получает полные типизированные схемы (TLS, Reality, транспорты вкл. xhttp/hysteria, sockopt, sniffing, fallbacks, outbound-settings, dns, log) — все с `.passthrough()`, чтобы неизвестные поля переживали round-trip. Слой форм получает 5 новых примитивов: `CheckboxField`, `MultiSelectField` (в `fields.tsx`), `KeyValueField`, `ListEditor` (новый файл `collections.tsx`), `CollapsibleSection` (в `shared/ui`). Никакого UI поверх новых схем в этом плане нет — только типы, примитивы и тесты.

**Tech Stack:** React 19, zod v3, vitest (jsdom) + @testing-library/react, CSS в `tokens.css` (без сторонних библиотек).

**Спека:** `docs/superpowers/specs/2026-07-22-full-xray-ui-coverage-design.md`

## Global Constraints

- Язык UI-текстов и подсказок — русский; коммиты — английский conventional style (`feat(frontend): ...`).
- Все схемы — `.object({...}).passthrough()`: неизвестные поля не теряются при parse → stringify.
- Никаких новых npm-зависимостей.
- zod v3 API (`required_error`, `z.record(valueSchema)`), не v4.
- Тесты — vitest, файлы `frontend/test/*.test.{ts,tsx}`; запуск из каталога `frontend`: `npx vitest run test/<файл>`.
- Поля с локальным текстовым буфером (как `PortField`/`StringListField`) читают value только при монтировании — внешняя замена значения требует remount через `key`. Новые примитивы с буфером обязаны следовать этому паттерну и документировать его комментарием.
- `boolean`-поля примитивов: `false` → `undefined` (ключ удаляется из конфига — поведение по умолчанию Xray).
- Всё новое из `entities/xray` реэкспортируется через `entities/xray/index.ts` (там `export *`, достаточно добавить новые файлы).

---

### Task 1: Полные схемы TLS, Reality, Sniffing (`stream.ts`)

**Files:**
- Modify: `frontend/src/entities/xray/stream.ts`
- Test: `frontend/test/xray-stream.test.ts` (создать)

**Interfaces:**
- Consumes: текущие `TlsSettingsSchema`, `RealitySettingsSchema`, `SniffingSchema` из `stream.ts`.
- Produces: `CertificateSchema`; `TlsSettingsSchema` + `maxVersion: string?`, `rejectUnknownSni: boolean?`, `certificates: CertificateSchema[]?`; `RealitySettingsSchema` + `serverName: string?`, `shortId: string?`, `password: string?` (клиентские поля outbound-Reality); `SniffingSchema` + `metadataOnly: boolean?`. Планы 3–4 используют эти поля в StreamForm.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/xray-stream.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RealitySettingsSchema, SniffingSchema, TlsSettingsSchema } from '../src/entities/xray'

describe('TlsSettingsSchema', () => {
  it('парсит полный tlsSettings из документации и сохраняет неизвестные поля', () => {
    const input = {
      serverName: 'example.com',
      rejectUnknownSni: false,
      alpn: ['h2', 'http/1.1'],
      minVersion: '1.2',
      maxVersion: '1.3',
      fingerprint: 'chrome',
      certificates: [{ certificateFile: '/etc/ssl/cert.pem', keyFile: '/etc/ssl/key.pem' }],
      echServerKeys: 'abc',
    }
    const parsed = TlsSettingsSchema.parse(input)
    expect(parsed.maxVersion).toBe('1.3')
    expect(parsed.rejectUnknownSni).toBe(false)
    expect(parsed.certificates?.[0]?.certificateFile).toBe('/etc/ssl/cert.pem')
    expect((parsed as Record<string, unknown>).echServerKeys).toBe('abc')
  })

  it('inline-сертификат (certificate/key массивами строк) парсится', () => {
    const parsed = TlsSettingsSchema.parse({
      certificates: [{ certificate: ['-----BEGIN CERTIFICATE-----'], key: ['-----BEGIN KEY-----'], usage: 'encipherment' }],
    })
    expect(parsed.certificates?.[0]?.certificate).toEqual(['-----BEGIN CERTIFICATE-----'])
  })

  it('certificates не-массивом — ошибка', () => {
    expect(TlsSettingsSchema.safeParse({ certificates: 'nope' }).success).toBe(false)
  })
})

describe('RealitySettingsSchema', () => {
  it('парсит клиентские поля outbound-Reality', () => {
    const parsed = RealitySettingsSchema.parse({
      serverName: 'example.com',
      fingerprint: 'chrome',
      shortId: 'ab12',
      password: 'PUBKEY_BASE64URL',
      spiderX: '/',
    })
    expect(parsed.serverName).toBe('example.com')
    expect(parsed.shortId).toBe('ab12')
    expect(parsed.password).toBe('PUBKEY_BASE64URL')
  })
})

describe('SniffingSchema', () => {
  it('парсит metadataOnly', () => {
    expect(SniffingSchema.parse({ enabled: true, metadataOnly: false }).metadataOnly).toBe(false)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/xray-stream.test.ts`
Ожидание: FAIL — `parsed.maxVersion`/`parsed.certificates[0].certificateFile` типизированы как unknown/отсутствуют (ошибки типов TS в тесте и/или упавшие expect'ы).

- [ ] **Step 3: Реализация**

В `frontend/src/entities/xray/stream.ts`:

Добавить перед `TlsSettingsSchema`:

```ts
export const CertificateSchema = z
  .object({
    certificateFile: z.string().optional(),
    keyFile: z.string().optional(),
    certificate: z.array(z.string()).optional(),
    key: z.array(z.string()).optional(),
    usage: z.string().optional(),
  })
  .passthrough()
```

Заменить `TlsSettingsSchema` на:

```ts
export const TlsSettingsSchema = z
  .object({
    serverName: z.string().optional(),
    rejectUnknownSni: z.boolean().optional(),
    alpn: z.array(z.string()).optional(),
    certificates: z.array(CertificateSchema).optional(),
    minVersion: z.string().optional(),
    maxVersion: z.string().optional(),
    fingerprint: z.string().optional(),
  })
  .passthrough()
```

В `RealitySettingsSchema` добавить после `spiderX`:

```ts
    serverName: z.string().optional(),
    shortId: z.string().optional(),
    password: z.string().optional(),
```

В `SniffingSchema` добавить после `routeOnly`:

```ts
    metadataOnly: z.boolean().optional(),
```

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/xray-stream.test.ts` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/stream.ts frontend/test/xray-stream.test.ts
git commit -m "feat(frontend): full tls/reality/sniffing schemas"
```

---

### Task 2: Схемы транспортов, sockopt, hysteria/finalmask (`stream.ts`)

**Files:**
- Modify: `frontend/src/entities/xray/stream.ts`
- Test: `frontend/test/xray-stream.test.ts` (дополнить)

**Interfaces:**
- Consumes: `stream.ts` после Task 1.
- Produces: именованные экспортируемые схемы `TcpSettingsSchema`, `WsSettingsSchema`, `GrpcSettingsSchema`, `HttpupgradeSettingsSchema`, `XhttpSettingsSchema`, `HysteriaSettingsSchema`, `QuicParamsSchema`, `FinalmaskSchema`, `SockoptSchema`; `StreamSettingsSchema` дополнительно принимает `rawSettings` (новое имя `tcpSettings` в свежих ядрах), `hysteriaSettings`, `finalmask`. План 3 строит на них StreamForm.

- [ ] **Step 1: Написать падающий тест**

Дополнить `frontend/test/xray-stream.test.ts` (импорт расширить: `StreamSettingsSchema` из `../src/entities/xray`):

```ts
describe('StreamSettingsSchema — транспорты', () => {
  it('ws: headers как record строк, heartbeatPeriod', () => {
    const parsed = StreamSettingsSchema.parse({
      network: 'ws',
      wsSettings: { path: '/ws?ed=2560', host: 'cdn.example.com', headers: { 'X-A': 'b' }, heartbeatPeriod: 10 },
    })
    expect(parsed.wsSettings?.heartbeatPeriod).toBe(10)
    expect(parsed.wsSettings?.headers?.['X-A']).toBe('b')
  })

  it('grpc: authority и multiMode', () => {
    const parsed = StreamSettingsSchema.parse({
      network: 'grpc',
      grpcSettings: { serviceName: 'svc', authority: 'a.example.com', multiMode: true },
    })
    expect(parsed.grpcSettings?.authority).toBe('a.example.com')
  })

  it('xhttp: path/host/mode типизированы, extra сохраняется', () => {
    const parsed = StreamSettingsSchema.parse({
      network: 'xhttp',
      xhttpSettings: { path: '/api', host: 'front.example.com', mode: 'packet-up', extra: { xmux: { maxConcurrency: '16-32' } } },
    })
    expect(parsed.xhttpSettings?.mode).toBe('packet-up')
    expect(parsed.xhttpSettings?.extra).toBeDefined()
  })

  it('rawSettings принимается наравне с tcpSettings', () => {
    const parsed = StreamSettingsSchema.parse({
      network: 'raw',
      rawSettings: { acceptProxyProtocol: true },
    })
    expect(parsed.rawSettings?.acceptProxyProtocol).toBe(true)
  })

  it('hysteria-транспорт с finalmask.quicParams', () => {
    const parsed = StreamSettingsSchema.parse({
      network: 'hysteria',
      security: 'tls',
      hysteriaSettings: { version: 2, up: '100mbps', down: '300mbps', masquerade: { type: 'file', dir: '/var/www' } },
      finalmask: { quicParams: { congestion: 'brutal', brutalUp: 100, brutalDown: 300 } },
    })
    expect(parsed.hysteriaSettings?.version).toBe(2)
    expect(parsed.finalmask?.quicParams?.congestion).toBe('brutal')
  })

  it('sockopt: dialerProxy строкой, tcpFastOpen bool или number', () => {
    const a = StreamSettingsSchema.parse({ sockopt: { dialerProxy: 'warp', tcpFastOpen: true } })
    const b = StreamSettingsSchema.parse({ sockopt: { tcpFastOpen: 256, mark: 255 } })
    expect(a.sockopt?.dialerProxy).toBe('warp')
    expect(b.sockopt?.tcpFastOpen).toBe(256)
    expect(StreamSettingsSchema.safeParse({ sockopt: { tcpFastOpen: 'yes' } }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/xray-stream.test.ts`
Ожидание: FAIL — новые поля не типизированы (`heartbeatPeriod`, `rawSettings`, `finalmask` и т.д.).

- [ ] **Step 3: Реализация**

В `frontend/src/entities/xray/stream.ts` добавить перед `StreamSettingsSchema`:

```ts
export const TcpSettingsSchema = z
  .object({
    acceptProxyProtocol: z.boolean().optional(),
    header: obj().optional(),
  })
  .passthrough()

export const WsSettingsSchema = z
  .object({
    path: z.string().optional(),
    host: z.string().optional(),
    headers: z.record(z.string()).optional(),
    heartbeatPeriod: z.number().optional(),
    acceptProxyProtocol: z.boolean().optional(),
  })
  .passthrough()

export const GrpcSettingsSchema = z
  .object({
    serviceName: z.string().optional(),
    authority: z.string().optional(),
    multiMode: z.boolean().optional(),
  })
  .passthrough()

export const HttpupgradeSettingsSchema = z
  .object({
    path: z.string().optional(),
    host: z.string().optional(),
    headers: z.record(z.string()).optional(),
    acceptProxyProtocol: z.boolean().optional(),
  })
  .passthrough()

export const XhttpSettingsSchema = z
  .object({
    path: z.string().optional(),
    host: z.string().optional(),
    mode: z.string().optional(),
    extra: obj().optional(),
  })
  .passthrough()

export const HysteriaSettingsSchema = z
  .object({
    version: z.number().optional(),
    auth: z.string().optional(),
    up: z.string().optional(),
    down: z.string().optional(),
    udpIdleTimeout: z.number().optional(),
    masquerade: obj().optional(),
  })
  .passthrough()

export const QuicParamsSchema = z
  .object({
    congestion: z.string().optional(),
    brutalUp: z.number().optional(),
    brutalDown: z.number().optional(),
  })
  .passthrough()

export const FinalmaskSchema = z
  .object({
    quicParams: QuicParamsSchema.optional(),
  })
  .passthrough()

export const SockoptSchema = z
  .object({
    mark: z.number().optional(),
    tcpFastOpen: z.union([z.boolean(), z.number()]).optional(),
    tproxy: z.string().optional(),
    domainStrategy: z.string().optional(),
    dialerProxy: z.string().optional(),
    acceptProxyProtocol: z.boolean().optional(),
    interface: z.string().optional(),
    tcpMptcp: z.boolean().optional(),
  })
  .passthrough()
```

Заменить `StreamSettingsSchema` на:

```ts
export const StreamSettingsSchema = z
  .object({
    network: z.string().optional(),
    security: z.string().optional(),
    realitySettings: RealitySettingsSchema.optional(),
    tlsSettings: TlsSettingsSchema.optional(),
    tcpSettings: TcpSettingsSchema.optional(),
    rawSettings: TcpSettingsSchema.optional(),
    wsSettings: WsSettingsSchema.optional(),
    grpcSettings: GrpcSettingsSchema.optional(),
    httpupgradeSettings: HttpupgradeSettingsSchema.optional(),
    xhttpSettings: XhttpSettingsSchema.optional(),
    hysteriaSettings: HysteriaSettingsSchema.optional(),
    finalmask: FinalmaskSchema.optional(),
    sockopt: SockoptSchema.optional(),
  })
  .passthrough()
```

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/xray-stream.test.ts` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/stream.ts frontend/test/xray-stream.test.ts
git commit -m "feat(frontend): typed transport, sockopt and hysteria schemas"
```

---

### Task 3: Fallbacks и hysteria-inbound (`inbounds.ts`)

**Files:**
- Modify: `frontend/src/entities/xray/inbounds.ts`
- Test: `frontend/test/xray-inbounds.test.ts` (дополнить)

**Interfaces:**
- Consumes: `InboundSchema` c `superRefine`-диспетчером по `protocol`.
- Produces: `FallbackSchema` (`name?`, `alpn?: string`, `path?`, `dest?: string|number`, `xver?: number`); `TrojanClientSchema` (`password?`, `email?`, `level?`); `HysteriaClientSchema` (`auth?`, `email?`, `level?`); `HysteriaInboundSettingsSchema` (`version?: number`, `clients?`); `VlessInboundSettingsSchema.fallbacks` и `TrojanInboundSettingsSchema.fallbacks` типизированы `FallbackSchema[]`; диспетчер `superRefine` знает `hysteria`. План 4 строит на этом формы fallbacks и hysteria2.

- [ ] **Step 1: Написать падающий тест**

Дополнить `frontend/test/xray-inbounds.test.ts` (импортировать `InboundSchema` — уже импортирован там):

```ts
describe('fallbacks', () => {
  it('vless-inbound с типизированными fallbacks парсится', () => {
    const parsed = InboundSchema.parse({
      tag: 'vless-in',
      protocol: 'vless',
      settings: {
        clients: [],
        decryption: 'none',
        fallbacks: [
          { dest: 9443, xver: 1 },
          { alpn: 'h2', dest: '/dev/shm/h2.sock', path: '/ws' },
        ],
      },
    })
    const settings = parsed.settings as { fallbacks: Array<{ dest?: string | number; xver?: number }> }
    expect(settings.fallbacks[0].dest).toBe(9443)
    expect(settings.fallbacks[1].dest).toBe('/dev/shm/h2.sock')
  })

  it('битый fallback (xver строкой) — ошибка с путём settings.fallbacks', () => {
    const res = InboundSchema.safeParse({
      tag: 'vless-in',
      protocol: 'vless',
      settings: { fallbacks: [{ dest: 80, xver: 'one' }] },
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues[0].path.join('.')).toBe('settings.fallbacks.0.xver')
    }
  })
})

describe('hysteria inbound', () => {
  it('парсит settings hysteria (version 2, clients)', () => {
    const parsed = InboundSchema.parse({
      tag: 'hy2-in',
      protocol: 'hysteria',
      port: 443,
      settings: { version: 2, clients: [{ auth: 'pass', email: 'user' }] },
    })
    const settings = parsed.settings as { version: number }
    expect(settings.version).toBe(2)
  })

  it('clients не-массивом — ошибка с путём settings.clients', () => {
    const res = InboundSchema.safeParse({
      tag: 'hy2-in',
      protocol: 'hysteria',
      settings: { version: 2, clients: 'nope' },
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues[0].path.join('.')).toBe('settings.clients')
    }
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/xray-inbounds.test.ts`
Ожидание: FAIL — «битый fallback» и «clients не-массивом» проходят парс (схемы-заглушки `obj()` всё принимают).

- [ ] **Step 3: Реализация**

В `frontend/src/entities/xray/inbounds.ts` добавить после `VlessClientSchema`:

```ts
export const FallbackSchema = z
  .object({
    name: z.string().optional(),
    alpn: z.string().optional(),
    path: z.string().optional(),
    dest: z.union([z.string(), z.number()]).optional(),
    xver: z.number().optional(),
  })
  .passthrough()

export const TrojanClientSchema = z
  .object({ password: z.string().optional(), email: z.string().optional(), level: z.number().optional() })
  .passthrough()

export const HysteriaClientSchema = z
  .object({ auth: z.string().optional(), email: z.string().optional(), level: z.number().optional() })
  .passthrough()

export const HysteriaInboundSettingsSchema = z
  .object({
    version: z.number().optional(),
    clients: z.array(HysteriaClientSchema).optional(),
  })
  .passthrough()
```

В `VlessInboundSettingsSchema` заменить `fallbacks: z.array(obj()).optional()` на `fallbacks: z.array(FallbackSchema).optional()`.

Заменить `TrojanInboundSettingsSchema` на:

```ts
export const TrojanInboundSettingsSchema = z
  .object({
    clients: z.array(TrojanClientSchema).optional(),
    fallbacks: z.array(FallbackSchema).optional(),
  })
  .passthrough()
```

В `superRefine` внутри `InboundSchema` расширить диспетчер:

```ts
    const settingsSchema =
      inb.protocol === 'vless'
        ? VlessInboundSettingsSchema
        : inb.protocol === 'trojan'
          ? TrojanInboundSettingsSchema
          : inb.protocol === 'shadowsocks'
            ? ShadowsocksInboundSettingsSchema
            : inb.protocol === 'hysteria'
              ? HysteriaInboundSettingsSchema
              : null
```

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/xray-inbounds.test.ts` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/inbounds.ts frontend/test/xray-inbounds.test.ts
git commit -m "feat(frontend): typed fallbacks and hysteria inbound settings"
```

---

### Task 4: Типизированные outbound-settings и mux (`outbounds.ts`)

**Files:**
- Modify: `frontend/src/entities/xray/outbounds.ts`
- Test: `frontend/test/xray-outbounds.test.ts` (создать)

**Interfaces:**
- Consumes: `StreamSettingsSchema` из Task 2.
- Produces: `FreedomFragmentSchema`, `FreedomOutboundSettingsSchema`, `BlackholeOutboundSettingsSchema`, `WireguardPeerSchema`, `WireguardOutboundSettingsSchema`, `VlessOutboundUserSchema`, `VlessVnextSchema`, `VlessOutboundSettingsSchema`, `ProxyServerUserSchema`, `ProxyServerSchema`, `SocksOutboundSettingsSchema`, `HttpOutboundSettingsSchema`, `MuxSchema`; `OutboundSchema` валидирует `settings` по `protocol` через `superRefine` (как `InboundSchema`) и типизирует `mux: MuxSchema`. План 4 строит на этом OutboundForm.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/xray-outbounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MuxSchema, OutboundSchema } from '../src/entities/xray'

describe('OutboundSchema — типизированные settings', () => {
  it('vless: vnext с users парсится', () => {
    const parsed = OutboundSchema.parse({
      tag: 'chain',
      protocol: 'vless',
      settings: {
        vnext: [
          { address: 'node2.example.com', port: 443, users: [{ id: 'uuid', flow: 'xtls-rprx-vision', encryption: 'none' }] },
        ],
      },
    })
    const settings = parsed.settings as { vnext: Array<{ address: string }> }
    expect(settings.vnext[0].address).toBe('node2.example.com')
  })

  it('vless: vnext не-массивом — ошибка с путём settings.vnext', () => {
    const res = OutboundSchema.safeParse({ tag: 'chain', protocol: 'vless', settings: { vnext: 'nope' } })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues[0].path.join('.')).toBe('settings.vnext')
    }
  })

  it('wireguard: peers, reserved, keepAlive', () => {
    const parsed = OutboundSchema.parse({
      tag: 'warp',
      protocol: 'wireguard',
      settings: {
        secretKey: 'KEY',
        address: ['172.16.0.2/32'],
        mtu: 1280,
        reserved: [1, 2, 3],
        peers: [
          {
            publicKey: 'PUB',
            endpoint: 'engage.cloudflareclient.com:2408',
            allowedIPs: ['0.0.0.0/0', '::/0'],
            preSharedKey: 'PSK',
            keepAlive: 25,
          },
        ],
      },
    })
    const settings = parsed.settings as { reserved: number[]; peers: Array<{ keepAlive: number }> }
    expect(settings.reserved).toEqual([1, 2, 3])
    expect(settings.peers[0].keepAlive).toBe(25)
  })

  it('freedom: redirect и fragment', () => {
    const parsed = OutboundSchema.parse({
      tag: 'direct',
      protocol: 'freedom',
      settings: {
        domainStrategy: 'UseIP',
        redirect: '127.0.0.1:3366',
        fragment: { packets: 'tlshello', length: '100-200', interval: '10-20' },
      },
    })
    const settings = parsed.settings as { fragment: { packets: string } }
    expect(settings.fragment.packets).toBe('tlshello')
  })

  it('blackhole: response.type', () => {
    const parsed = OutboundSchema.parse({
      tag: 'block',
      protocol: 'blackhole',
      settings: { response: { type: 'http' } },
    })
    const settings = parsed.settings as { response: { type: string } }
    expect(settings.response.type).toBe('http')
  })

  it('socks: servers с users', () => {
    const parsed = OutboundSchema.parse({
      tag: 'socks-out',
      protocol: 'socks',
      settings: { servers: [{ address: '127.0.0.1', port: 1080, users: [{ user: 'u', pass: 'p' }] }] },
    })
    const settings = parsed.settings as { servers: Array<{ port: number }> }
    expect(settings.servers[0].port).toBe(1080)
  })

  it('неизвестный протокол — settings не проверяются (passthrough)', () => {
    const res = OutboundSchema.safeParse({ tag: 'x', protocol: 'vmess', settings: { anything: [1, 2] } })
    expect(res.success).toBe(true)
  })
})

describe('MuxSchema', () => {
  it('парсит enabled/concurrency/xudp-поля', () => {
    const parsed = MuxSchema.parse({ enabled: true, concurrency: 8, xudpConcurrency: 16, xudpProxyUDP443: 'reject' })
    expect(parsed.concurrency).toBe(8)
  })

  it('mux внутри OutboundSchema типизирован', () => {
    const res = OutboundSchema.safeParse({ tag: 'x', protocol: 'vless', mux: { enabled: 'yes' } })
    expect(res.success).toBe(false)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/xray-outbounds.test.ts`
Ожидание: FAIL — негативные кейсы (`vnext: 'nope'`, `mux.enabled: 'yes'`) сейчас проходят парс.

- [ ] **Step 3: Реализация**

Заменить содержимое `frontend/src/entities/xray/outbounds.ts` на:

```ts
import { z } from 'zod'
import { StreamSettingsSchema } from './stream'

const obj = () => z.object({}).passthrough()

export const FreedomFragmentSchema = z
  .object({
    packets: z.string().optional(),
    length: z.string().optional(),
    interval: z.string().optional(),
  })
  .passthrough()

export const FreedomOutboundSettingsSchema = z
  .object({
    domainStrategy: z.string().optional(),
    redirect: z.string().optional(),
    fragment: FreedomFragmentSchema.optional(),
    proxyProtocol: z.number().optional(),
  })
  .passthrough()

export const BlackholeOutboundSettingsSchema = z
  .object({
    response: z.object({ type: z.string().optional() }).passthrough().optional(),
  })
  .passthrough()

export const WireguardPeerSchema = z
  .object({
    publicKey: z.string().optional(),
    endpoint: z.string().optional(),
    allowedIPs: z.array(z.string()).optional(),
    preSharedKey: z.string().optional(),
    keepAlive: z.number().optional(),
  })
  .passthrough()

export const WireguardOutboundSettingsSchema = z
  .object({
    secretKey: z.string().optional(),
    address: z.array(z.string()).optional(),
    peers: z.array(WireguardPeerSchema).optional(),
    mtu: z.number().optional(),
    reserved: z.array(z.number()).optional(),
    workers: z.number().optional(),
    domainStrategy: z.string().optional(),
    noKernelTun: z.boolean().optional(),
  })
  .passthrough()

export const VlessOutboundUserSchema = z
  .object({
    id: z.string().optional(),
    flow: z.string().optional(),
    encryption: z.string().optional(),
    level: z.number().optional(),
  })
  .passthrough()

export const VlessVnextSchema = z
  .object({
    address: z.string().optional(),
    port: z.number().optional(),
    users: z.array(VlessOutboundUserSchema).optional(),
  })
  .passthrough()

export const VlessOutboundSettingsSchema = z
  .object({ vnext: z.array(VlessVnextSchema).optional() })
  .passthrough()

export const ProxyServerUserSchema = z
  .object({ user: z.string().optional(), pass: z.string().optional(), level: z.number().optional() })
  .passthrough()

export const ProxyServerSchema = z
  .object({
    address: z.string().optional(),
    port: z.number().optional(),
    users: z.array(ProxyServerUserSchema).optional(),
  })
  .passthrough()

export const SocksOutboundSettingsSchema = z
  .object({ servers: z.array(ProxyServerSchema).optional() })
  .passthrough()

export const HttpOutboundSettingsSchema = z
  .object({ servers: z.array(ProxyServerSchema).optional() })
  .passthrough()

export const MuxSchema = z
  .object({
    enabled: z.boolean().optional(),
    concurrency: z.number().optional(),
    xudpConcurrency: z.number().optional(),
    xudpProxyUDP443: z.string().optional(),
  })
  .passthrough()

const OUTBOUND_SETTINGS_BY_PROTOCOL: Record<string, z.ZodTypeAny> = {
  freedom: FreedomOutboundSettingsSchema,
  blackhole: BlackholeOutboundSettingsSchema,
  wireguard: WireguardOutboundSettingsSchema,
  vless: VlessOutboundSettingsSchema,
  socks: SocksOutboundSettingsSchema,
  http: HttpOutboundSettingsSchema,
}

export const OutboundSchema = z
  .object({
    tag: z.string({ required_error: 'У outbound должен быть tag' }),
    protocol: z.string({ required_error: 'У outbound должен быть protocol' }),
    settings: obj().optional(),
    streamSettings: StreamSettingsSchema.optional(),
    proxySettings: obj().optional(),
    sendThrough: z.string().optional(),
    mux: MuxSchema.optional(),
  })
  .passthrough()
  .superRefine((out, ctx) => {
    const settingsSchema = OUTBOUND_SETTINGS_BY_PROTOCOL[out.protocol]
    if (settingsSchema && out.settings !== undefined) {
      const res = settingsSchema.safeParse(out.settings)
      if (!res.success) {
        for (const issue of res.error.issues) {
          ctx.addIssue({ ...issue, path: ['settings', ...issue.path] })
        }
      }
    }
  })

export type Outbound = z.infer<typeof OutboundSchema>
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/xray-outbounds.test.ts test/xray-config.test.ts test/outbound-form.test.tsx` — PASS (существующие тесты формы и конфига не должны сломаться от `superRefine`).

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/outbounds.ts frontend/test/xray-outbounds.test.ts
git commit -m "feat(frontend): typed outbound settings, mux and per-protocol validation"
```

---

### Task 5: `source` в правилах, схемы DNS и log, привязка к конфигу

**Files:**
- Modify: `frontend/src/entities/xray/routing.ts`
- Create: `frontend/src/entities/xray/dns.ts`
- Create: `frontend/src/entities/xray/log.ts`
- Modify: `frontend/src/entities/xray/config.ts`
- Modify: `frontend/src/entities/xray/index.ts`
- Test: `frontend/test/xray-config.test.ts` (дополнить)

**Interfaces:**
- Consumes: `XrayConfigSchema` (`config.ts`), `RoutingRuleSchema`.
- Produces: `RoutingRuleSchema` + `source?: string[]`; новые `DnsServerObjectSchema`, `DnsServerSchema` (union строка|объект), `DnsSchema`, `LogSchema`; `XrayConfigSchema.dns`/`XrayConfigSchema.log` типизированы. Планы 2 и 4 строят на этом RuleForm, диалог «Настройки конфига» и DnsForm.

- [ ] **Step 1: Написать падающий тест**

Дополнить `frontend/test/xray-config.test.ts` (импортировать дополнительно `DnsSchema`, `LogSchema`, `RoutingRuleSchema` из `../src/entities/xray`):

```ts
describe('RoutingRuleSchema — source', () => {
  it('парсит source как массив строк', () => {
    const parsed = RoutingRuleSchema.parse({ type: 'field', source: ['192.168.0.0/24'], outboundTag: 'direct' })
    expect(parsed.source).toEqual(['192.168.0.0/24'])
  })
})

describe('DnsSchema', () => {
  it('servers: строки и объекты вперемешку', () => {
    const parsed = DnsSchema.parse({
      servers: [
        '8.8.8.8',
        { address: '1.1.1.1', port: 53, domains: ['geosite:openai'], expectIPs: ['geoip:us'], skipFallback: true },
      ],
      hosts: { 'example.com': '1.2.3.4', 'multi.example.com': ['1.2.3.4', '5.6.7.8'] },
      queryStrategy: 'UseIPv4',
      tag: 'dns-inbound',
    })
    expect(parsed.servers?.[0]).toBe('8.8.8.8')
    expect(typeof parsed.servers?.[1]).toBe('object')
    expect(parsed.queryStrategy).toBe('UseIPv4')
  })

  it('servers не-массивом — ошибка', () => {
    expect(DnsSchema.safeParse({ servers: '8.8.8.8' }).success).toBe(false)
  })
})

describe('LogSchema', () => {
  it('парсит loglevel/access/error/dnsLog', () => {
    const parsed = LogSchema.parse({ loglevel: 'warning', access: 'none', error: '/var/log/xray.log', dnsLog: true })
    expect(parsed.loglevel).toBe('warning')
    expect(parsed.dnsLog).toBe(true)
  })
})

describe('XrayConfigSchema — dns и log типизированы', () => {
  it('битый dns.servers ловится на уровне конфига', () => {
    const res = XrayConfigSchema.safeParse({ dns: { servers: 'nope' } })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues[0].path.join('.')).toBe('dns.servers')
    }
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/xray-config.test.ts`
Ожидание: FAIL — `DnsSchema`/`LogSchema` не существуют (ошибка импорта).

- [ ] **Step 3: Реализация**

В `frontend/src/entities/xray/routing.ts` в `RoutingRuleSchema` добавить после `user`:

```ts
    source: z.array(z.string()).optional(),
```

Создать `frontend/src/entities/xray/dns.ts`:

```ts
import { z } from 'zod'

export const DnsServerObjectSchema = z
  .object({
    address: z.string().optional(),
    port: z.number().optional(),
    domains: z.array(z.string()).optional(),
    expectIPs: z.array(z.string()).optional(),
    skipFallback: z.boolean().optional(),
    queryStrategy: z.string().optional(),
  })
  .passthrough()

export const DnsServerSchema = z.union([z.string(), DnsServerObjectSchema])

export const DnsSchema = z
  .object({
    servers: z.array(DnsServerSchema).optional(),
    hosts: z.record(z.union([z.string(), z.array(z.string())])).optional(),
    clientIp: z.string().optional(),
    queryStrategy: z.string().optional(),
    tag: z.string().optional(),
  })
  .passthrough()
```

Создать `frontend/src/entities/xray/log.ts`:

```ts
import { z } from 'zod'

export const LogSchema = z
  .object({
    access: z.string().optional(),
    error: z.string().optional(),
    loglevel: z.string().optional(),
    dnsLog: z.boolean().optional(),
  })
  .passthrough()
```

В `frontend/src/entities/xray/config.ts`:
- добавить импорты: `import { DnsSchema } from './dns'` и `import { LogSchema } from './log'`;
- заменить `log: obj().optional(),` на `log: LogSchema.optional(),` и `dns: obj().optional(),` на `dns: DnsSchema.optional(),`.

В `frontend/src/entities/xray/index.ts` добавить:

```ts
export * from './dns'
export * from './log'
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/xray-config.test.ts test/build-graph.test.ts` — PASS (dns-узел графа строится по-прежнему).

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/routing.ts frontend/src/entities/xray/dns.ts frontend/src/entities/xray/log.ts frontend/src/entities/xray/config.ts frontend/src/entities/xray/index.ts frontend/test/xray-config.test.ts
git commit -m "feat(frontend): rule source, typed dns and log schemas"
```

---

### Task 6: `CheckboxField`, `MultiSelectField` и подсказки полей (`fields.tsx`)

**Files:**
- Modify: `frontend/src/features/inspector/fields.tsx`
- Modify: `frontend/src/shared/ui/tokens.css` (дописать в конец)
- Test: `frontend/test/inspector-fields.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `Checkbox` из `shared/ui`, тип `Option`, компонент `Field`.
- Produces: `Field` получает опциональный проп `hint?: string` (серый поясняющий текст под контролом; работает во всех существующих полях); `CheckboxField({ label, hint?, value: boolean | undefined, onChange: (v: boolean | undefined) => void })` — `false` → `undefined`; `MultiSelectField({ label, hint?, options: Option[], value: string[] | undefined, onChange: (v: string[] | undefined) => void })` — чипы-переключатели, пустой набор → `undefined`. Планы 2–4 используют их для `destOverride`, `alpn`, `protocol` правил и всех boolean-полей.

- [ ] **Step 1: Написать падающий тест**

Дополнить `frontend/test/inspector-fields.test.tsx` (импорт расширить: `CheckboxField`, `MultiSelectField`):

```ts
describe('CheckboxField', () => {
  it('включение даёт true, выключение даёт undefined (ключ удаляется)', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<CheckboxField label="multiMode" value={undefined} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('multiMode'))
    expect(onChange).toHaveBeenLastCalledWith(true)
    rerender(<CheckboxField label="multiMode" value={true} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('multiMode'))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('показывает подсказку', () => {
    render(<CheckboxField label="routeOnly" hint="Только для маршрутизации" value={undefined} onChange={() => {}} />)
    expect(screen.getByText('Только для маршрутизации')).toBeInTheDocument()
  })
})

describe('MultiSelectField', () => {
  const options = [
    { value: 'http', label: 'http' },
    { value: 'tls', label: 'tls' },
    { value: 'quic', label: 'quic' },
  ]

  it('клик добавляет значение, повторный клик убирает; пусто → undefined', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <MultiSelectField label="destOverride" options={options} value={['http']} onChange={onChange} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'tls' }))
    expect(onChange).toHaveBeenLastCalledWith(['http', 'tls'])
    rerender(<MultiSelectField label="destOverride" options={options} value={['http']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'http' }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('выбранные чипы помечены aria-pressed', () => {
    render(<MultiSelectField label="destOverride" options={options} value={['tls']} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'tls' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'http' })).toHaveAttribute('aria-pressed', 'false')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/inspector-fields.test.tsx`
Ожидание: FAIL — `CheckboxField`/`MultiSelectField` не экспортируются.

- [ ] **Step 3: Реализация**

В `frontend/src/features/inspector/fields.tsx`:

Импорт из shared/ui расширить: `import { Button, Checkbox, Select, TextInput } from '../../shared/ui'`.

Заменить компонент `Field` на версию с подсказкой:

```tsx
export function Field({
  label,
  hint,
  mono,
  children,
}: {
  label: string
  hint?: string
  mono?: boolean
  children: ReactNode
}) {
  return (
    <label className={mono ? 'field field-mono' : 'field'}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}
```

Добавить в конец файла:

```tsx
// false → undefined: ключ с дефолтным значением удаляется из конфига
export function CheckboxField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean | undefined
  onChange: (v: boolean | undefined) => void
}) {
  return (
    <div className="field">
      <Checkbox label={label} checked={value ?? false} onChange={(v) => onChange(v ? true : undefined)} />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}

// Набор значений чипами-переключателями; пустой набор → undefined
export function MultiSelectField({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string
  hint?: string
  options: Option[]
  value: string[] | undefined
  onChange: (v: string[] | undefined) => void
}) {
  const selected = value ?? []
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="row-wrap">
        {options.map((o) => {
          const active = selected.includes(o.value)
          return (
            <button
              key={o.value}
              type="button"
              className={active ? 'multi-chip multi-chip-active' : 'multi-chip'}
              aria-pressed={active}
              onClick={() => {
                const next = active ? selected.filter((v) => v !== o.value) : [...selected, o.value]
                onChange(next.length > 0 ? next : undefined)
              }}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}
```

В конец `frontend/src/shared/ui/tokens.css` дописать:

```css
.field-hint { font-size: 11px; color: var(--muted); }
.multi-chip {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
}
.multi-chip-active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
```

(Перед правкой CSS свериться с именами переменных в начале `tokens.css` — использовать существующие токены цвета; если `--accent`/`--border`/`--text`/`--muted` называются иначе, взять фактические имена.)

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/inspector-fields.test.tsx test/inbound-form.test.tsx test/stream-form.test.tsx` — PASS (изменение `Field` не ломает существующие формы).

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/fields.tsx frontend/src/shared/ui/tokens.css frontend/test/inspector-fields.test.tsx
git commit -m "feat(frontend): checkbox and multi-select field primitives with hints"
```

---

### Task 7: `KeyValueField` и `ListEditor` (`collections.tsx`)

**Files:**
- Create: `frontend/src/features/inspector/collections.tsx`
- Modify: `frontend/src/shared/ui/tokens.css` (дописать в конец)
- Test: `frontend/test/inspector-collections.test.tsx` (создать)

**Interfaces:**
- Consumes: `Button`, `TextInput` из `shared/ui`.
- Produces:
  - `KeyValueField({ label, hint?, value: Record<string, string> | undefined, onChange: (v: Record<string, string> | undefined) => void, keyPlaceholder?, valuePlaceholder? })` — редактор пар ключ-значение (headers, dns.hosts со строковыми значениями). **Mount-only буфер**: value читается при монтировании, внешняя замена требует remount через `key`.
  - `ListEditor<T extends object>({ label, hint?, value: T[] | undefined, onChange: (v: T[] | undefined) => void, createItem: () => T, addLabel: string, renderItem: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode })` — повторяемые карточки (fallbacks, peers, certificates, dns-серверы, vnext). Полностью controlled, буфера нет.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/inspector-collections.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KeyValueField, ListEditor } from '../src/features/inspector/collections'
import { TextField } from '../src/features/inspector/fields'

describe('KeyValueField', () => {
  it('редактирование значения отдаёт объект; строки с пустым ключом отбрасываются', async () => {
    const onChange = vi.fn()
    render(<KeyValueField label="Заголовки" value={{ Host: 'a.com' }} onChange={onChange} />)
    const valueInput = screen.getByDisplayValue('a.com')
    await userEvent.clear(valueInput)
    await userEvent.type(valueInput, 'b.com')
    expect(onChange).toHaveBeenLastCalledWith({ Host: 'b.com' })
  })

  it('добавляет пустую строку по кнопке, удаляет по крестику; пусто → undefined', async () => {
    const onChange = vi.fn()
    render(<KeyValueField label="Заголовки" value={{ Host: 'a.com' }} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Пара'))
    expect(screen.getAllByPlaceholderText('Ключ')).toHaveLength(2)
    await userEvent.click(screen.getByLabelText('Удалить пару 1'))
    await userEvent.click(screen.getByLabelText('Удалить пару 1'))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})

interface Peer {
  publicKey?: string
  endpoint?: string
}

function PeersEditor({ value, onChange }: { value: Peer[] | undefined; onChange: (v: Peer[] | undefined) => void }) {
  return (
    <ListEditor<Peer>
      label="Пиры"
      value={value}
      onChange={onChange}
      createItem={() => ({})}
      addLabel="+ Пир"
      renderItem={(item, update) => (
        <TextField label="Endpoint" value={item.endpoint} onChange={(v) => update({ endpoint: v })} />
      )}
    />
  )
}

describe('ListEditor', () => {
  it('добавляет элемент из createItem и правит поле через update', async () => {
    const onChange = vi.fn()
    render(<PeersEditor value={undefined} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Пир'))
    expect(onChange).toHaveBeenLastCalledWith([{}])
  })

  it('update патчит нужный элемент по индексу', async () => {
    const onChange = vi.fn()
    render(<PeersEditor value={[{ endpoint: 'a:1' }, { endpoint: 'b:2' }]} onChange={onChange} />)
    const second = screen.getByDisplayValue('b:2')
    await userEvent.type(second, '5')
    expect(onChange).toHaveBeenLastCalledWith([{ endpoint: 'a:1' }, { endpoint: 'b:25' }])
  })

  it('удаляет элемент по крестику; пусто → undefined', async () => {
    const onChange = vi.fn()
    render(<PeersEditor value={[{ endpoint: 'a:1' }]} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Удалить элемент 1'))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/inspector-collections.test.tsx`
Ожидание: FAIL — модуль `collections.tsx` не существует.

- [ ] **Step 3: Реализация**

Создать `frontend/src/features/inspector/collections.tsx`:

```tsx
import { useState, type ReactNode } from 'react'
import { Button, TextInput } from '../../shared/ui'

interface KvRow {
  key: string
  value: string
}

// Пары ключ-значение (headers, hosts). Наружу уходят только строки с непустым ключом.
// Локальный буфер строк: значение из пропсов читается только при монтировании —
// внешние изменения требуют remount (key).
export function KeyValueField({
  label,
  hint,
  value,
  onChange,
  keyPlaceholder = 'Ключ',
  valuePlaceholder = 'Значение',
}: {
  label: string
  hint?: string
  value: Record<string, string> | undefined
  onChange: (v: Record<string, string> | undefined) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  const [rows, setRows] = useState<KvRow[]>(() => Object.entries(value ?? {}).map(([key, val]) => ({ key, value: val })))

  const emit = (next: KvRow[]) => {
    setRows(next)
    const entries = next.filter((r) => r.key.trim() !== '')
    onChange(entries.length > 0 ? Object.fromEntries(entries.map((r) => [r.key.trim(), r.value])) : undefined)
  }

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="kv-rows">
        {rows.map((row, i) => (
          <div key={i} className="kv-row">
            <TextInput
              value={row.key}
              placeholder={keyPlaceholder}
              onChange={(e) => emit(rows.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r)))}
            />
            <TextInput
              value={row.value}
              placeholder={valuePlaceholder}
              onChange={(e) => emit(rows.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r)))}
            />
            <button
              type="button"
              className="chip-x"
              aria-label={`Удалить пару ${i + 1}`}
              onClick={() => emit(rows.filter((_, idx) => idx !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <Button onClick={() => setRows([...rows, { key: '', value: '' }])}>+ Пара</Button>
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}

// Повторяемые карточки объектов (fallbacks, peers, certificates, dns-серверы).
// Полностью controlled: рендер идёт от value из пропсов, буфера нет.
export function ListEditor<T extends object>({
  label,
  hint,
  value,
  onChange,
  createItem,
  addLabel,
  renderItem,
}: {
  label: string
  hint?: string
  value: T[] | undefined
  onChange: (v: T[] | undefined) => void
  createItem: () => T
  addLabel: string
  renderItem: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode
}) {
  const items = value ?? []
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="list-editor">
        {items.map((item, i) => (
          <div key={i} className="list-editor-card">
            <div className="list-editor-body">
              {renderItem(item, (patch) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it))), i)}
            </div>
            <button
              type="button"
              className="chip-x"
              aria-label={`Удалить элемент ${i + 1}`}
              onClick={() => {
                const next = items.filter((_, idx) => idx !== i)
                onChange(next.length > 0 ? next : undefined)
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <Button onClick={() => onChange([...items, createItem()])}>{addLabel}</Button>
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}
```

В конец `frontend/src/shared/ui/tokens.css` дописать (сверить имена CSS-переменных с фактическими в начале файла):

```css
.kv-rows { display: flex; flex-direction: column; gap: 6px; }
.kv-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; align-items: center; }
.list-editor { display: flex; flex-direction: column; gap: 8px; }
.list-editor-card {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
}
.list-editor-body { flex: 1; display: flex; flex-direction: column; gap: 6px; }
```

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/inspector-collections.test.tsx` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/collections.tsx frontend/src/shared/ui/tokens.css frontend/test/inspector-collections.test.tsx
git commit -m "feat(frontend): key-value and list editor form primitives"
```

---

### Task 8: `CollapsibleSection` (`shared/ui`)

**Files:**
- Create: `frontend/src/shared/ui/CollapsibleSection.tsx`
- Modify: `frontend/src/shared/ui/index.ts`
- Modify: `frontend/src/shared/ui/tokens.css` (дописать в конец)
- Test: `frontend/test/ui-kit.test.tsx` (дополнить)

**Interfaces:**
- Consumes: ничего из других задач.
- Produces: `CollapsibleSection({ title, defaultOpen?: boolean, children })` — сворачиваемый блок «Продвинутые», по умолчанию закрыт; экспорт из `shared/ui`. Все формы планов 2–4 кладут в него редкие поля.

- [ ] **Step 1: Написать падающий тест**

Дополнить `frontend/test/ui-kit.test.tsx` (добавить импорт `CollapsibleSection` из `../src/shared/ui`; `render`, `screen`, `userEvent` там уже используются):

```tsx
describe('CollapsibleSection', () => {
  it('по умолчанию закрыт, открывается и закрывается по клику', async () => {
    render(
      <CollapsibleSection title="Продвинутые">
        <span>секретное поле</span>
      </CollapsibleSection>,
    )
    expect(screen.queryByText('секретное поле')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /Продвинутые/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(screen.getByText('секретное поле')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(toggle)
    expect(screen.queryByText('секретное поле')).not.toBeInTheDocument()
  })

  it('defaultOpen открывает сразу', () => {
    render(
      <CollapsibleSection title="Продвинутые" defaultOpen>
        <span>видно</span>
      </CollapsibleSection>,
    )
    expect(screen.getByText('видно')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/ui-kit.test.tsx`
Ожидание: FAIL — `CollapsibleSection` не экспортируется из `shared/ui`.

- [ ] **Step 3: Реализация**

Создать `frontend/src/shared/ui/CollapsibleSection.tsx`:

```tsx
import { useState, type ReactNode } from 'react'

export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="collapsible">
      <button type="button" className="collapsible-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {title}
      </button>
      {open ? <div className="collapsible-body">{children}</div> : null}
    </div>
  )
}
```

В `frontend/src/shared/ui/index.ts` добавить:

```ts
export { CollapsibleSection } from './CollapsibleSection'
```

В конец `frontend/src/shared/ui/tokens.css` дописать (сверить имена CSS-переменных):

```css
.collapsible { display: flex; flex-direction: column; gap: 8px; }
.collapsible-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;
  text-align: left;
}
.collapsible-toggle:hover { color: var(--text); }
.collapsible-body { display: flex; flex-direction: column; gap: 8px; }
```

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/ui-kit.test.tsx` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/shared/ui/CollapsibleSection.tsx frontend/src/shared/ui/index.ts frontend/src/shared/ui/tokens.css frontend/test/ui-kit.test.tsx
git commit -m "feat(frontend): collapsible section for advanced form fields"
```

---

### Task 9: Финальная проверка плана

**Files:** нет новых — только запуск проверок.

**Interfaces:**
- Consumes: всё из задач 1–8.
- Produces: зелёный полный прогон — фундамент готов для планов 2–4.

- [ ] **Step 1: Полный прогон тестов фронтенда**

Из каталога `frontend`: `npm test`
Ожидание: PASS, 0 упавших (112 старых + новые).

- [ ] **Step 2: Типы**

Из корня: `npm run typecheck -w frontend`
Ожидание: exit 0, без ошибок.

- [ ] **Step 3: Тесты бэкенда не задеты**

Из корня: `npm test -w backend`
Ожидание: PASS (фронтенд-план не трогает бэкенд, но прогон дешёвый).

- [ ] **Step 4: Если что-то упало — починить и закоммитить фикс**

Формат коммита: `fix(frontend): <что именно>`. Если всё зелёное сразу — коммит не нужен.
