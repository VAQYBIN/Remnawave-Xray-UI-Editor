# План 1: Бэкенд и деплой — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fastify-бэкенд с парольной авторизацией, типизированным прокси к Remnawave v2.8.0 (config-profiles CRUD, nodes, squads), конфликт-детектом, автобэкапами и деплоем через Docker Compose.

**Architecture:** Монорепозиторий (npm workspaces). Пакет `backend` — Fastify 5 (ESM, TypeScript): раздаёт статику SPA, держит сессию по паролю (подписанная httpOnly-cookie) и проксирует запросы в панель Remnawave, добавляя Bearer-токен из `.env`. Токен и адрес панели в браузер не попадают. Один Docker-образ, `docker compose up -d`.

**Tech Stack:** Node 22, TypeScript 5, Fastify 5, @fastify/cookie, @fastify/rate-limit, @fastify/static, zod 3, bcryptjs 3, vitest, tsx (dev), tsup (build), Docker Compose.

**Спека:** `docs/superpowers/specs/2026-07-20-xray-ui-editor-design.md`. Это план 1 из 3 (далее: ядро фронтенда; визуальный редактор).

## Global Constraints

- Node 22, ESM (`"type": "module"`), все относительные импорты в исходниках — с расширением `.js`.
- Все сообщения об ошибках, видимые пользователю, — на русском.
- `REMNAWAVE_TOKEN` и `REMNAWAVE_URL` существуют только на сервере, никогда не отдаются в ответах API.
- Переменные окружения: `REMNAWAVE_URL`, `REMNAWAVE_TOKEN`, `APP_PASSWORD`, `SESSION_SECRET` (мин. 32 символа), `PORT` (дефолт 3000), `DATA_DIR` (дефолт `./data`), `STATIC_DIR` (дефолт `./public`), `SESSION_TTL_SECONDS` (дефолт 604800).
- Контракты панели Remnawave v2.8.0 (проверены по https://cdn.remna.st/docs/openapi.json): все ответы обёрнуты в `{ "response": ... }`;
  - `GET /api/config-profiles` → `{response: {total, configProfiles: ConfigProfile[]}}`
  - `GET|DELETE /api/config-profiles/{uuid}`; DELETE → `{response: {isDeleted}}`
  - `POST /api/config-profiles` body `{name, config}` (name: 2–30, `^[A-Za-z0-9_\s-]+$`)
  - `PATCH /api/config-profiles` body `{uuid, name?, config?}`
  - `GET /api/nodes` → `{response: [...]}` (массив)
  - `GET /api/internal-squads` → `{response: {total, internalSquads: [...]}}`
  - Авторизация: заголовок `Authorization: Bearer <token>`.
- Команды из корня репо. Тесты: `npm test --workspace backend`. Коммит после каждой задачи.

---

### Task 1: Каркас монорепо и загрузка конфигурации

**Files:**
- Create: `package.json` (корень), `.gitignore`, `backend/package.json`, `backend/tsconfig.json`, `backend/vitest.config.ts`, `backend/src/config.ts`
- Test: `backend/test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): AppConfig` и тип `AppConfig { port: number; remnawaveUrl: string; remnawaveToken: string; appPassword: string; sessionSecret: string; dataDir: string; staticDir: string; sessionTtlSeconds: number }` из `backend/src/config.ts` — используются всеми последующими задачами.

- [ ] **Step 1: Создать файлы каркаса**

`package.json` (корень):

```json
{
  "name": "xray-ui-editor",
  "private": true,
  "workspaces": ["backend"],
  "scripts": {
    "test": "npm test --workspace backend",
    "dev": "npm run dev --workspace backend",
    "build": "npm run build --workspace backend"
  }
}
```

`.gitignore`:

```
node_modules/
dist/
data/
.env
```

`backend/package.json`:

```json
{
  "name": "@xray-ui-editor/backend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm --target node22 --clean",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fastify/cookie": "^11.0.2",
    "@fastify/rate-limit": "^10.2.2",
    "@fastify/static": "^8.1.1",
    "bcryptjs": "^3.0.2",
    "fastify": "^5.3.2",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "tsup": "^8.4.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

`backend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`backend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
```

- [ ] **Step 2: Установить зависимости**

Run: `npm install`
Expected: `node_modules` создан, lock-файл в корне, без ошибок.

- [ ] **Step 3: Написать падающий тест конфигурации**

`backend/test/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const validEnv = {
  REMNAWAVE_URL: 'https://panel.example.com/',
  REMNAWAVE_TOKEN: 'secret-token',
  APP_PASSWORD: 'super-secret-1',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
}

describe('loadConfig', () => {
  it('парсит валидное окружение и подставляет дефолты', () => {
    const config = loadConfig(validEnv)
    expect(config.remnawaveUrl).toBe('https://panel.example.com') // без хвостового слэша
    expect(config.remnawaveToken).toBe('secret-token')
    expect(config.port).toBe(3000)
    expect(config.dataDir).toBe('./data')
    expect(config.staticDir).toBe('./public')
    expect(config.sessionTtlSeconds).toBe(604800)
  })

  it('уважает переопределения PORT и DATA_DIR', () => {
    const config = loadConfig({ ...validEnv, PORT: '8080', DATA_DIR: '/data' })
    expect(config.port).toBe(8080)
    expect(config.dataDir).toBe('/data')
  })

  it('падает с русским сообщением при отсутствии REMNAWAVE_TOKEN', () => {
    const { REMNAWAVE_TOKEN: _omit, ...rest } = validEnv
    expect(() => loadConfig(rest)).toThrow(/Некорректная конфигурация окружения/)
  })

  it('падает при коротком SESSION_SECRET', () => {
    expect(() => loadConfig({ ...validEnv, SESSION_SECRET: 'short' })).toThrow(
      /Некорректная конфигурация окружения/,
    )
  })
})
```

- [ ] **Step 4: Убедиться, что тест падает**

Run: `npm test --workspace backend`
Expected: FAIL — `Cannot find module '../src/config.js'` (или аналогичное).

- [ ] **Step 5: Реализовать loadConfig**

`backend/src/config.ts`:

```ts
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  REMNAWAVE_URL: z.string().url(),
  REMNAWAVE_TOKEN: z.string().min(1),
  APP_PASSWORD: z.string().min(8),
  SESSION_SECRET: z.string().min(32),
  DATA_DIR: z.string().default('./data'),
  STATIC_DIR: z.string().default('./public'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
})

export interface AppConfig {
  port: number
  remnawaveUrl: string
  remnawaveToken: string
  appPassword: string
  sessionSecret: string
  dataDir: string
  staticDir: string
  sessionTtlSeconds: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(`Некорректная конфигурация окружения: ${issues}`)
  }
  const e = parsed.data
  return {
    port: e.PORT,
    remnawaveUrl: e.REMNAWAVE_URL.replace(/\/+$/, ''),
    remnawaveToken: e.REMNAWAVE_TOKEN,
    appPassword: e.APP_PASSWORD,
    sessionSecret: e.SESSION_SECRET,
    dataDir: e.DATA_DIR,
    staticDir: e.STATIC_DIR,
    sessionTtlSeconds: e.SESSION_TTL_SECONDS,
  }
}
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npm test --workspace backend`
Expected: PASS (4 теста).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore backend
git commit -m "feat(backend): monorepo scaffolding and env config loading"
```

---

### Task 2: Fastify-сервер и /health

**Files:**
- Create: `backend/src/server.ts`, `backend/src/index.ts`, `backend/test/helpers.ts`
- Test: `backend/test/server.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `loadConfig` из Task 1.
- Produces: `buildServer(config: AppConfig): Promise<FastifyInstance>` из `backend/src/server.ts`; `makeTestConfig(overrides?: Partial<AppConfig>): AppConfig` из `backend/test/helpers.ts`. Последующие задачи расширяют `buildServer` вторым необязательным параметром `deps`.

- [ ] **Step 1: Написать падающий тест**

`backend/test/helpers.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppConfig } from '../src/config.js'

export const TEST_PASSWORD = 'test-password-123'

export function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    remnawaveUrl: 'http://panel.test',
    remnawaveToken: 'test-token',
    appPassword: TEST_PASSWORD,
    sessionSecret: '0123456789abcdef0123456789abcdef',
    dataDir: mkdtempSync(join(tmpdir(), 'xui-data-')),
    staticDir: join(process.cwd(), 'public'),
    sessionTtlSeconds: 3600,
    ...overrides,
  }
}
```

`backend/test/server.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { makeTestConfig } from './helpers.js'

describe('server', () => {
  it('отвечает на /health', async () => {
    const app = await buildServer(makeTestConfig())
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace backend`
Expected: FAIL — `Cannot find module '../src/server.js'`.

- [ ] **Step 3: Реализовать сервер**

`backend/src/server.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import type { AppConfig } from './config.js'

export async function buildServer(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  await app.register(cookie, { secret: config.sessionSecret })
  await app.register(rateLimit, { global: false })

  app.get('/health', async () => ({ status: 'ok' }))

  return app
}
```

`backend/src/index.ts`:

```ts
import { loadConfig } from './config.js'
import { buildServer } from './server.js'

const config = loadConfig()
const app = await buildServer(config)
await app.listen({ port: config.port, host: '0.0.0.0' })
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Проверить типы**

Run: `npm run typecheck --workspace backend`
Expected: без ошибок.

- [ ] **Step 6: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(backend): fastify server with /health endpoint"
```

---

### Task 3: Проверка пароля и маршруты авторизации

**Files:**
- Create: `backend/src/auth/password.ts`, `backend/src/auth/session.ts`, `backend/src/auth/routes.ts`
- Modify: `backend/src/server.ts` (регистрация authRoutes), `backend/test/helpers.ts` (добавить `loginCookie`)
- Test: `backend/test/password.test.ts`, `backend/test/auth.test.ts`

**Interfaces:**
- Consumes: `buildServer`, `makeTestConfig`, `TEST_PASSWORD`.
- Produces:
  - `verifyPassword(candidate: string, stored: string): Promise<boolean>` — bcrypt, если `stored` начинается с `$2`, иначе константное по времени сравнение.
  - `SESSION_COOKIE = 'xui_session'` и `isAuthenticated(req: FastifyRequest, ttlSeconds: number): boolean` из `backend/src/auth/session.ts`.
  - Плагин `authRoutes: FastifyPluginAsync<{ config: AppConfig }>`: `POST /api/auth/login` (`{password}` → cookie + `{ok:true}` | 401), `POST /api/auth/logout`, `GET /api/auth/me` → `{authenticated:true}`.
  - `loginCookie(app: FastifyInstance, password?: string): Promise<string>` из helpers.

- [ ] **Step 1: Написать падающие тесты**

`backend/test/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import { verifyPassword } from '../src/auth/password.js'

describe('verifyPassword', () => {
  it('сравнивает открытый пароль', async () => {
    expect(await verifyPassword('secret-123', 'secret-123')).toBe(true)
    expect(await verifyPassword('wrong', 'secret-123')).toBe(false)
  })

  it('поддерживает bcrypt-хэш', async () => {
    const hash = await bcrypt.hash('secret-123', 8)
    expect(await verifyPassword('secret-123', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})
```

`backend/test/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { makeTestConfig, TEST_PASSWORD, loginCookie } from './helpers.js'

describe('auth routes', () => {
  it('логин с верным паролем ставит cookie', async () => {
    const app = await buildServer(makeTestConfig())
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['set-cookie']).toBeDefined()
    expect(String(res.headers['set-cookie'])).toContain('xui_session')
    await app.close()
  })

  it('логин с неверным паролем — 401 по-русски', async () => {
    const app = await buildServer(makeTestConfig())
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong-password' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().message).toBe('Неверный пароль')
    await app.close()
  })

  it('logout очищает cookie', async () => {
    const app = await buildServer(makeTestConfig())
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(String(res.headers['set-cookie'])).toContain('xui_session=;')
    await app.close()
  })
})
```

Добавить в `backend/test/helpers.ts`:

```ts
import type { FastifyInstance } from 'fastify'

export async function loginCookie(
  app: FastifyInstance,
  password: string = TEST_PASSWORD,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password },
  })
  const setCookie = res.headers['set-cookie']
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie
  if (!header) throw new Error('Логин не вернул cookie')
  return header.split(';')[0]!
}
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace backend`
Expected: FAIL — модули `auth/password.js`, роуты не найдены.

- [ ] **Step 3: Реализовать**

`backend/src/auth/password.ts`:

```ts
import bcrypt from 'bcryptjs'
import { timingSafeEqual } from 'node:crypto'

export async function verifyPassword(candidate: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$2')) {
    return bcrypt.compare(candidate, stored)
  }
  const a = Buffer.from(candidate)
  const b = Buffer.from(stored)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

`backend/src/auth/session.ts`:

```ts
import type { FastifyRequest } from 'fastify'

export const SESSION_COOKIE = 'xui_session'

export function isAuthenticated(req: FastifyRequest, ttlSeconds: number): boolean {
  const raw = req.cookies[SESSION_COOKIE]
  if (!raw) return false
  const { valid, value } = req.unsignCookie(raw)
  if (!valid || !value) return false
  const issuedAt = Number(value)
  if (!Number.isFinite(issuedAt)) return false
  return Date.now() - issuedAt < ttlSeconds * 1000
}
```

`backend/src/auth/routes.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../config.js'
import { verifyPassword } from './password.js'
import { SESSION_COOKIE } from './session.js'

const loginSchema = z.object({ password: z.string().min(1) })

export const authRoutes: FastifyPluginAsync<{ config: AppConfig }> = async (app, opts) => {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { password } = loginSchema.parse(req.body)
      if (!(await verifyPassword(password, opts.config.appPassword))) {
        return reply.status(401).send({ message: 'Неверный пароль' })
      }
      reply.setCookie(SESSION_COOKIE, String(Date.now()), {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: opts.config.sessionTtlSeconds,
      })
      return { ok: true }
    },
  )

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/auth/me', async () => ({ authenticated: true }))
}
```

В `backend/src/server.ts` после `app.get('/health', ...)` добавить:

```ts
import { authRoutes } from './auth/routes.js'
// ...внутри buildServer:
  await app.register(authRoutes, { config })
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(backend): password auth with signed session cookie"
```

---

### Task 4: Guard для /api/* и rate limit логина

**Files:**
- Create: `backend/src/auth/guard.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/test/guard.test.ts`

**Interfaces:**
- Consumes: `isAuthenticated`, `SESSION_COOKIE`, `authRoutes`, `loginCookie`.
- Produces: `registerAuthGuard(app: FastifyInstance, ttlSeconds: number): void` — onRequest-хук: все `/api/*`, кроме `/api/auth/login`, требуют валидной сессии, иначе 401 `{message: 'Требуется вход'}`. `/health` и не-API пути не трогает.

- [ ] **Step 1: Написать падающие тесты**

`backend/test/guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { makeTestConfig, loginCookie } from './helpers.js'

describe('auth guard', () => {
  it('без cookie /api/auth/me возвращает 401', async () => {
    const app = await buildServer(makeTestConfig())
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json().message).toBe('Требуется вход')
    await app.close()
  })

  it('с cookie /api/auth/me возвращает 200', async () => {
    const app = await buildServer(makeTestConfig())
    const cookie = await loginCookie(app)
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ authenticated: true })
    await app.close()
  })

  it('просроченная сессия отклоняется', async () => {
    const app = await buildServer(makeTestConfig({ sessionTtlSeconds: 0 }))
    const cookie = await loginCookie(app)
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('/health открыт без сессии', async () => {
    const app = await buildServer(makeTestConfig())
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('логин ограничен по частоте: 6-я попытка — 429', async () => {
    const app = await buildServer(makeTestConfig())
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'wrong' },
      })
      expect(res.statusCode).toBe(401)
    }
    const res6 = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong' },
    })
    expect(res6.statusCode).toBe(429)
    await app.close()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace backend`
Expected: FAIL — `/api/auth/me` без cookie сейчас отвечает 200; модуль guard отсутствует.

- [ ] **Step 3: Реализовать guard**

`backend/src/auth/guard.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { isAuthenticated } from './session.js'

const PUBLIC_API_PATHS = ['/api/auth/login']

export function registerAuthGuard(app: FastifyInstance, ttlSeconds: number): void {
  app.addHook('onRequest', async (req, reply) => {
    const url = req.raw.url ?? ''
    if (!url.startsWith('/api/')) return
    if (PUBLIC_API_PATHS.some((p) => url === p || url.startsWith(`${p}?`))) return
    if (!isAuthenticated(req, ttlSeconds)) {
      return reply.status(401).send({ message: 'Требуется вход' })
    }
  })
}
```

В `backend/src/server.ts` — после регистрации cookie/rateLimit, до регистрации маршрутов:

```ts
import { registerAuthGuard } from './auth/guard.js'
// ...внутри buildServer:
  registerAuthGuard(app, config.sessionTtlSeconds)
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(backend): auth guard for /api and login rate limit"
```

---

### Task 5: Клиент Remnawave API

**Files:**
- Create: `backend/src/remnawave/types.ts`, `backend/src/remnawave/client.ts`
- Test: `backend/test/remnawave-client.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts
export interface PanelInbound {
  uuid: string; profileUuid: string; tag: string; type: string;
  network: string | null; security: string | null; port: number | null;
  rawInbound: unknown;
}
export interface PanelNodeRef { uuid: string; name: string; countryCode: string }
export interface ConfigProfile {
  uuid: string; viewPosition: number; name: string; config: unknown;
  inbounds: PanelInbound[]; nodes: PanelNodeRef[];
  createdAt: string; updatedAt: string;
}
export interface RemnawavePort {
  listProfiles(): Promise<ConfigProfile[]>
  getProfile(uuid: string): Promise<ConfigProfile>
  createProfile(name: string, config: unknown): Promise<ConfigProfile>
  updateProfile(input: { uuid: string; name?: string; config?: unknown }): Promise<ConfigProfile>
  deleteProfile(uuid: string): Promise<void>
  getNodes(): Promise<unknown[]>
  getSquads(): Promise<unknown[]>
}
```

  - `RemnawaveError extends Error { status: number; details?: unknown }`
  - `RemnawaveClient implements RemnawavePort`, конструктор `{ baseUrl: string; token: string; fetchImpl?: typeof fetch }`.

- [ ] **Step 1: Написать падающие тесты**

`backend/test/remnawave-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RemnawaveClient, RemnawaveError } from '../src/remnawave/client.js'

interface FakeCall { url: string; init: RequestInit }

function fakeFetch(
  handler: (url: string, init: RequestInit) => { status: number; body?: unknown },
  calls: FakeCall[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init: init ?? {} })
    const r = handler(url, init ?? {})
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

const profile = {
  uuid: 'a1b2c3d4-0000-0000-0000-000000000001',
  viewPosition: 0,
  name: 'Germany',
  config: { inbounds: [] },
  inbounds: [],
  nodes: [],
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
}

describe('RemnawaveClient', () => {
  it('listProfiles шлёт Bearer-токен и разворачивает response', async () => {
    const calls: FakeCall[] = []
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 'tok-123',
      fetchImpl: fakeFetch(
        () => ({ status: 200, body: { response: { total: 1, configProfiles: [profile] } } }),
        calls,
      ),
    })
    const profiles = await client.listProfiles()
    expect(profiles).toEqual([profile])
    expect(calls[0]!.url).toBe('http://panel.test/api/config-profiles')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok-123')
  })

  it('getProfile разворачивает response', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 200, body: { response: profile } })),
    })
    expect(await client.getProfile(profile.uuid)).toEqual(profile)
  })

  it('createProfile отправляет POST {name, config}', async () => {
    const calls: FakeCall[] = []
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 201, body: { response: profile } }), calls),
    })
    await client.createProfile('Germany', { inbounds: [] })
    expect(calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      name: 'Germany',
      config: { inbounds: [] },
    })
  })

  it('updateProfile отправляет PATCH {uuid, config} на /api/config-profiles', async () => {
    const calls: FakeCall[] = []
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 200, body: { response: profile } }), calls),
    })
    await client.updateProfile({ uuid: profile.uuid, config: { inbounds: [] } })
    expect(calls[0]!.url).toBe('http://panel.test/api/config-profiles')
    expect(calls[0]!.init.method).toBe('PATCH')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      uuid: profile.uuid,
      config: { inbounds: [] },
    })
  })

  it('ошибка панели превращается в RemnawaveError с её статусом и сообщением', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 404, body: { message: 'Config profile not found' } })),
    })
    const err = await client.getProfile('missing').catch((e) => e)
    expect(err).toBeInstanceOf(RemnawaveError)
    expect(err.status).toBe(404)
    expect(err.message).toBe('Config profile not found')
  })

  it('сетевая ошибка превращается в RemnawaveError 502 по-русски', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED')
      }) as typeof fetch,
    })
    const err = await client.listProfiles().catch((e) => e)
    expect(err).toBeInstanceOf(RemnawaveError)
    expect(err.status).toBe(502)
    expect(err.message).toBe('Панель Remnawave недоступна')
  })

  it('getSquads разворачивает internalSquads, getNodes — массив response', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch((url) => {
        if (url.endsWith('/api/nodes')) return { status: 200, body: { response: [{ uuid: 'n1' }] } }
        return { status: 200, body: { response: { total: 1, internalSquads: [{ uuid: 's1' }] } } }
      }),
    })
    expect(await client.getNodes()).toEqual([{ uuid: 'n1' }])
    expect(await client.getSquads()).toEqual([{ uuid: 's1' }])
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace backend`
Expected: FAIL — модуль `remnawave/client.js` не найден.

- [ ] **Step 3: Реализовать типы и клиент**

`backend/src/remnawave/types.ts` — ровно как в блоке Interfaces выше.

`backend/src/remnawave/client.ts`:

```ts
import type { ConfigProfile, RemnawavePort } from './types.js'

export class RemnawaveError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'RemnawaveError'
  }
}

interface ClientOptions {
  baseUrl: string
  token: string
  fetchImpl?: typeof fetch
}

export class RemnawaveClient implements RemnawavePort {
  constructor(private opts: ClientOptions) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const doFetch = this.opts.fetchImpl ?? fetch
    let res: Response
    try {
      res = await doFetch(`${this.opts.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.opts.token}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      throw new RemnawaveError(502, 'Панель Remnawave недоступна', String(err))
    }
    const text = await res.text()
    let json: unknown
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    if (!res.ok) {
      const message =
        (json as { message?: string } | undefined)?.message ?? `Панель ответила ${res.status}`
      throw new RemnawaveError(res.status, message, json ?? text)
    }
    return json as T
  }

  async listProfiles(): Promise<ConfigProfile[]> {
    const r = await this.request<{ response: { configProfiles: ConfigProfile[] } }>(
      'GET',
      '/api/config-profiles',
    )
    return r.response.configProfiles
  }

  async getProfile(uuid: string): Promise<ConfigProfile> {
    const r = await this.request<{ response: ConfigProfile }>(
      'GET',
      `/api/config-profiles/${uuid}`,
    )
    return r.response
  }

  async createProfile(name: string, config: unknown): Promise<ConfigProfile> {
    const r = await this.request<{ response: ConfigProfile }>('POST', '/api/config-profiles', {
      name,
      config,
    })
    return r.response
  }

  async updateProfile(input: {
    uuid: string
    name?: string
    config?: unknown
  }): Promise<ConfigProfile> {
    const r = await this.request<{ response: ConfigProfile }>(
      'PATCH',
      '/api/config-profiles',
      input,
    )
    return r.response
  }

  async deleteProfile(uuid: string): Promise<void> {
    await this.request<{ response: { isDeleted: boolean } }>(
      'DELETE',
      `/api/config-profiles/${uuid}`,
    )
  }

  async getNodes(): Promise<unknown[]> {
    const r = await this.request<{ response: unknown[] }>('GET', '/api/nodes')
    return r.response
  }

  async getSquads(): Promise<unknown[]> {
    const r = await this.request<{ response: { internalSquads: unknown[] } }>(
      'GET',
      '/api/internal-squads',
    )
    return r.response.internalSquads
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(backend): typed Remnawave API client"
```

---

### Task 6: Маршруты профилей и контекста панели

**Files:**
- Create: `backend/src/routes/profiles.ts`, `backend/src/routes/panel.ts`, `backend/test/stub-remnawave.ts`
- Modify: `backend/src/server.ts` (deps, декоратор, error handler, регистрация)
- Test: `backend/test/profiles-routes.test.ts`

**Interfaces:**
- Consumes: `RemnawavePort`, `ConfigProfile`, `RemnawaveError`, `loginCookie`, `makeTestConfig`.
- Produces:
  - `buildServer(config: AppConfig, deps?: { remnawave?: RemnawavePort; backups?: BackupService })` — второй параметр появляется здесь (поле `backups` задействуется в Task 8; в этой задаче объяви deps как `{ remnawave?: RemnawavePort }`).
  - Декоратор `app.remnawave: RemnawavePort`.
  - Маршруты: `GET /api/profiles` → `{profiles}`, `GET /api/profiles/:uuid` → `{profile}`, `POST /api/profiles` → 201 `{profile}`, `DELETE /api/profiles/:uuid` → `{ok:true}`, `GET /api/nodes` → `{nodes}`, `GET /api/squads` → `{squads}`.
  - Error handler: `RemnawaveError` → её статус + `{message, details}`; `ZodError` → 400 `{message: 'Некорректный запрос', issues}`.
  - `makeStubRemnawave(initial?: ConfigProfile[]): RemnawavePort & { profiles: ConfigProfile[] }` из `backend/test/stub-remnawave.ts`.

- [ ] **Step 1: Написать стаб и падающие тесты**

`backend/test/stub-remnawave.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { RemnawaveError } from '../src/remnawave/client.js'
import type { ConfigProfile, RemnawavePort } from '../src/remnawave/types.js'

export function makeProfile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    uuid: randomUUID(),
    viewPosition: 0,
    name: 'Test Profile',
    config: { inbounds: [], outbounds: [] },
    inbounds: [],
    nodes: [],
    createdAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T10:00:00.000Z',
    ...overrides,
  }
}

export function makeStubRemnawave(
  initial: ConfigProfile[] = [],
): RemnawavePort & { profiles: ConfigProfile[] } {
  const profiles = [...initial]
  const find = (uuid: string) => {
    const p = profiles.find((x) => x.uuid === uuid)
    if (!p) throw new RemnawaveError(404, 'Config profile not found')
    return p
  }
  return {
    profiles,
    async listProfiles() {
      return profiles
    },
    async getProfile(uuid) {
      return find(uuid)
    },
    async createProfile(name, config) {
      const p = makeProfile({ name, config })
      profiles.push(p)
      return p
    },
    async updateProfile({ uuid, name, config }) {
      const p = find(uuid)
      if (name !== undefined) p.name = name
      if (config !== undefined) p.config = config
      p.updatedAt = new Date().toISOString()
      return p
    },
    async deleteProfile(uuid) {
      const i = profiles.findIndex((x) => x.uuid === uuid)
      if (i === -1) throw new RemnawaveError(404, 'Config profile not found')
      profiles.splice(i, 1)
    },
    async getNodes() {
      return [{ uuid: 'node-1', name: 'DE-1', countryCode: 'DE' }]
    },
    async getSquads() {
      return [{ uuid: 'squad-1', name: 'Default' }]
    },
  }
}
```

`backend/test/profiles-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { makeTestConfig, loginCookie } from './helpers.js'
import { makeProfile, makeStubRemnawave } from './stub-remnawave.js'

async function makeApp(stub = makeStubRemnawave()) {
  const app = await buildServer(makeTestConfig(), { remnawave: stub })
  const cookie = await loginCookie(app)
  return { app, cookie, stub }
}

describe('profile routes', () => {
  it('GET /api/profiles возвращает список', async () => {
    const p = makeProfile({ name: 'Germany' })
    const { app, cookie } = await makeApp(makeStubRemnawave([p]))
    const res = await app.inject({ method: 'GET', url: '/api/profiles', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().profiles).toHaveLength(1)
    expect(res.json().profiles[0].name).toBe('Germany')
    await app.close()
  })

  it('GET /api/profiles без сессии — 401', async () => {
    const { app } = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/api/profiles' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('GET /api/profiles/:uuid — 404 от панели пробрасывается', async () => {
    const { app, cookie } = await makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/profiles/00000000-0000-0000-0000-000000000000',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().message).toBe('Config profile not found')
    await app.close()
  })

  it('POST /api/profiles создаёт профиль (201)', async () => {
    const { app, cookie, stub } = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { cookie },
      payload: { name: 'New Profile', config: { inbounds: [] } },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().profile.name).toBe('New Profile')
    expect(stub.profiles).toHaveLength(1)
    await app.close()
  })

  it('POST /api/profiles с некорректным именем — 400', async () => {
    const { app, cookie } = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { cookie },
      payload: { name: 'Кириллица!', config: {} },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Некорректный запрос')
    await app.close()
  })

  it('DELETE /api/profiles/:uuid удаляет', async () => {
    const p = makeProfile()
    const { app, cookie, stub } = await makeApp(makeStubRemnawave([p]))
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${p.uuid}`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(stub.profiles).toHaveLength(0)
    await app.close()
  })

  it('GET /api/nodes и /api/squads возвращают контекст', async () => {
    const { app, cookie } = await makeApp()
    const nodes = await app.inject({ method: 'GET', url: '/api/nodes', headers: { cookie } })
    const squads = await app.inject({ method: 'GET', url: '/api/squads', headers: { cookie } })
    expect(nodes.json().nodes).toEqual([{ uuid: 'node-1', name: 'DE-1', countryCode: 'DE' }])
    expect(squads.json().squads).toEqual([{ uuid: 'squad-1', name: 'Default' }])
    await app.close()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace backend`
Expected: FAIL — buildServer не принимает deps, маршруты отсутствуют.

- [ ] **Step 3: Реализовать маршруты и deps**

`backend/src/routes/profiles.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const paramsSchema = z.object({ uuid: z.string().uuid() })

const createSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_\s-]+$/, 'Имя: латиница, цифры, пробел, - и _'),
  config: z.record(z.unknown()),
})

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/profiles', async () => ({ profiles: await app.remnawave.listProfiles() }))

  app.get('/api/profiles/:uuid', async (req) => {
    const { uuid } = paramsSchema.parse(req.params)
    return { profile: await app.remnawave.getProfile(uuid) }
  })

  app.post('/api/profiles', async (req, reply) => {
    const body = createSchema.parse(req.body)
    const profile = await app.remnawave.createProfile(body.name, body.config)
    reply.status(201)
    return { profile }
  })

  app.delete('/api/profiles/:uuid', async (req) => {
    const { uuid } = paramsSchema.parse(req.params)
    await app.remnawave.deleteProfile(uuid)
    return { ok: true }
  })
}
```

`backend/src/routes/panel.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify'

export const panelRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/nodes', async () => ({ nodes: await app.remnawave.getNodes() }))
  app.get('/api/squads', async () => ({ squads: await app.remnawave.getSquads() }))
}
```

`backend/src/server.ts` — целиком после правок:

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import type { AppConfig } from './config.js'
import { authRoutes } from './auth/routes.js'
import { registerAuthGuard } from './auth/guard.js'
import { RemnawaveClient, RemnawaveError } from './remnawave/client.js'
import type { RemnawavePort } from './remnawave/types.js'
import { profileRoutes } from './routes/profiles.js'
import { panelRoutes } from './routes/panel.js'

declare module 'fastify' {
  interface FastifyInstance {
    remnawave: RemnawavePort
  }
}

export interface ServerDeps {
  remnawave?: RemnawavePort
}

export async function buildServer(
  config: AppConfig,
  deps: ServerDeps = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  await app.register(cookie, { secret: config.sessionSecret })
  await app.register(rateLimit, { global: false })

  app.decorate(
    'remnawave',
    deps.remnawave ??
      new RemnawaveClient({ baseUrl: config.remnawaveUrl, token: config.remnawaveToken }),
  )

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof RemnawaveError) {
      return reply.status(err.status).send({ message: err.message, details: err.details })
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ message: 'Некорректный запрос', issues: err.issues })
    }
    req.log.error(err)
    const status =
      'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500
    return reply.status(status).send({ message: err.message || 'Внутренняя ошибка' })
  })

  registerAuthGuard(app, config.sessionTtlSeconds)

  app.get('/health', async () => ({ status: 'ok' }))

  await app.register(authRoutes, { config })
  await app.register(profileRoutes)
  await app.register(panelRoutes)

  return app
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace backend`
Expected: PASS (все файлы, включая прежние).

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(backend): profile CRUD and panel context routes"
```

---

### Task 7: Сервис бэкапов

**Files:**
- Create: `backend/src/backups/service.ts`
- Test: `backend/test/backups.test.ts`

**Interfaces:**
- Consumes: `ConfigProfile` из Task 5.
- Produces:

```ts
export interface BackupEntry { file: string; savedAt: string; profileName: string }
export class BackupService {
  constructor(dataDir: string)
  saveBackup(profile: ConfigProfile): Promise<string>          // имя файла
  list(profileUuid: string): Promise<BackupEntry[]>            // новые первыми
  read(profileUuid: string, file: string): Promise<{ savedAt: string; profile: ConfigProfile }>
}
```

- [ ] **Step 1: Написать падающие тесты**

`backend/test/backups.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BackupService } from '../src/backups/service.js'
import { makeProfile } from './stub-remnawave.js'

function makeService() {
  return new BackupService(mkdtempSync(join(tmpdir(), 'xui-backup-')))
}

describe('BackupService', () => {
  it('сохраняет и читает бэкап', async () => {
    const svc = makeService()
    const profile = makeProfile({ name: 'Germany' })
    const file = await svc.saveBackup(profile)
    const saved = await svc.read(profile.uuid, file)
    expect(saved.profile).toEqual(profile)
    expect(saved.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('list возвращает записи, новые первыми', async () => {
    const svc = makeService()
    const profile = makeProfile({ name: 'Germany' })
    const f1 = await svc.saveBackup(profile)
    await new Promise((r) => setTimeout(r, 5))
    const f2 = await svc.saveBackup(profile)
    const list = await svc.list(profile.uuid)
    expect(list.map((e) => e.file)).toEqual([f2, f1])
    expect(list[0]!.profileName).toBe('Germany')
  })

  it('list для профиля без бэкапов — пустой массив', async () => {
    const svc = makeService()
    expect(await svc.list('00000000-0000-0000-0000-000000000000')).toEqual([])
  })

  it('read отклоняет path traversal в имени файла', async () => {
    const svc = makeService()
    await expect(svc.read('uuid', '../../etc/passwd')).rejects.toThrow(
      /Некорректное имя файла/,
    )
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace backend`
Expected: FAIL — модуль `backups/service.js` не найден.

- [ ] **Step 3: Реализовать сервис**

`backend/src/backups/service.ts`:

```ts
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConfigProfile } from '../remnawave/types.js'

export interface BackupEntry {
  file: string
  savedAt: string
  profileName: string
}

interface BackupFile {
  savedAt: string
  profile: ConfigProfile
}

const SAFE_FILE = /^[A-Za-z0-9_-]+\.json$/

export class BackupService {
  constructor(private dataDir: string) {}

  private dirFor(profileUuid: string): string {
    return join(this.dataDir, 'backups', profileUuid)
  }

  async saveBackup(profile: ConfigProfile): Promise<string> {
    const dir = this.dirFor(profile.uuid)
    await mkdir(dir, { recursive: true })
    const savedAt = new Date().toISOString()
    const file = `${savedAt.replace(/[:.]/g, '-')}.json`
    const payload: BackupFile = { savedAt, profile }
    await writeFile(join(dir, file), JSON.stringify(payload, null, 2), 'utf8')
    return file
  }

  async list(profileUuid: string): Promise<BackupEntry[]> {
    let files: string[]
    try {
      files = await readdir(this.dirFor(profileUuid))
    } catch {
      return []
    }
    const entries: BackupEntry[] = []
    for (const file of files.filter((f) => SAFE_FILE.test(f))) {
      const data = await this.read(profileUuid, file)
      entries.push({ file, savedAt: data.savedAt, profileName: data.profile.name })
    }
    return entries.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
  }

  async read(profileUuid: string, file: string): Promise<BackupFile> {
    if (!SAFE_FILE.test(file)) {
      throw new Error('Некорректное имя файла бэкапа')
    }
    const raw = await readFile(join(this.dirFor(profileUuid), file), 'utf8')
    return JSON.parse(raw) as BackupFile
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(backend): filesystem backup service for config profiles"
```

---

### Task 8: PATCH с конфликт-детектом, автобэкапом и маршруты бэкапов

**Files:**
- Modify: `backend/src/routes/profiles.ts` (PATCH), `backend/src/server.ts` (декоратор backups, deps)
- Create: `backend/src/routes/backups.ts`
- Test: `backend/test/update-profile.test.ts`

**Interfaces:**
- Consumes: `BackupService`, `makeStubRemnawave`, `makeProfile`.
- Produces:
  - `buildServer(config, deps?: { remnawave?: RemnawavePort; backups?: BackupService })`, декоратор `app.backups: BackupService`.
  - `PATCH /api/profiles/:uuid` body `{ config?, name?, expectedUpdatedAt: string }`:
    409 `{message, current}` при `current.updatedAt !== expectedUpdatedAt`; иначе бэкап текущей версии → PATCH панели → `{profile}`.
  - `GET /api/profiles/:uuid/backups` → `{backups: BackupEntry[]}`; `GET /api/profiles/:uuid/backups/:file` → `{savedAt, profile}`.

- [ ] **Step 1: Написать падающие тесты**

`backend/test/update-profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { BackupService } from '../src/backups/service.js'
import { makeTestConfig, loginCookie } from './helpers.js'
import { makeProfile, makeStubRemnawave } from './stub-remnawave.js'

async function makeApp() {
  const profile = makeProfile({ name: 'Germany' })
  const stub = makeStubRemnawave([profile])
  const config = makeTestConfig()
  const backups = new BackupService(config.dataDir)
  const app = await buildServer(config, { remnawave: stub, backups })
  const cookie = await loginCookie(app)
  return { app, cookie, stub, backups, profile }
}

describe('PATCH /api/profiles/:uuid', () => {
  it('обновляет конфиг при совпадении expectedUpdatedAt и делает бэкап', async () => {
    const { app, cookie, backups, profile } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${profile.uuid}`,
      headers: { cookie },
      payload: {
        config: { inbounds: [{ tag: 'vless-in' }] },
        expectedUpdatedAt: profile.updatedAt,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().profile.config).toEqual({ inbounds: [{ tag: 'vless-in' }] })

    const list = await backups.list(profile.uuid)
    expect(list).toHaveLength(1)
    const saved = await backups.read(profile.uuid, list[0]!.file)
    expect(saved.profile.config).toEqual({ inbounds: [], outbounds: [] }) // версия ДО правки
    await app.close()
  })

  it('возвращает 409 с актуальной версией при конфликте', async () => {
    const { app, cookie, backups, profile } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${profile.uuid}`,
      headers: { cookie },
      payload: { config: {}, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toBe('Профиль был изменён в панели после открытия')
    expect(res.json().current.uuid).toBe(profile.uuid)
    expect(await backups.list(profile.uuid)).toHaveLength(0) // бэкап не создан
    await app.close()
  })

  it('без expectedUpdatedAt — 400', async () => {
    const { app, cookie, profile } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${profile.uuid}`,
      headers: { cookie },
      payload: { config: {} },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('backup routes', () => {
  it('отдаёт список и содержимое бэкапов', async () => {
    const { app, cookie, profile } = await makeApp()
    await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${profile.uuid}`,
      headers: { cookie },
      payload: { config: { inbounds: [] }, expectedUpdatedAt: profile.updatedAt },
    })
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/profiles/${profile.uuid}/backups`,
      headers: { cookie },
    })
    expect(listRes.statusCode).toBe(200)
    expect(listRes.json().backups).toHaveLength(1)

    const file = listRes.json().backups[0].file
    const readRes = await app.inject({
      method: 'GET',
      url: `/api/profiles/${profile.uuid}/backups/${file}`,
      headers: { cookie },
    })
    expect(readRes.statusCode).toBe(200)
    expect(readRes.json().profile.name).toBe('Germany')
    await app.close()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace backend`
Expected: FAIL — PATCH-маршрут и deps.backups отсутствуют.

- [ ] **Step 3: Реализовать**

В `backend/src/routes/profiles.ts` добавить:

```ts
const updateSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_\s-]+$/)
    .optional(),
  config: z.record(z.unknown()).optional(),
  expectedUpdatedAt: z.string().min(1),
})

// внутри profileRoutes:
  app.patch('/api/profiles/:uuid', async (req, reply) => {
    const { uuid } = paramsSchema.parse(req.params)
    const body = updateSchema.parse(req.body)
    const current = await app.remnawave.getProfile(uuid)
    if (current.updatedAt !== body.expectedUpdatedAt) {
      return reply.status(409).send({
        message: 'Профиль был изменён в панели после открытия',
        current,
      })
    }
    await app.backups.saveBackup(current)
    const profile = await app.remnawave.updateProfile({
      uuid,
      name: body.name,
      config: body.config,
    })
    return { profile }
  })
```

`backend/src/routes/backups.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const listParams = z.object({ uuid: z.string().uuid() })
const readParams = z.object({ uuid: z.string().uuid(), file: z.string().min(1) })

export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/profiles/:uuid/backups', async (req) => {
    const { uuid } = listParams.parse(req.params)
    return { backups: await app.backups.list(uuid) }
  })

  app.get('/api/profiles/:uuid/backups/:file', async (req) => {
    const { uuid, file } = readParams.parse(req.params)
    return await app.backups.read(uuid, file)
  })
}
```

В `backend/src/server.ts`:

```ts
import { BackupService } from './backups/service.js'
import { backupRoutes } from './routes/backups.js'

declare module 'fastify' {
  interface FastifyInstance {
    remnawave: RemnawavePort
    backups: BackupService
  }
}

export interface ServerDeps {
  remnawave?: RemnawavePort
  backups?: BackupService
}

// внутри buildServer, рядом с декоратором remnawave:
  app.decorate('backups', deps.backups ?? new BackupService(config.dataDir))
// после panelRoutes:
  await app.register(backupRoutes)
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(backend): conflict-safe profile update with auto-backup"
```

---

### Task 9: Раздача статики и SPA-fallback

**Files:**
- Create: `backend/public/index.html`
- Modify: `backend/src/server.ts`
- Test: `backend/test/static.test.ts`

**Interfaces:**
- Consumes: `config.staticDir`.
- Produces: `GET /` отдаёт `index.html`; любой не-`/api` путь без файла → `index.html` (SPA-fallback); несуществующий `/api/*` → 404 JSON.

- [ ] **Step 1: Написать падающие тесты**

`backend/test/static.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { buildServer } from '../src/server.js'
import { makeTestConfig, loginCookie } from './helpers.js'

const staticDir = join(process.cwd(), 'public')

describe('static serving', () => {
  it('GET / отдаёт index.html', async () => {
    const app = await buildServer(makeTestConfig({ staticDir }))
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    await app.close()
  })

  it('неизвестный путь отдаёт index.html (SPA fallback)', async () => {
    const app = await buildServer(makeTestConfig({ staticDir }))
    const res = await app.inject({ method: 'GET', url: '/profiles/some-uuid' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    await app.close()
  })

  it('неизвестный /api-путь отдаёт 404 JSON', async () => {
    const app = await buildServer(makeTestConfig({ staticDir }))
    const cookie = await loginCookie(app)
    const res = await app.inject({ method: 'GET', url: '/api/nope', headers: { cookie } })
    expect(res.statusCode).toBe(404)
    expect(res.json().message).toBe('Не найдено')
    await app.close()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace backend`
Expected: FAIL — `/` сейчас 404.

- [ ] **Step 3: Реализовать**

`backend/public/index.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Xray UI Editor</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0d1117;
        color: #e6edf3;
        font-family: system-ui, sans-serif;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Xray UI Editor</h1>
      <p>Бэкенд запущен. Интерфейс редактора будет добавлен на следующем этапе.</p>
    </main>
  </body>
</html>
```

В `backend/src/server.ts`:

```ts
import { resolve } from 'node:path'
import fastifyStatic from '@fastify/static'

// внутри buildServer, после регистрации API-маршрутов:
  await app.register(fastifyStatic, { root: resolve(config.staticDir) })

  app.setNotFoundHandler((req, reply) => {
    if ((req.raw.url ?? '').startsWith('/api/')) {
      return reply.status(404).send({ message: 'Не найдено' })
    }
    return reply.sendFile('index.html')
  })
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace backend`
Expected: PASS (все тесты проекта).

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test backend/public
git commit -m "feat(backend): static serving with SPA fallback"
```

---

### Task 10: Docker, Compose, .env.example, README

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.env.example`, `.dockerignore`, `README.md`

**Interfaces:**
- Consumes: `npm run build --workspace backend` (tsup → `backend/dist/index.js`), env-переменные из Task 1.
- Produces: рабочий деплой `docker compose up -d --build`; healthcheck по `GET /health`.

- [ ] **Step 1: Создать файлы**

`.dockerignore`:

```
node_modules
**/node_modules
**/dist
data
.env
.git
docs
```

`Dockerfile`:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --workspace backend
COPY backend backend
RUN npm run build --workspace backend

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --workspace backend --omit=dev
COPY --from=build /app/backend/dist backend/dist
COPY backend/public backend/public
WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

`docker-compose.yml`:

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "${PORT:-3000}:3000"
    env_file: .env
    environment:
      PORT: 3000
      DATA_DIR: /data
      STATIC_DIR: /app/backend/public
    volumes:
      - ./data:/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

`.env.example`:

```bash
# Адрес панели Remnawave (без хвостового слэша)
REMNAWAVE_URL=https://panel.example.com

# API-токен Remnawave (Панель → API Tokens). В браузер не попадает.
REMNAWAVE_TOKEN=

# Пароль входа в редактор. Либо открытый текст (мин. 8 символов),
# либо bcrypt-хэш (начинается с $2) — сгенерировать: npx bcrypt-cli "пароль" 12
APP_PASSWORD=

# Секрет подписи сессионных cookie, мин. 32 случайных символа:
# openssl rand -hex 32
SESSION_SECRET=

# Порт снаружи (внутри контейнера всегда 3000)
PORT=3000
```

`README.md`:

```markdown
# Xray UI Editor для Remnawave

Визуальный редактор Xray-конфигов (конфиг-профилей) панели
[Remnawave](https://remna.st) v2.8.0: топология трафика как граф,
формы вместо ручного JSON, сохранение напрямую в панель по API.

## Быстрый старт (VPS)

```bash
git clone <repo> && cd xray-ui-editor
cp .env.example .env
# заполнить .env: адрес панели, API-токен, пароль, секрет сессии
docker compose up -d --build
```

Редактор доступен на `http://<host>:3000`. Проверка: `curl http://<host>:3000/health`.

Бэкапы конфигов складываются в `./data/backups/<uuid-профиля>/` перед каждым
сохранением в панель.

## Разработка

```bash
npm install
npm test          # тесты бэкенда
npm run dev       # dev-сервер (нужен .env или переменные окружения)
```

## Безопасность

- Токен Remnawave живёт только на сервере (`.env`), в браузер не передаётся.
- Вход по паролю, сессия — подписанная httpOnly-cookie, rate-limit на логин.
- Рекомендуется закрыть порт reverse-proxy с TLS (Caddy/nginx) или firewall.
```

- [ ] **Step 2: Проверить сборку и запуск**

Run: `docker compose build`
Expected: образ собирается без ошибок.

Run: `cp .env.example .env` (заполнить тестовыми значениями: `REMNAWAVE_URL=https://example.com`, `REMNAWAVE_TOKEN=dummy`, `APP_PASSWORD=local-test-123`, `SESSION_SECRET=<64 hex>`), затем `docker compose up -d` и `curl http://localhost:3000/health`.
Expected: `{"status":"ok"}`; `docker compose ps` показывает состояние healthy (после start_period).

Run: `docker compose down`

- [ ] **Step 3: Убедиться, что тесты по-прежнему проходят**

Run: `npm test --workspace backend`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml .env.example .dockerignore README.md
git commit -m "feat: docker compose deployment"
```

---

## Что дальше (вне этого плана)

- **План 2 — ядро фронтенда:** Vite + React SPA (`frontend/`), Zod-модель Xray-конфига с passthrough, Zustand-стор, экран логина, список профилей, raw-JSON редактор (CodeMirror), подключение к этому бэкенду; Dockerfile дополняется стадией сборки фронта, `STATIC_DIR` указывает на `frontend/dist`.
- **План 3 — визуальный редактор:** топология React Flow, формы протоколов, diff перед сохранением, пресеты, генератор Reality-ключей.
