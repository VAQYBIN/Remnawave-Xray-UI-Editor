# Библиотека рецептов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать редактору пять готовых заготовок конфига (WARP, блок торрентов, блок рекламы, блок локальных сетей, цепочка через второй сервер), которые складываются с текущим конфигом, показывают заранее список изменений и откатываются одним Ctrl+Z.

**Architecture:** Чистый слой `entities/xray/recipes/` — функции `plan(config, params) → { config, changes, notes }`, не мутирующие вход; три примитива слияния (`ensureOutbound` / `ensureRule` / `ensureSniffing`) обеспечивают идемпотентность. UI — диалог `features/recipes/RecipesDialog.tsx` с кнопкой «+ Рецепт» в доке топологии; применение идёт через существующий `changeConfig` → `writeDraft(text, { history: true })`. Бэкенд добавляет одну ручку `POST /api/tools/warp-account` (регистрация бесплатного WARP-аккаунта через `net/guard.ts`).

**Tech Stack:** React 19 + TypeScript + zustand + @tanstack/react-query (фронт), Fastify 5 + zod + Node 24 (бэк), vitest + @testing-library/react, Playwright.

Спека: `docs/superpowers/specs/2026-07-25-recipes-design.md`.

## Global Constraints

- Язык UI, подсказок, сообщений об ошибках и комментариев — **русский**; коммиты — английский conventional style (`feat(frontend): ...`).
- Работаем в ветке `dev`. Мердж в `main` — только по прямой команде пользователя.
- Реальный `.env` не читаем и не коммитим.
- Слоевая чистота: `entities` **не импортирует** из `features`; `features` из `entities` — можно.
- Vitest фронтенда запускается **из каталога `frontend`** (там jsdom-окружение). Из корня репозитория тесты с DOM падают на `HTMLAnchorElement is not defined` и подобном.
- Кастомный `Select` в тестах — только через `selectOption()` / `optionLabels()` из `frontend/test/helpers.ts`, `userEvent.selectOptions` с ним не работает.
- Любой исходящий запрос бэкенда по адресу, пришедшему извне, идёт через `backend/src/net/guard.ts`. Обходить его нельзя.
- Уточнение спеки, принятое в этом плане: `RecipePlan.notes` — не `string[]`, а `RecipeNote[]` (`{ text: string; needsGeo?: true }`), чтобы диалог знал, где рисовать кнопку «Geo-базы».

---

### Task 1: Примитивы слияния и типы плана

**Files:**
- Create: `frontend/src/entities/xray/recipes/types.ts`
- Create: `frontend/src/entities/xray/recipes/apply.ts`
- Test: `frontend/test/recipes-apply.test.ts`

**Interfaces:**
- Consumes: `XrayConfig` из `frontend/src/entities/xray/config.ts`.
- Produces: `RecipeChange`, `RecipeNote`, `RecipePlan`, `MergeResult`, `RuleMergeResult`, `Outbound`, `Rule`, `ensureOutbound(config, outbound)`, `ensureRule(config, rule, placement)`, `ensureSniffing(config, tags)`, `sameRule(a, b)`, `ruleOrdinal(index)`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/recipes-apply.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  ensureOutbound,
  ensureRule,
  ensureSniffing,
  ruleOrdinal,
  sameRule,
} from '../src/entities/xray/recipes/apply'
import type { XrayConfig } from '../src/entities/xray'

const BASE: XrayConfig = {
  inbounds: [
    { tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } },
    { tag: 'ss-in', port: 8388, protocol: 'shadowsocks', settings: {} },
  ],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
} as XrayConfig

describe('ensureOutbound', () => {
  it('добавляет новый outbound и не трогает исходный конфиг', () => {
    const res = ensureOutbound(BASE, { tag: 'block', protocol: 'blackhole', settings: {} })
    expect(res.status).toBe('add')
    expect(res.config.outbounds).toHaveLength(2)
    expect(BASE.outbounds).toHaveLength(1)
  })

  it('занятый тег переиспользуется без правки настроек', () => {
    const config = {
      ...BASE,
      outbounds: [{ tag: 'block', protocol: 'blackhole', settings: { response: { type: 'http' } } }],
    } as XrayConfig
    const res = ensureOutbound(config, { tag: 'block', protocol: 'blackhole', settings: {} })
    expect(res.status).toBe('exists')
    expect(res.config).toBe(config)
    expect(res.config.outbounds![0]!.settings).toEqual({ response: { type: 'http' } })
  })
})

describe('sameRule', () => {
  it('порядок значений внутри domain не влияет на равенство', () => {
    expect(
      sameRule({ domain: ['a', 'b'], outboundTag: 'warp' }, { domain: ['b', 'a'], outboundTag: 'warp' }),
    ).toBe(true)
  })

  it('разный outboundTag или лишнее поле — разные правила', () => {
    expect(sameRule({ domain: ['a'], outboundTag: 'warp' }, { domain: ['a'], outboundTag: 'direct' })).toBe(false)
    expect(sameRule({ domain: ['a'] }, { domain: ['a'], network: 'tcp' })).toBe(false)
  })
})

describe('ensureRule', () => {
  it('блокирующее правило встаёт первым, маршрутное — за серией блокировок', () => {
    const withBlock = {
      ...BASE,
      outbounds: [
        { tag: 'direct', protocol: 'freedom', settings: {} },
        { tag: 'block', protocol: 'blackhole', settings: {} },
      ],
      routing: { rules: [{ protocol: ['bittorrent'], outboundTag: 'block' }, { domain: ['x'], outboundTag: 'direct' }] },
    } as XrayConfig

    const blocked = ensureRule(withBlock, { ip: ['geoip:private'], outboundTag: 'block' }, 'block')
    expect(blocked.index).toBe(0)

    const routed = ensureRule(withBlock, { domain: ['geosite:openai'], outboundTag: 'warp' }, 'route')
    expect(routed.index).toBe(1)
    expect(routed.config.routing!.rules![1]!.outboundTag).toBe('warp')
  })

  it('эквивалентное правило не дублируется', () => {
    const config = {
      ...BASE,
      routing: { rules: [{ domain: ['b', 'a'], outboundTag: 'warp' }] },
    } as XrayConfig
    const res = ensureRule(config, { domain: ['a', 'b'], outboundTag: 'warp' }, 'route')
    expect(res.status).toBe('exists')
    expect(res.index).toBe(0)
    expect(res.config.routing!.rules).toHaveLength(1)
  })
})

describe('ensureSniffing', () => {
  it('включает sniffing и заполняет пустой destOverride, уже включённый не трогает', () => {
    const config = {
      ...BASE,
      inbounds: [
        { tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } },
        {
          tag: 'ss-in',
          port: 8388,
          protocol: 'shadowsocks',
          settings: {},
          sniffing: { enabled: true, destOverride: ['tls'] },
        },
      ],
    } as XrayConfig
    const res = ensureSniffing(config, ['vless-in', 'ss-in'])
    expect(res.changed).toEqual(['vless-in'])
    expect(res.config.inbounds![0]!.sniffing).toEqual({
      enabled: true,
      destOverride: ['http', 'tls', 'quic'],
    })
    expect(res.config.inbounds![1]!.sniffing).toEqual({ enabled: true, destOverride: ['tls'] })
  })

  it('пустой список тегов означает «все inbound’ы»', () => {
    const res = ensureSniffing(BASE, [])
    expect(res.changed).toEqual(['vless-in', 'ss-in'])
  })
})

describe('ruleOrdinal', () => {
  it('первые позиции словами, дальше — числом', () => {
    expect(ruleOrdinal(0)).toBe('первым')
    expect(ruleOrdinal(2)).toBe('третьим')
    expect(ruleOrdinal(7)).toBe('на позиции 8')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/recipes-apply.test.ts`
Ожидание: FAIL — «Failed to resolve import "../src/entities/xray/recipes/apply"».

- [ ] **Step 3: Создать `frontend/src/entities/xray/recipes/types.ts`**

```ts
import type { XrayConfig } from '../config'

/** Строка предпросмотра: «+ outbound warp» или «✓ правило … уже есть» */
export interface RecipeChange {
  status: 'add' | 'exists'
  text: string
}

/** Замечание рецепта. needsGeo включает в диалоге кнопку «Geo-базы» */
export interface RecipeNote {
  text: string
  needsGeo?: true
}

export interface RecipePlan {
  /** Результат применения; исходный конфиг не мутируется */
  config: XrayConfig
  changes: RecipeChange[]
  notes: RecipeNote[]
}

export type Outbound = NonNullable<XrayConfig['outbounds']>[number]
export type Rule = NonNullable<NonNullable<XrayConfig['routing']>['rules']>[number]
export type Inbound = NonNullable<XrayConfig['inbounds']>[number]
```

- [ ] **Step 4: Создать `frontend/src/entities/xray/recipes/apply.ts`**

```ts
// Примитивы слияния рецепта с существующим конфигом. Все возвращают НОВЫЙ конфиг
// и статус: 'add' — что-то добавили, 'exists' — такое уже есть, конфиг вернули как был
// (по ссылке, вызывающий может сравнивать через ===).

import type { XrayConfig } from '../config'
import type { Outbound, Rule } from './types'

export interface MergeResult {
  config: XrayConfig
  status: 'add' | 'exists'
}

export interface RuleMergeResult extends MergeResult {
  /** Индекс правила в routing.rules — для текста «встанет первым» */
  index: number
}

export function ensureOutbound(config: XrayConfig, outbound: Outbound): MergeResult {
  const list = config.outbounds ?? []
  if (list.some((o) => o.tag === outbound.tag)) return { config, status: 'exists' }
  return { config: { ...config, outbounds: [...list, outbound] }, status: 'add' }
}

// Поля-множества: порядок значений в них для Xray не значим
const SET_FIELDS = ['domain', 'ip', 'inboundTag', 'protocol', 'user', 'source'] as const
// Поля со скалярным значением: сравниваются точно
const EXACT_FIELDS = ['type', 'outboundTag', 'balancerTag', 'port', 'sourcePort', 'network'] as const

function sameSet(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = a ?? []
  const y = b ?? []
  if (x.length !== y.length) return false
  const set = new Set(x)
  return y.every((v) => set.has(v))
}

/** Правила считаются одним и тем же, если совпали все сравниваемые поля */
export function sameRule(a: Rule, b: Rule): boolean {
  return (
    SET_FIELDS.every((f) => sameSet(a[f], b[f])) && EXACT_FIELDS.every((f) => a[f] === b[f])
  )
}

export type Placement = 'block' | 'route'

// Ведущая серия правил, ведущих в blackhole-выход: маршрут рецепта встаёт сразу за ней,
// чтобы не перекрыть блокировку и при этом оказаться выше пользовательских правил
function blockPrefixLength(config: XrayConfig, rules: Rule[]): number {
  const blackholes = new Set(
    (config.outbounds ?? [])
      .filter((o) => o.protocol === 'blackhole')
      .map((o) => o.tag)
      .filter((t): t is string => typeof t === 'string'),
  )
  let i = 0
  while (i < rules.length) {
    const tag = rules[i]!.outboundTag
    if (tag === undefined || !blackholes.has(tag)) break
    i += 1
  }
  return i
}

export function ensureRule(config: XrayConfig, rule: Rule, placement: Placement): RuleMergeResult {
  const rules = config.routing?.rules ?? []
  const found = rules.findIndex((r) => sameRule(r, rule))
  if (found !== -1) return { config, status: 'exists', index: found }

  // В Xray выигрывает первое совпавшее правило, поэтому вставляем в начало:
  // в хвосте под общим «всё → proxy» правило не сработало бы никогда
  const index = placement === 'block' ? 0 : blockPrefixLength(config, rules)
  const next = [...rules.slice(0, index), rule, ...rules.slice(index)]
  return {
    config: { ...config, routing: { ...(config.routing ?? {}), rules: next } },
    status: 'add',
    index,
  }
}

export interface SniffingResult {
  config: XrayConfig
  /** Теги inbound’ов, которым sniffing реально включили */
  changed: string[]
}

/**
 * Правило по protocol (bittorrent) без sniffing не срабатывает вовсе, поэтому
 * рецепты блокировки включают его сами. Пустой список тегов — «все inbound’ы».
 */
export function ensureSniffing(config: XrayConfig, tags: string[]): SniffingResult {
  const changed: string[] = []
  const inbounds = (config.inbounds ?? []).map((inb) => {
    const tag = inb.tag
    if (typeof tag !== 'string') return inb
    if (tags.length > 0 && !tags.includes(tag)) return inb
    const current = inb.sniffing
    const destOverride = current?.destOverride ?? []
    if (current?.enabled === true && destOverride.length > 0) return inb
    changed.push(tag)
    return {
      ...inb,
      sniffing: {
        ...(current ?? {}),
        enabled: true,
        destOverride: destOverride.length > 0 ? destOverride : ['http', 'tls', 'quic'],
      },
    }
  })
  if (changed.length === 0) return { config, changed }
  return { config: { ...config, inbounds }, changed }
}

const ORDINALS = ['первым', 'вторым', 'третьим', 'четвёртым', 'пятым']

export function ruleOrdinal(index: number): string {
  return ORDINALS[index] ?? `на позиции ${index + 1}`
}
```

- [ ] **Step 5: Прогнать тест**

Из каталога `frontend`: `npx vitest run test/recipes-apply.test.ts`
Ожидание: PASS, 8 тестов.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/xray/recipes frontend/test/recipes-apply.test.ts
git commit -m "feat(frontend): merge primitives for config recipes"
```

---

### Task 2: Блокирующие рецепты (торренты, реклама, локальные сети)

**Files:**
- Create: `frontend/src/entities/xray/recipes/block.ts`
- Test: `frontend/test/recipes-block.test.ts`

**Interfaces:**
- Consumes: `ensureOutbound`, `ensureRule`, `ensureSniffing`, `ruleOrdinal` из `./apply`; `RecipePlan`, `RecipeChange` из `./types`.
- Produces: `BlockParams { blockTag: string }`, `TorrentParams { blockTag: string; inboundTags: string[] }`, `BLOCK_DEFAULTS`, `TORRENT_DEFAULTS`, `validateBlock(params)`, `planTorrent(config, params)`, `planAds(config, params)`, `planPrivate(config, params)`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/recipes-block.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  BLOCK_DEFAULTS,
  TORRENT_DEFAULTS,
  planAds,
  planPrivate,
  planTorrent,
  validateBlock,
} from '../src/entities/xray/recipes/block'
import type { XrayConfig } from '../src/entities/xray'

const BASE: XrayConfig = {
  inbounds: [{ tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } }],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
} as XrayConfig

describe('planTorrent', () => {
  it('добавляет blackhole, правило bittorrent и включает sniffing', () => {
    const plan = planTorrent(BASE, TORRENT_DEFAULTS)
    expect(plan.config.outbounds).toContainEqual({ tag: 'block', protocol: 'blackhole', settings: {} })
    expect(plan.config.routing!.rules![0]).toEqual({ protocol: ['bittorrent'], outboundTag: 'block' })
    expect(plan.config.inbounds![0]!.sniffing!.enabled).toBe(true)
    expect(plan.changes.filter((c) => c.status === 'add')).toHaveLength(3)
    expect(plan.changes.some((c) => c.text.includes('sniffing'))).toBe(true)
  })

  it('повторное применение ничего не добавляет', () => {
    const once = planTorrent(BASE, TORRENT_DEFAULTS)
    const twice = planTorrent(once.config, TORRENT_DEFAULTS)
    expect(twice.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(twice.config.routing!.rules).toHaveLength(1)
  })

  it('inboundTags сужает список: чужой inbound не трогается', () => {
    const two = {
      ...BASE,
      inbounds: [
        { tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } },
        { tag: 'ss-in', port: 8388, protocol: 'shadowsocks', settings: {} },
      ],
    } as XrayConfig
    const plan = planTorrent(two, { ...TORRENT_DEFAULTS, inboundTags: ['ss-in'] })
    expect(plan.config.inbounds![0]!.sniffing).toBeUndefined()
    expect(plan.config.inbounds![1]!.sniffing!.enabled).toBe(true)
  })
})

describe('planAds и planPrivate', () => {
  it('реклама даёт одно правило по geosite и замечание про geo-базы', () => {
    const plan = planAds(BASE, BLOCK_DEFAULTS)
    expect(plan.config.routing!.rules![0]).toEqual({
      domain: ['geosite:category-ads-all'],
      outboundTag: 'block',
    })
    expect(plan.notes.some((n) => n.needsGeo === true)).toBe(true)
  })

  it('локальные сети дают два правила — по ip и по domain', () => {
    const plan = planPrivate(BASE, BLOCK_DEFAULTS)
    const rules = plan.config.routing!.rules!
    expect(rules).toHaveLength(2)
    expect(rules.some((r) => r.ip?.[0] === 'geoip:private')).toBe(true)
    expect(rules.some((r) => r.domain?.[0] === 'geosite:private')).toBe(true)
  })

  it('чужой тег блокировки уважается и переиспользуется', () => {
    const custom = {
      ...BASE,
      outbounds: [
        { tag: 'direct', protocol: 'freedom', settings: {} },
        { tag: 'drop', protocol: 'blackhole', settings: { response: { type: 'http' } } },
      ],
    } as XrayConfig
    const plan = planAds(custom, { blockTag: 'drop' })
    expect(plan.config.outbounds).toHaveLength(2)
    expect(plan.config.outbounds![1]!.settings).toEqual({ response: { type: 'http' } })
    expect(plan.config.routing!.rules![0]!.outboundTag).toBe('drop')
  })
})

describe('validateBlock', () => {
  it('пустой тег — ошибка, обычный — нет', () => {
    expect(validateBlock({ blockTag: '  ' })).toMatch(/тег/i)
    expect(validateBlock({ blockTag: 'block' })).toBeNull()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из `frontend`: `npx vitest run test/recipes-block.test.ts` → FAIL, модуль не найден.

- [ ] **Step 3: Создать `frontend/src/entities/xray/recipes/block.ts`**

```ts
// Рецепты, которые гасят трафик в blackhole: торренты, реклама, локальные сети.
// Все три переиспользуют один outbound-«чёрную дыру» — по умолчанию с тегом block.

import type { XrayConfig } from '../config'
import { ensureOutbound, ensureRule, ensureSniffing, ruleOrdinal } from './apply'
import type { RecipeChange, RecipeNote, RecipePlan, Rule } from './types'

export interface BlockParams {
  blockTag: string
}

export interface TorrentParams extends BlockParams {
  /** Пусто — все inbound’ы конфига */
  inboundTags: string[]
}

export const BLOCK_DEFAULTS: BlockParams = { blockTag: 'block' }
export const TORRENT_DEFAULTS: TorrentParams = { blockTag: 'block', inboundTags: [] }

export const GEO_NOTE: RecipeNote = {
  text: 'Правило использует geo-категории: без загруженных geo-баз ядро не запустится.',
  needsGeo: true,
}

export function validateBlock(params: BlockParams): string | null {
  if (params.blockTag.trim() === '') return 'Укажите тег блокирующего outbound’а'
  return null
}

function blackhole(tag: string) {
  return { tag, protocol: 'blackhole', settings: {} }
}

/** Общая часть всех трёх рецептов: outbound-«чёрная дыра» + набор правил */
function planBlocking(
  config: XrayConfig,
  blockTag: string,
  rules: { rule: Rule; text: string }[],
): { config: XrayConfig; changes: RecipeChange[] } {
  const changes: RecipeChange[] = []
  const outbound = ensureOutbound(config, blackhole(blockTag))
  changes.push({
    status: outbound.status,
    text:
      outbound.status === 'add'
        ? `outbound ${blockTag} (blackhole)`
        : `outbound ${blockTag} — уже есть, используем`,
  })

  let next = outbound.config
  for (const item of rules) {
    const res = ensureRule(next, item.rule, 'block')
    next = res.config
    changes.push({
      status: res.status,
      text:
        res.status === 'add'
          ? `правило ${item.text} → ${blockTag} (${ruleOrdinal(res.index)})`
          : `правило ${item.text} → ${blockTag} — уже есть`,
    })
  }
  return { config: next, changes }
}

export function planTorrent(config: XrayConfig, params: TorrentParams): RecipePlan {
  const base = planBlocking(config, params.blockTag, [
    { rule: { protocol: ['bittorrent'], outboundTag: params.blockTag }, text: 'протокол bittorrent' },
  ])

  const sniff = ensureSniffing(base.config, params.inboundTags)
  const changes = [...base.changes]
  if (sniff.changed.length > 0) {
    changes.push({ status: 'add', text: `sniffing включён у: ${sniff.changed.join(', ')}` })
  } else {
    changes.push({ status: 'exists', text: 'sniffing уже включён' })
  }

  return {
    config: sniff.config,
    changes,
    notes: [
      {
        text: 'Определение bittorrent работает только при включённом sniffing — рецепт включает его сам.',
      },
    ],
  }
}

export function planAds(config: XrayConfig, params: BlockParams): RecipePlan {
  const base = planBlocking(config, params.blockTag, [
    {
      rule: { domain: ['geosite:category-ads-all'], outboundTag: params.blockTag },
      text: 'geosite:category-ads-all',
    },
  ])
  return { config: base.config, changes: base.changes, notes: [GEO_NOTE] }
}

export function planPrivate(config: XrayConfig, params: BlockParams): RecipePlan {
  // Два правила вместо одного: ip и domain внутри правила работают по «или», но
  // раздельные правила понятнее в топологии и отключаются по одному
  const base = planBlocking(config, params.blockTag, [
    { rule: { ip: ['geoip:private'], outboundTag: params.blockTag }, text: 'geoip:private' },
    { rule: { domain: ['geosite:private'], outboundTag: params.blockTag }, text: 'geosite:private' },
  ])
  return {
    config: base.config,
    changes: base.changes,
    notes: [
      GEO_NOTE,
      { text: 'Закрывает клиентам доступ к локальной сети ноды и к самому серверу.' },
    ],
  }
}
```

- [ ] **Step 4: Прогнать тест**

Из `frontend`: `npx vitest run test/recipes-block.test.ts` → PASS, 6 тестов.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/recipes/block.ts frontend/test/recipes-block.test.ts
git commit -m "feat(frontend): blocking recipes for torrents, ads and private networks"
```

---

### Task 3: Рецепт WARP

**Files:**
- Create: `frontend/src/entities/xray/recipes/warp.ts`
- Modify: `frontend/src/features/inspector/OutboundForm.tsx` (убрать локальный `WARP_TEMPLATE`, импортировать из рецепта)
- Modify: `frontend/test/outbound-form.test.tsx:7` (импорт `WARP_TEMPLATE` из нового места)
- Test: `frontend/test/recipes-warp.test.ts`

**Interfaces:**
- Consumes: `ensureOutbound`, `ensureRule`, `ruleOrdinal`; `GEO_NOTE` из `./block`.
- Produces: `WarpParams { tag; services: string[]; domains: string[]; secretKey: string; addresses: string[]; reserved: number[]; mtu: number }`, `WARP_DEFAULTS`, `WARP_SERVICES: { value: string; label: string }[]`, `WARP_TEMPLATE`, `validateWarp(params)`, `planWarp(config, params)`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/recipes-warp.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { WARP_DEFAULTS, WARP_SERVICES, planWarp, validateWarp } from '../src/entities/xray/recipes/warp'
import type { XrayConfig } from '../src/entities/xray'

const BASE: XrayConfig = {
  inbounds: [{ tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } }],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
} as XrayConfig

const PARAMS = {
  ...WARP_DEFAULTS,
  secretKey: 'aBcD',
  services: ['geosite:openai', 'geosite:google'],
}

describe('planWarp', () => {
  it('добавляет wireguard-outbound и одно правило со всеми категориями', () => {
    const plan = planWarp(BASE, PARAMS)
    const warp = plan.config.outbounds!.find((o) => o.tag === 'warp')!
    expect(warp.protocol).toBe('wireguard')
    expect((warp.settings as { secretKey: string }).secretKey).toBe('aBcD')
    expect(plan.config.routing!.rules).toHaveLength(1)
    expect(plan.config.routing!.rules![0]).toEqual({
      domain: ['geosite:openai', 'geosite:google'],
      outboundTag: 'warp',
    })
    expect(plan.notes.some((n) => n.needsGeo === true)).toBe(true)
  })

  it('свои домены добавляются к категориям', () => {
    const plan = planWarp(BASE, { ...PARAMS, domains: ['example.com'] })
    expect(plan.config.routing!.rules![0]!.domain).toEqual([
      'geosite:openai',
      'geosite:google',
      'example.com',
    ])
  })

  it('повторное применение ничего не добавляет', () => {
    const once = planWarp(BASE, PARAMS)
    const twice = planWarp(once.config, PARAMS)
    expect(twice.changes.every((c) => c.status === 'exists')).toBe(true)
  })

  it('адреса, reserved и mtu попадают в настройки', () => {
    const plan = planWarp(BASE, {
      ...PARAMS,
      addresses: ['172.16.0.2/32', '2606:4700:110::1/128'],
      reserved: [1, 2, 3],
      mtu: 1280,
    })
    const settings = plan.config.outbounds!.find((o) => o.tag === 'warp')!.settings as {
      address: string[]
      reserved: number[]
      mtu: number
      peers: { publicKey: string; endpoint: string }[]
    }
    expect(settings.address).toEqual(['172.16.0.2/32', '2606:4700:110::1/128'])
    expect(settings.reserved).toEqual([1, 2, 3])
    expect(settings.mtu).toBe(1280)
    expect(settings.peers[0]!.endpoint).toBe('engage.cloudflareclient.com:2408')
  })
})

describe('validateWarp', () => {
  it('без ключа и без целей — ошибки, с ними — null', () => {
    expect(validateWarp({ ...PARAMS, secretKey: '' })).toMatch(/ключ/i)
    expect(validateWarp({ ...PARAMS, services: [], domains: [] })).toMatch(/сервис|домен/i)
    expect(validateWarp({ ...PARAMS, tag: ' ' })).toMatch(/тег/i)
    expect(validateWarp(PARAMS)).toBeNull()
  })
})

describe('WARP_SERVICES', () => {
  it('коды категорий идут с префиксом geosite:', () => {
    expect(WARP_SERVICES.length).toBeGreaterThanOrEqual(10)
    expect(WARP_SERVICES.every((s) => s.value.startsWith('geosite:'))).toBe(true)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из `frontend`: `npx vitest run test/recipes-warp.test.ts` → FAIL, модуль не найден.

- [ ] **Step 3: Создать `frontend/src/entities/xray/recipes/warp.ts`**

```ts
// Рецепт «WARP для выбранных сервисов»: wireguard-outbound Cloudflare + одно правило
// со списком категорий. Публичный ключ пира и endpoint одинаковы для всех аккаунтов,
// secretKey и адреса выдаются при регистрации устройства (wgcf или кнопка «Получить ключи»).

import type { XrayConfig } from '../config'
import { ensureOutbound, ensureRule, ruleOrdinal } from './apply'
import { GEO_NOTE } from './block'
import type { RecipeChange, RecipePlan } from './types'

export const WARP_PEER = {
  publicKey: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
  endpoint: 'engage.cloudflareclient.com:2408',
  allowedIPs: ['0.0.0.0/0', '::/0'],
}

/** Шаблон для кнопки «Заполнить шаблон WARP» в форме outbound’а */
export const WARP_TEMPLATE = {
  secretKey: 'ВСТАВЬТЕ_ПРИВАТНЫЙ_КЛЮЧ_WARP',
  address: ['172.16.0.2/32'],
  mtu: 1280,
  peers: [WARP_PEER],
}

export const WARP_SERVICES: { value: string; label: string }[] = [
  { value: 'geosite:openai', label: 'OpenAI / ChatGPT' },
  { value: 'geosite:google', label: 'Google' },
  { value: 'geosite:netflix', label: 'Netflix' },
  { value: 'geosite:spotify', label: 'Spotify' },
  { value: 'geosite:twitter', label: 'Twitter / X' },
  { value: 'geosite:facebook', label: 'Meta / Facebook' },
  { value: 'geosite:discord', label: 'Discord' },
  { value: 'geosite:tiktok', label: 'TikTok' },
  { value: 'geosite:apple', label: 'Apple' },
  { value: 'geosite:microsoft', label: 'Microsoft' },
]

export interface WarpParams {
  tag: string
  /** Коды geosite с префиксом, например geosite:openai */
  services: string[]
  /** Свои домены и категории */
  domains: string[]
  secretKey: string
  addresses: string[]
  reserved: number[]
  mtu: number
}

export const WARP_DEFAULTS: WarpParams = {
  tag: 'warp',
  services: ['geosite:openai'],
  domains: [],
  secretKey: '',
  addresses: ['172.16.0.2/32'],
  reserved: [],
  mtu: 1280,
}

export function validateWarp(params: WarpParams): string | null {
  if (params.tag.trim() === '') return 'Укажите тег outbound’а'
  if (params.secretKey.trim() === '') {
    return 'Вставьте приватный ключ WARP или нажмите «Получить ключи»'
  }
  if (params.services.length === 0 && params.domains.length === 0) {
    return 'Выберите сервисы или укажите свои домены — иначе правило некуда направить'
  }
  return null
}

function warpOutbound(params: WarpParams) {
  const settings: Record<string, unknown> = {
    secretKey: params.secretKey,
    address: params.addresses,
    mtu: params.mtu,
    peers: [WARP_PEER],
  }
  // reserved нужен не всем аккаунтам: пустой массив в конфиг не пишем
  if (params.reserved.length > 0) settings.reserved = params.reserved
  return { tag: params.tag, protocol: 'wireguard', settings }
}

export function planWarp(config: XrayConfig, params: WarpParams): RecipePlan {
  const changes: RecipeChange[] = []

  const outbound = ensureOutbound(config, warpOutbound(params))
  changes.push({
    status: outbound.status,
    text:
      outbound.status === 'add'
        ? `outbound ${params.tag} (wireguard)`
        : `outbound ${params.tag} — уже есть, используем`,
  })

  const domain = [...params.services, ...params.domains]
  const rule = ensureRule(outbound.config, { domain, outboundTag: params.tag }, 'route')
  const list = domain.length > 2 ? `${domain.slice(0, 2).join(', ')} и ещё ${domain.length - 2}` : domain.join(', ')
  changes.push({
    status: rule.status,
    text:
      rule.status === 'add'
        ? `правило ${list} → ${params.tag} (${ruleOrdinal(rule.index)})`
        : `правило ${list} → ${params.tag} — уже есть`,
  })

  const notes = params.services.length > 0 ? [GEO_NOTE] : []
  return { config: rule.config, changes, notes }
}
```

- [ ] **Step 4: Перенести константу из формы outbound’а**

В `frontend/src/features/inspector/OutboundForm.tsx` удалить блок `export const WARP_TEMPLATE = {...}` вместе с комментарием над ним и добавить импорт (рядом с существующими импортами из entities):

```ts
import { WARP_TEMPLATE } from '../../entities/xray/recipes/warp'
```

В `frontend/test/outbound-form.test.tsx` строку 7 разделить на два импорта:

```ts
import { OutboundForm } from '../src/features/inspector/OutboundForm'
import { WARP_TEMPLATE } from '../src/entities/xray/recipes/warp'
```

- [ ] **Step 5: Прогнать тесты**

Из `frontend`: `npx vitest run test/recipes-warp.test.ts test/outbound-form.test.tsx`
Ожидание: PASS в обоих файлах (в `recipes-warp` — 6 тестов).

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/xray/recipes/warp.ts frontend/src/features/inspector/OutboundForm.tsx frontend/test/recipes-warp.test.ts frontend/test/outbound-form.test.tsx
git commit -m "feat(frontend): WARP recipe with service categories"
```

---

### Task 4: Рецепт цепочки

**Files:**
- Create: `frontend/src/entities/xray/recipes/chain.ts`
- Test: `frontend/test/recipes-chain.test.ts`

**Interfaces:**
- Consumes: `ensureOutbound`, `ensureRule`, `ruleOrdinal`.
- Produces: `ChainParams`, `CHAIN_DEFAULTS`, `CHAIN_PROTOCOLS`, `validateChain(params)`, `planChain(config, params)`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/recipes-chain.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CHAIN_DEFAULTS, planChain, validateChain } from '../src/entities/xray/recipes/chain'
import type { XrayConfig } from '../src/entities/xray'

const BASE: XrayConfig = {
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
} as XrayConfig

const VLESS = {
  ...CHAIN_DEFAULTS,
  address: '203.0.113.10',
  port: 443,
  uuid: '7d4e0c1c-1c2b-4f5a-9a1e-1f2b3c4d5e6f',
}

describe('planChain', () => {
  it('vless: vnext с пользователем, TLS с serverName по адресу', () => {
    const plan = planChain(BASE, { ...VLESS, tls: true })
    const out = plan.config.outbounds!.find((o) => o.tag === 'chain')!
    expect(out.protocol).toBe('vless')
    expect(out.settings).toEqual({
      vnext: [
        {
          address: '203.0.113.10',
          port: 443,
          users: [{ id: VLESS.uuid, encryption: 'none' }],
        },
      ],
    })
    expect(out.streamSettings).toEqual({
      network: 'tcp',
      security: 'tls',
      tlsSettings: { serverName: '203.0.113.10' },
    })
  })

  it('trojan: servers с паролем, без TLS security остаётся none', () => {
    const plan = planChain(BASE, {
      ...CHAIN_DEFAULTS,
      protocol: 'trojan',
      address: 'node2.example.com',
      port: 8443,
      password: 'secret',
    })
    const out = plan.config.outbounds!.find((o) => o.tag === 'chain')!
    expect(out.settings).toEqual({
      servers: [{ address: 'node2.example.com', port: 8443, password: 'secret' }],
    })
    expect(out.streamSettings).toEqual({ network: 'tcp', security: 'none' })
  })

  it('пустой список доменов даёт правило без условий — весь трафик', () => {
    const plan = planChain(BASE, VLESS)
    expect(plan.config.routing!.rules![0]).toEqual({ outboundTag: 'chain' })
    expect(plan.changes.some((c) => c.text.includes('весь трафик'))).toBe(true)
  })

  it('dialerProxy уходит в sockopt', () => {
    const plan = planChain(BASE, { ...VLESS, dialerProxy: 'direct' })
    const out = plan.config.outbounds!.find((o) => o.tag === 'chain')!
    expect((out.streamSettings as { sockopt: { dialerProxy: string } }).sockopt).toEqual({
      dialerProxy: 'direct',
    })
  })

  it('повторное применение ничего не добавляет', () => {
    const once = planChain(BASE, VLESS)
    const twice = planChain(once.config, VLESS)
    expect(twice.changes.every((c) => c.status === 'exists')).toBe(true)
  })
})

describe('validateChain', () => {
  it('ловит пустой адрес, плохой порт, кривой UUID, пустой пароль и петлю dialerProxy', () => {
    expect(validateChain({ ...VLESS, address: '' })).toMatch(/адрес/i)
    expect(validateChain({ ...VLESS, port: 0 })).toMatch(/порт/i)
    expect(validateChain({ ...VLESS, uuid: 'нет' })).toMatch(/uuid/i)
    expect(validateChain({ ...CHAIN_DEFAULTS, protocol: 'trojan', address: 'a.b', port: 443 })).toMatch(/пароль/i)
    expect(validateChain({ ...VLESS, dialerProxy: 'chain' })).toMatch(/себя|сам/i)
    expect(validateChain(VLESS)).toBeNull()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из `frontend`: `npx vitest run test/recipes-chain.test.ts` → FAIL, модуль не найден.

- [ ] **Step 3: Создать `frontend/src/entities/xray/recipes/chain.ts`**

```ts
// Рецепт «Цепочка через другой сервер»: outbound на второй сервер + правило,
// направляющее в него выбранный трафик. dialerProxy даёт второй хоп в одном соединении.

import type { XrayConfig } from '../config'
import { ensureOutbound, ensureRule, ruleOrdinal } from './apply'
import type { RecipeChange, RecipePlan } from './types'

export const CHAIN_PROTOCOLS = [
  { value: 'vless', label: 'vless' },
  { value: 'trojan', label: 'trojan' },
  { value: 'socks', label: 'socks' },
]

export interface ChainParams {
  tag: string
  protocol: 'vless' | 'trojan' | 'socks'
  address: string
  port: number
  /** vless */
  uuid: string
  /** trojan и socks */
  password: string
  /** socks */
  username: string
  tls: boolean
  /** Пусто — без промежуточного хопа */
  dialerProxy: string
  /** Пусто — правило без условий, то есть весь трафик */
  domains: string[]
}

export const CHAIN_DEFAULTS: ChainParams = {
  tag: 'chain',
  protocol: 'vless',
  address: '',
  port: 443,
  uuid: '',
  password: '',
  username: '',
  tls: true,
  dialerProxy: '',
  domains: [],
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateChain(params: ChainParams): string | null {
  if (params.tag.trim() === '') return 'Укажите тег outbound’а'
  if (params.address.trim() === '') return 'Укажите адрес сервера'
  if (!Number.isInteger(params.port) || params.port < 1 || params.port > 65535) {
    return 'Порт: целое число от 1 до 65535'
  }
  if (params.protocol === 'vless' && !UUID_RE.test(params.uuid.trim())) {
    return 'UUID пользователя: 8-4-4-4-12 шестнадцатеричных символов'
  }
  if (params.protocol === 'trojan' && params.password.trim() === '') {
    return 'Укажите пароль trojan'
  }
  if (params.protocol === 'socks' && params.username.trim() !== '' && params.password.trim() === '') {
    return 'Для socks с именем пользователя нужен пароль'
  }
  if (params.dialerProxy.trim() === params.tag.trim() && params.dialerProxy.trim() !== '') {
    return 'dialerProxy не может указывать на себя же'
  }
  return null
}

function chainSettings(params: ChainParams): Record<string, unknown> {
  if (params.protocol === 'vless') {
    return {
      vnext: [
        {
          address: params.address,
          port: params.port,
          users: [{ id: params.uuid.trim(), encryption: 'none' }],
        },
      ],
    }
  }
  if (params.protocol === 'trojan') {
    return { servers: [{ address: params.address, port: params.port, password: params.password }] }
  }
  const server: Record<string, unknown> = { address: params.address, port: params.port }
  if (params.username.trim() !== '') {
    server.users = [{ user: params.username, pass: params.password }]
  }
  return { servers: [server] }
}

function chainStream(params: ChainParams): Record<string, unknown> {
  const stream: Record<string, unknown> = {
    network: 'tcp',
    security: params.tls ? 'tls' : 'none',
  }
  if (params.tls) stream.tlsSettings = { serverName: params.address }
  if (params.dialerProxy.trim() !== '') stream.sockopt = { dialerProxy: params.dialerProxy.trim() }
  return stream
}

export function planChain(config: XrayConfig, params: ChainParams): RecipePlan {
  const changes: RecipeChange[] = []

  const outbound = ensureOutbound(config, {
    tag: params.tag,
    protocol: params.protocol,
    settings: chainSettings(params),
    streamSettings: chainStream(params),
  })
  changes.push({
    status: outbound.status,
    text:
      outbound.status === 'add'
        ? `outbound ${params.tag} (${params.protocol} → ${params.address}:${params.port})`
        : `outbound ${params.tag} — уже есть, используем`,
  })

  const rule = params.domains.length > 0
    ? { domain: params.domains, outboundTag: params.tag }
    : { outboundTag: params.tag }
  const merged = ensureRule(outbound.config, rule, 'route')
  const what = params.domains.length > 0 ? params.domains.join(', ') : 'весь трафик'
  changes.push({
    status: merged.status,
    text:
      merged.status === 'add'
        ? `правило ${what} → ${params.tag} (${ruleOrdinal(merged.index)})`
        : `правило ${what} → ${params.tag} — уже есть`,
  })

  const notes = params.domains.length === 0
    ? [{ text: 'Правило без условий заберёт весь трафик — поставьте его ниже частных правил, если нужно исключение.' }]
    : []
  return { config: merged.config, changes, notes }
}
```

- [ ] **Step 4: Прогнать тест**

Из `frontend`: `npx vitest run test/recipes-chain.test.ts` → PASS, 6 тестов.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/recipes/chain.ts frontend/test/recipes-chain.test.ts
git commit -m "feat(frontend): proxy chain recipe"
```

---

### Task 5: Реестр рецептов

**Files:**
- Create: `frontend/src/entities/xray/recipes/index.ts`
- Modify: `frontend/src/entities/xray/index.ts` (добавить реэкспорт)
- Test: `frontend/test/recipes-registry.test.ts`

**Interfaces:**
- Consumes: `planWarp`/`WARP_DEFAULTS`/`validateWarp`, `planTorrent`/`planAds`/`planPrivate`/`BLOCK_DEFAULTS`/`TORRENT_DEFAULTS`/`validateBlock`, `planChain`/`CHAIN_DEFAULTS`/`validateChain`.
- Produces: `RecipeId = 'warp' | 'torrent' | 'ads' | 'private' | 'chain'`, `AllParams`, `DEFAULT_PARAMS: AllParams`, `RECIPES: { id: RecipeId; title: string; summary: string }[]`, `planFor(config, id, all): RecipePlan`, `validateFor(id, all): string | null`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/recipes-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, RECIPES, planFor, validateFor } from '../src/entities/xray/recipes'
import type { XrayConfig } from '../src/entities/xray'

const BASE: XrayConfig = {
  inbounds: [{ tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } }],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
} as XrayConfig

describe('реестр рецептов', () => {
  it('содержит пять рецептов с непустыми заголовками и описаниями', () => {
    expect(RECIPES.map((r) => r.id)).toEqual(['warp', 'torrent', 'ads', 'private', 'chain'])
    expect(RECIPES.every((r) => r.title.length > 0 && r.summary.length > 0)).toBe(true)
  })

  it('planFor разводит рецепты по id', () => {
    expect(planFor(BASE, 'ads', DEFAULT_PARAMS).config.routing!.rules![0]!.domain).toEqual([
      'geosite:category-ads-all',
    ])
    expect(planFor(BASE, 'torrent', DEFAULT_PARAMS).config.routing!.rules![0]!.protocol).toEqual([
      'bittorrent',
    ])
  })

  it('validateFor возвращает ошибку рецепта или null', () => {
    expect(validateFor('ads', DEFAULT_PARAMS)).toBeNull()
    // У WARP по умолчанию нет ключа
    expect(validateFor('warp', DEFAULT_PARAMS)).toMatch(/ключ/i)
    expect(
      validateFor('warp', {
        ...DEFAULT_PARAMS,
        warp: { ...DEFAULT_PARAMS.warp, secretKey: 'k' },
      }),
    ).toBeNull()
  })

  it('рецепты складываются: блокировка остаётся выше маршрута', () => {
    const withWarp = planFor(BASE, 'warp', {
      ...DEFAULT_PARAMS,
      warp: { ...DEFAULT_PARAMS.warp, secretKey: 'k' },
    }).config
    const withBoth = planFor(withWarp, 'ads', DEFAULT_PARAMS).config
    const rules = withBoth.routing!.rules!
    expect(rules[0]!.domain).toEqual(['geosite:category-ads-all'])
    expect(rules[1]!.outboundTag).toBe('warp')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из `frontend`: `npx vitest run test/recipes-registry.test.ts` → FAIL, модуль не найден.

- [ ] **Step 3: Создать `frontend/src/entities/xray/recipes/index.ts`**

```ts
// Реестр рецептов. Параметры у рецептов разные, поэтому связка «id → параметры»
// сделана картой AllParams, а не дженериком: так UI хранит состояние всех форм сразу
// (переключение рецепта не теряет введённое), а planFor/validateFor сужают тип switch’ем.

import type { XrayConfig } from '../config'
import { BLOCK_DEFAULTS, TORRENT_DEFAULTS, planAds, planPrivate, planTorrent, validateBlock } from './block'
import type { BlockParams, TorrentParams } from './block'
import { CHAIN_DEFAULTS, planChain, validateChain } from './chain'
import type { ChainParams } from './chain'
import { WARP_DEFAULTS, planWarp, validateWarp } from './warp'
import type { WarpParams } from './warp'
import type { RecipePlan } from './types'

export * from './types'
export * from './apply'
export * from './block'
export * from './chain'
export * from './warp'

export type RecipeId = 'warp' | 'torrent' | 'ads' | 'private' | 'chain'

export interface AllParams {
  warp: WarpParams
  torrent: TorrentParams
  ads: BlockParams
  private: BlockParams
  chain: ChainParams
}

export const DEFAULT_PARAMS: AllParams = {
  warp: WARP_DEFAULTS,
  torrent: TORRENT_DEFAULTS,
  ads: BLOCK_DEFAULTS,
  private: BLOCK_DEFAULTS,
  chain: CHAIN_DEFAULTS,
}

export const RECIPES: { id: RecipeId; title: string; summary: string }[] = [
  {
    id: 'warp',
    title: 'WARP для сервисов',
    summary: 'WireGuard-выход Cloudflare и правило на выбранные категории',
  },
  {
    id: 'torrent',
    title: 'Блокировка торрентов',
    summary: 'Правило по протоколу bittorrent в чёрную дыру плюс включение sniffing',
  },
  {
    id: 'ads',
    title: 'Блокировка рекламы',
    summary: 'Категория geosite:category-ads-all в чёрную дыру',
  },
  {
    id: 'private',
    title: 'Блокировка локальных сетей',
    summary: 'Закрывает клиентам локальную сеть ноды и сам сервер',
  },
  {
    id: 'chain',
    title: 'Цепочка через другой сервер',
    summary: 'Outbound на второй сервер и маршрут в него',
  },
]

export function planFor(config: XrayConfig, id: RecipeId, all: AllParams): RecipePlan {
  switch (id) {
    case 'warp':
      return planWarp(config, all.warp)
    case 'torrent':
      return planTorrent(config, all.torrent)
    case 'ads':
      return planAds(config, all.ads)
    case 'private':
      return planPrivate(config, all.private)
    case 'chain':
      return planChain(config, all.chain)
  }
}

export function validateFor(id: RecipeId, all: AllParams): string | null {
  switch (id) {
    case 'warp':
      return validateWarp(all.warp)
    case 'torrent':
      return validateBlock(all.torrent)
    case 'ads':
      return validateBlock(all.ads)
    case 'private':
      return validateBlock(all.private)
    case 'chain':
      return validateChain(all.chain)
  }
}
```

- [ ] **Step 4: Реэкспорт из слоя**

В конец `frontend/src/entities/xray/index.ts` добавить строку:

```ts
export * from './recipes'
```

- [ ] **Step 5: Прогнать тесты и typecheck**

Из `frontend`: `npx vitest run test/recipes-registry.test.ts` → PASS, 4 теста.
Из корня: `npm run typecheck -w frontend` → без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/xray/recipes/index.ts frontend/src/entities/xray/index.ts frontend/test/recipes-registry.test.ts
git commit -m "feat(frontend): recipe registry with plan and validate dispatch"
```

---

### Task 6: Бэкенд — регистрация WARP-аккаунта

**Files:**
- Modify: `backend/src/net/guard.ts` (параметр `init` у `fetchExternal`)
- Modify: `backend/src/tools/reality.ts` (экспорт `generateX25519Raw`)
- Create: `backend/src/tools/warp.ts`
- Modify: `backend/src/routes/tools.ts` (ручка + опция DI)
- Modify: `backend/src/server.ts` (проброс `registerWarp` из `ServerDeps`)
- Test: `backend/test/warp.test.ts`
- Test: `backend/test/net-guard.test.ts` (дополнить)

**Interfaces:**
- Consumes: `fetchExternal` из `../net/guard.js`.
- Produces: `WarpAccount { secretKey: string; address: string[]; reserved: number[]; peer: { publicKey: string; endpoint: string } }`, `WarpRegister = (opts?) => Promise<WarpAccount>`, `registerWarpAccount(opts?)`, ручка `POST /api/tools/warp-account`, поле `ServerDeps.registerWarp`.

- [ ] **Step 1: Написать падающий тест**

Создать `backend/test/warp.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { registerWarpAccount } from '../src/tools/warp.js'

const REG_RESPONSE = {
  id: 'reg-1',
  token: 'tok-1',
  config: {
    client_id: 'M0Rj', // 3 байта после base64-декодирования
    peers: [
      {
        public_key: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
        endpoint: { host: 'engage.cloudflareclient.com:2408' },
      },
    ],
    interface: { addresses: { v4: '172.16.0.2', v6: '2606:4700:110::1' } },
  },
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('registerWarpAccount', () => {
  it('регистрирует аккаунт, включает WARP и приводит ответ к настройкам wireguard', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return okJson(REG_RESPONSE)
    }) as unknown as typeof fetch

    const account = await registerWarpAccount({ fetchImpl, lookupImpl: async () => [{ address: '104.16.0.1' }] })

    expect(calls[0]!.url).toBe('https://api.cloudflareclient.com/v0a2158/reg')
    expect(calls[0]!.init!.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init!.body)).key).toMatch(/=$/) // base64 с padding, не base64url
    expect(calls[1]!.url).toBe('https://api.cloudflareclient.com/v0a2158/reg/reg-1')
    expect(calls[1]!.init!.method).toBe('PATCH')
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({ warp_enabled: true })

    expect(account.address).toEqual(['172.16.0.2/32', '2606:4700:110::1/128'])
    expect(account.reserved).toEqual([51, 68, 99])
    expect(account.peer.endpoint).toBe('engage.cloudflareclient.com:2408')
    expect(account.secretKey).toHaveLength(44) // 32 байта в base64 с padding
  })

  it('нестатусный ответ регистрации превращается в понятную ошибку', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch
    await expect(
      registerWarpAccount({ fetchImpl, lookupImpl: async () => [{ address: '104.16.0.1' }] }),
    ).rejects.toThrow(/Cloudflare/i)
  })

  it('неожиданная форма JSON тоже даёт ошибку, а не падение', async () => {
    const fetchImpl = vi.fn(async () => okJson({ id: 'x' })) as unknown as typeof fetch
    await expect(
      registerWarpAccount({ fetchImpl, lookupImpl: async () => [{ address: '104.16.0.1' }] }),
    ).rejects.toThrow(/ответ/i)
  })

  it('неудачный PATCH не выдаёт наполовину рабочий аккаунт', async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call += 1
      return call === 1 ? okJson(REG_RESPONSE) : new Response('no', { status: 403 })
    }) as unknown as typeof fetch
    await expect(
      registerWarpAccount({ fetchImpl, lookupImpl: async () => [{ address: '104.16.0.1' }] }),
    ).rejects.toThrow(/WARP/i)
  })
})
```

Дополнить `backend/test/net-guard.test.ts` (в конец файла) проверкой нового параметра:

```ts
describe('fetchExternal с init', () => {
  it('метод, заголовки и тело доходят до fetch, проверка хоста остаётся', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    await fetchExternal('https://api.example.com/reg', {
      fetchImpl,
      lookupImpl: async () => [{ address: '93.184.216.34' }],
      init: { method: 'POST', headers: { 'X-Test': '1' }, body: '{"a":1}' },
    })
    const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1]!
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Test']).toBe('1')
    expect(init.body).toBe('{"a":1}')
    expect(init.redirect).toBe('manual')

    await expect(
      fetchExternal('https://api.example.com/reg', {
        fetchImpl,
        lookupImpl: async () => [{ address: '127.0.0.1' }],
        init: { method: 'POST' },
      }),
    ).rejects.toThrow(/внутреннюю сеть/)
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Из корня: `npm test -w backend` → FAIL: нет модуля `../src/tools/warp.js`, `init` не поддерживается.

- [ ] **Step 3: Расширить `fetchExternal`**

В `backend/src/net/guard.ts` в интерфейс `FetchGuardOptions` добавить поле:

```ts
  /** Метод, заголовки и тело для не-GET запросов; проверка хостов и ручные редиректы не меняются */
  init?: { method?: string; headers?: Record<string, string>; body?: string }
```

и в теле `fetchExternal` заменить вызов на:

```ts
    const res = await doFetch(current, {
      ...opts.init,
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    })
```

- [ ] **Step 4: Вынести генерацию сырых ключей**

В `backend/src/tools/reality.ts` добавить экспорт и переписать `generateRealityKeypair` через него:

```ts
/** Сырые 32 байта пары x25519. Кодировку выбирает вызывающий: Reality — base64url без padding, WARP — обычный base64 */
export function generateX25519Raw(): { privateKey: Buffer; publicKey: Buffer } {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  return {
    privateKey: (privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer).subarray(-32),
    publicKey: (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32),
  }
}

export function generateRealityKeypair(): RealityKeypair {
  const { privateKey, publicKey } = generateX25519Raw()
  return { privateKey: privateKey.toString('base64url'), publicKey: publicKey.toString('base64url') }
}
```

- [ ] **Step 5: Создать `backend/src/tools/warp.ts`**

```ts
// Регистрация бесплатного аккаунта Cloudflare WARP — то же, что делает утилита wgcf.
// API неофициальный: любая неожиданность превращается в понятную ошибку, а не в падение,
// потому что у пользователя всегда остаётся ручной ввод ключей.

import { z } from 'zod'
import { fetchExternal, type FetchGuardOptions } from '../net/guard.js'
import { generateX25519Raw } from './reality.js'

const API = 'https://api.cloudflareclient.com/v0a2158/reg'
const CLIENT_HEADERS = {
  'CF-Client-Version': 'a-6.10-2158',
  'User-Agent': 'okhttp/3.12.1',
  'Content-Type': 'application/json',
  Accept: 'application/json',
}
const TIMEOUT_MS = 10_000

export interface WarpAccount {
  /** Приватный ключ в base64 с padding — формат, который ждёт wireguard-outbound Xray */
  secretKey: string
  address: string[]
  reserved: number[]
  peer: { publicKey: string; endpoint: string }
}

export type WarpRegister = () => Promise<WarpAccount>

const regSchema = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  config: z.object({
    client_id: z.string().min(1),
    peers: z
      .array(z.object({ public_key: z.string().min(1), endpoint: z.object({ host: z.string().min(1) }) }))
      .min(1),
    interface: z.object({ addresses: z.object({ v4: z.string().min(1), v6: z.string().min(1) }) }),
  }),
})

export async function registerWarpAccount(opts: FetchGuardOptions = {}): Promise<WarpAccount> {
  const { privateKey, publicKey } = generateX25519Raw()

  const regRes = await fetchExternal(API, {
    ...opts,
    timeoutMs: TIMEOUT_MS,
    init: {
      method: 'POST',
      headers: CLIENT_HEADERS,
      body: JSON.stringify({
        key: publicKey.toString('base64'),
        install_id: '',
        fcm_token: '',
        tos: new Date().toISOString(),
        model: 'PC',
        serial_number: '',
        locale: 'en_US',
      }),
    },
  })
  if (!regRes.ok) {
    throw new Error(`Cloudflare ответил ${regRes.status} на регистрацию устройства`)
  }

  let parsed: z.infer<typeof regSchema>
  try {
    parsed = regSchema.parse(await regRes.json())
  } catch {
    throw new Error('Неожиданный ответ Cloudflare: в нём нет параметров WireGuard')
  }

  // Без этого шага аккаунт создан, но WARP на нём выключен — туннель поднимется в пустоту
  const patchRes = await fetchExternal(`${API}/${parsed.id}`, {
    ...opts,
    timeoutMs: TIMEOUT_MS,
    init: {
      method: 'PATCH',
      headers: { ...CLIENT_HEADERS, Authorization: `Bearer ${parsed.token}` },
      body: JSON.stringify({ warp_enabled: true }),
    },
  })
  if (!patchRes.ok) {
    throw new Error(`Cloudflare не включил WARP на аккаунте (${patchRes.status})`)
  }

  const { addresses } = parsed.config.interface
  const peer = parsed.config.peers[0]!
  return {
    secretKey: privateKey.toString('base64'),
    address: [`${addresses.v4}/32`, `${addresses.v6}/128`],
    reserved: Array.from(Buffer.from(parsed.config.client_id, 'base64')),
    peer: { publicKey: peer.public_key, endpoint: peer.endpoint.host },
  }
}
```

- [ ] **Step 6: Добавить ручку и DI**

В `backend/src/routes/tools.ts`: расширить импорт и опции, добавить маршрут:

```ts
import { registerWarpAccount, type WarpRegister } from '../tools/warp.js'

export interface ToolsRoutesOptions {
  probeReality?: RealityProbe
  registerWarp?: WarpRegister
}
```

внутри плагина, рядом с `const probe = ...`:

```ts
  const warp = opts.registerWarp ?? (() => registerWarpAccount())

  app.post('/api/tools/warp-account', async (_req, reply) => {
    try {
      return await warp()
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return reply.status(502).send({
        message: `Cloudflare не выдал аккаунт WARP: ${reason}. Введите ключи вручную (wgcf)`,
      })
    }
  })
```

В `backend/src/server.ts` в `ServerDeps` добавить поле и пробросить его:

```ts
  /** Подменяется в тестах: настоящая регистрация ходит в Cloudflare */
  registerWarp?: WarpRegister
```

```ts
  await app.register(toolsRoutes, { probeReality: deps.probeReality, registerWarp: deps.registerWarp })
```

с импортом типа: `import type { WarpRegister } from './tools/warp.js'`.

- [ ] **Step 7: Тест ручки**

Дополнить `backend/test/warp.test.ts` (в конец файла). Подъём приложения — как в
`backend/test/xray-routes.test.ts`: `buildServer` + `makeTestConfig`/`loginCookie` из
`./helpers.js` и стаб панели `makeStubRemnawave` (иначе клиент попытается сходить в панель).
Импорты добавить к тем, что уже стоят в начале файла:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer, type ServerDeps } from '../src/server.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeStubRemnawave } from './stub-remnawave.js'

async function startWith(deps: ServerDeps) {
  const dataDir = mkdtempSync(join(tmpdir(), 'xui-warp-routes-'))
  const app = await buildServer(makeTestConfig({ dataDir }), {
    remnawave: makeStubRemnawave(),
    ...deps,
  })
  return { app, cookie: await loginCookie(app) }
}

describe('POST /api/tools/warp-account', () => {
  it('отдаёт аккаунт при успехе', async () => {
    const account = {
      secretKey: 'k',
      address: ['172.16.0.2/32'],
      reserved: [1, 2, 3],
      peer: { publicKey: 'p', endpoint: 'e:2408' },
    }
    const { app, cookie } = await startWith({ registerWarp: async () => account })
    const res = await app.inject({ method: 'POST', url: '/api/tools/warp-account', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(account)
    await app.close()
  })

  it('отказ Cloudflare превращается в 502 с подсказкой про ручной ввод', async () => {
    const { app, cookie } = await startWith({
      registerWarp: async () => {
        throw new Error('таймаут')
      },
    })
    const res = await app.inject({ method: 'POST', url: '/api/tools/warp-account', headers: { cookie } })
    expect(res.statusCode).toBe(502)
    expect(res.json().message).toMatch(/вручную/)
    await app.close()
  })
})
```

- [ ] **Step 8: Прогнать тесты**

Из корня: `npm test -w backend` → PASS, включая 5 новых тестов warp и дополненный net-guard.
`npm run typecheck -w backend` → без ошибок.

- [ ] **Step 9: Коммит**

```bash
git add backend/src/net/guard.ts backend/src/tools/reality.ts backend/src/tools/warp.ts backend/src/routes/tools.ts backend/src/server.ts backend/test/warp.test.ts backend/test/net-guard.test.ts
git commit -m "feat(backend): register a Cloudflare WARP account for the recipe"
```

---

### Task 7: Хук и формы параметров

**Files:**
- Modify: `frontend/src/shared/api/types.ts` (тип `WarpAccount`)
- Modify: `frontend/src/shared/api/hooks.ts` (хук `useWarpAccount`)
- Create: `frontend/src/features/recipes/forms/WarpForm.tsx`
- Create: `frontend/src/features/recipes/forms/BlockForm.tsx`
- Create: `frontend/src/features/recipes/forms/TorrentForm.tsx`
- Create: `frontend/src/features/recipes/forms/ChainForm.tsx`
- Test: `frontend/test/recipes-forms.test.tsx`

**Interfaces:**
- Consumes: `WarpParams`, `WARP_SERVICES`, `BlockParams`, `TorrentParams`, `ChainParams`, `CHAIN_PROTOCOLS` из `entities/xray`; примитивы `TextField`, `NumberField`, `SelectField`, `CheckboxField`, `MultiSelectField`, `StringListField` из `features/inspector/fields`.
- Produces: `useWarpAccount()`, `WarpForm`, `BlockForm`, `TorrentForm`, `ChainForm` — все с пропсами `{ value: P; onChange: (next: P) => void }`; у `TorrentForm` дополнительно `inboundTags: string[]`, у `ChainForm` — `outboundTags: string[]`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/recipes-forms.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ChainForm } from '../src/features/recipes/forms/ChainForm'
import { TorrentForm } from '../src/features/recipes/forms/TorrentForm'
import { CHAIN_DEFAULTS, TORRENT_DEFAULTS, type ChainParams } from '../src/entities/xray'
import { selectOption } from './helpers'

// Контролируемые поля требуют stateful-обёртки: без неё userEvent.type теряет символы
function ChainHarness({ onValue }: { onValue: (v: ChainParams) => void }) {
  const [value, setValue] = useState<ChainParams>(CHAIN_DEFAULTS)
  return (
    <ChainForm
      value={value}
      outboundTags={['direct', 'block']}
      onChange={(next) => {
        setValue(next)
        onValue(next)
      }}
    />
  )
}

describe('ChainForm', () => {
  it('адрес и протокол уходят наверх', async () => {
    const onValue = vi.fn()
    render(<ChainHarness onValue={onValue} />)

    await userEvent.type(screen.getByLabelText('Адрес сервера'), 'node2.example.com')
    expect(onValue.mock.calls.at(-1)![0].address).toBe('node2.example.com')

    await selectOption('Протокол', 'trojan')
    expect(onValue.mock.calls.at(-1)![0].protocol).toBe('trojan')
  })

  it('поля протокола переключаются: у trojan — пароль, у vless — UUID', async () => {
    const onValue = vi.fn()
    render(<ChainHarness onValue={onValue} />)
    expect(screen.getByLabelText('UUID пользователя')).toBeInTheDocument()
    await selectOption('Протокол', 'trojan')
    expect(screen.queryByLabelText('UUID пользователя')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument()
  })
})

describe('TorrentForm', () => {
  it('пустой выбор inbound’ов подписан как «все»', () => {
    render(
      <TorrentForm value={TORRENT_DEFAULTS} inboundTags={['vless-in', 'ss-in']} onChange={() => {}} />,
    )
    expect(screen.getByText(/пусто — все/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'vless-in' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из `frontend`: `npx vitest run test/recipes-forms.test.tsx` → FAIL, модулей форм нет.

- [ ] **Step 3: Добавить тип и хук API**

В `frontend/src/shared/api/types.ts`:

```ts
export interface WarpAccount {
  secretKey: string
  address: string[]
  reserved: number[]
  peer: { publicKey: string; endpoint: string }
}
```

В `frontend/src/shared/api/hooks.ts` (рядом с `useRealityKeypair`), не забыв добавить `WarpAccount` в импорт типов из `./types`:

```ts
export function useWarpAccount() {
  return useMutation({
    mutationFn: () =>
      apiFetch<WarpAccount>('/api/tools/warp-account', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
  })
}
```

- [ ] **Step 4: Создать формы**

`frontend/src/features/recipes/forms/BlockForm.tsx`:

```tsx
import type { BlockParams } from '../../../entities/xray'
import { TextField } from '../../inspector/fields'

export function BlockForm({ value, onChange }: { value: BlockParams; onChange: (v: BlockParams) => void }) {
  return (
    <TextField
      label="Тег блокирующего outbound’а"
      hint="Если outbound с таким тегом уже есть, рецепт возьмёт его и не станет менять настройки"
      value={value.blockTag}
      onChange={(v) => onChange({ ...value, blockTag: v ?? '' })}
    />
  )
}
```

`frontend/src/features/recipes/forms/TorrentForm.tsx`:

```tsx
import type { TorrentParams } from '../../../entities/xray'
import { MultiSelectField, TextField } from '../../inspector/fields'

export function TorrentForm({
  value,
  inboundTags,
  onChange,
}: {
  value: TorrentParams
  inboundTags: string[]
  onChange: (v: TorrentParams) => void
}) {
  return (
    <>
      <TextField
        label="Тег блокирующего outbound’а"
        hint="Если outbound с таким тегом уже есть, рецепт возьмёт его и не станет менять настройки"
        value={value.blockTag}
        onChange={(v) => onChange({ ...value, blockTag: v ?? '' })}
      />
      <MultiSelectField
        label="Включить sniffing у inbound’ов"
        hint="Пусто — все inbound’ы конфига. Без sniffing правило по bittorrent не сработает"
        options={inboundTags.map((t) => ({ value: t, label: t }))}
        value={value.inboundTags.length > 0 ? value.inboundTags : undefined}
        onChange={(v) => onChange({ ...value, inboundTags: v ?? [] })}
      />
    </>
  )
}
```

`frontend/src/features/recipes/forms/WarpForm.tsx`:

```tsx
import { WARP_SERVICES, type WarpParams } from '../../../entities/xray'
import { useWarpAccount } from '../../../shared/api'
import { Button } from '../../../shared/ui'
import { MultiSelectField, NumberField, StringListField, TextField } from '../../inspector/fields'

export function WarpForm({ value, onChange }: { value: WarpParams; onChange: (v: WarpParams) => void }) {
  const account = useWarpAccount()

  return (
    <>
      <TextField
        label="Тег outbound’а"
        value={value.tag}
        onChange={(v) => onChange({ ...value, tag: v ?? '' })}
      />
      <MultiSelectField
        label="Сервисы"
        hint="Категории geosite, которые пойдут через WARP"
        options={WARP_SERVICES}
        value={value.services.length > 0 ? value.services : undefined}
        onChange={(v) => onChange({ ...value, services: v ?? [] })}
      />
      <StringListField
        label="Свои домены и категории"
        hint="По одному в строке: example.com, domain:example.org, geosite:netflix"
        placeholder={'example.com\ngeosite:netflix'}
        value={value.domains.length > 0 ? value.domains : undefined}
        onChange={(v) => onChange({ ...value, domains: v ?? [] })}
      />
      <div className="row">
        <Button disabled={account.isPending} onClick={() => {
          account.mutate(undefined, {
            onSuccess: (data) =>
              onChange({
                ...value,
                secretKey: data.secretKey,
                addresses: data.address,
                reserved: data.reserved,
              }),
          })
        }}>
          {account.isPending ? 'Регистрируем…' : 'Получить ключи'}
        </Button>
        <span className="muted">Ключи выдаёт Cloudflare — как утилита wgcf</span>
      </div>
      {account.isError && <span className="field-error">{(account.error as Error).message}</span>}
      {/* Ключ и адреса заполняются кнопкой, поэтому поля перемонтируются по значению ключа */}
      <TextField
        label="Приватный ключ (secretKey)"
        mono
        value={value.secretKey}
        onChange={(v) => onChange({ ...value, secretKey: v ?? '' })}
      />
      <StringListField
        key={`addr:${value.secretKey}`}
        label="Адреса интерфейса"
        hint="Как в конфиге WireGuard: 172.16.0.2/32 и адрес IPv6"
        value={value.addresses.length > 0 ? value.addresses : undefined}
        onChange={(v) => onChange({ ...value, addresses: v ?? [] })}
      />
      <StringListField
        key={`res:${value.secretKey}`}
        label="Reserved (по числу на строку)"
        hint="Три байта client id WARP; нечисловые строки игнорируются"
        placeholder={'51\n68\n99'}
        value={value.reserved.length > 0 ? value.reserved.map(String) : undefined}
        onChange={(v) =>
          onChange({
            ...value,
            reserved: (v ?? []).map(Number).filter((n) => Number.isFinite(n)),
          })
        }
      />
      <NumberField label="MTU" value={value.mtu} onChange={(v) => onChange({ ...value, mtu: v ?? 1280 })} />
    </>
  )
}
```

`NumberField` принимает только `label`, `value`, `onChange`, `placeholder` — подсказки (`hint`) у него нет, поэтому пояснения к числовым полям в рецептах не пишем.

`frontend/src/features/recipes/forms/ChainForm.tsx`:

```tsx
import { CHAIN_PROTOCOLS, type ChainParams } from '../../../entities/xray'
import {
  CheckboxField,
  NumberField,
  SelectField,
  StringListField,
  TextField,
} from '../../inspector/fields'

export function ChainForm({
  value,
  outboundTags,
  onChange,
}: {
  value: ChainParams
  outboundTags: string[]
  onChange: (v: ChainParams) => void
}) {
  return (
    <>
      <TextField label="Тег outbound’а" value={value.tag} onChange={(v) => onChange({ ...value, tag: v ?? '' })} />
      <SelectField
        label="Протокол"
        value={value.protocol}
        options={CHAIN_PROTOCOLS}
        onChange={(v) => onChange({ ...value, protocol: v as ChainParams['protocol'] })}
      />
      <TextField
        label="Адрес сервера"
        value={value.address}
        onChange={(v) => onChange({ ...value, address: v ?? '' })}
      />
      <NumberField label="Порт" value={value.port} onChange={(v) => onChange({ ...value, port: v ?? 443 })} />
      {value.protocol === 'vless' && (
        <TextField
          label="UUID пользователя"
          mono
          value={value.uuid}
          onChange={(v) => onChange({ ...value, uuid: v ?? '' })}
        />
      )}
      {value.protocol === 'socks' && (
        <TextField
          label="Имя пользователя"
          value={value.username}
          onChange={(v) => onChange({ ...value, username: v ?? '' })}
        />
      )}
      {value.protocol !== 'vless' && (
        <TextField label="Пароль" value={value.password} onChange={(v) => onChange({ ...value, password: v ?? '' })} />
      )}
      <CheckboxField
        label="TLS"
        hint="serverName подставится по адресу сервера"
        value={value.tls}
        onChange={(v) => onChange({ ...value, tls: v === true })}
      />
      <SelectField
        label="Подключаться через outbound"
        hint="dialerProxy: соединение до этого сервера пойдёт через выбранный выход — второй хоп"
        value={value.dialerProxy}
        options={[
          { value: '', label: 'напрямую' },
          ...outboundTags.filter((t) => t !== value.tag).map((t) => ({ value: t, label: t })),
        ]}
        onChange={(v) => onChange({ ...value, dialerProxy: v })}
      />
      <StringListField
        label="Домены и категории"
        hint="Пусто — весь трафик пойдёт в цепочку"
        placeholder={'geosite:netflix\nexample.com'}
        value={value.domains.length > 0 ? value.domains : undefined}
        onChange={(v) => onChange({ ...value, domains: v ?? [] })}
      />
    </>
  )
}
```

- [ ] **Step 5: Прогнать тест**

Из `frontend`: `npx vitest run test/recipes-forms.test.tsx` → PASS, 3 теста.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/features/recipes frontend/src/shared/api frontend/test/recipes-forms.test.tsx
git commit -m "feat(frontend): recipe parameter forms and WARP account hook"
```

---

### Task 8: Диалог рецептов

**Files:**
- Create: `frontend/src/features/recipes/RecipesDialog.tsx`
- Modify: `frontend/src/shared/ui/tokens.css` (стили `.recipes-*`)
- Test: `frontend/test/recipes-dialog.test.tsx`

**Interfaces:**
- Consumes: `RECIPES`, `DEFAULT_PARAMS`, `planFor`, `validateFor`, `AllParams`, `RecipeId` из `entities/xray`; `DiffView` из `features/editor/DiffView`; формы из `./forms/*`.
- Produces: `RecipesDialog` с пропсами `{ open: boolean; config: XrayConfig; onApply: (config: XrayConfig) => void; onOpenGeo: () => void; onClose: () => void }`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/recipes-dialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RecipesDialog } from '../src/features/recipes/RecipesDialog'
import type { XrayConfig } from '../src/entities/xray'

const CONFIG = {
  inbounds: [{ tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } }],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
} as XrayConfig

function renderDialog(onApply = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RecipesDialog open config={CONFIG} onApply={onApply} onOpenGeo={() => {}} onClose={() => {}} />
    </QueryClientProvider>,
  )
  return onApply
}

describe('RecipesDialog', () => {
  it('показывает предпросмотр и применяет рецепт', async () => {
    const onApply = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: /Блокировка торрентов/ }))
    expect(screen.getByText(/outbound block/)).toBeInTheDocument()
    expect(screen.getByText(/протокол bittorrent/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Применить' }))
    const applied = onApply.mock.calls[0]![0] as XrayConfig
    expect(applied.routing!.rules![0]!.protocol).toEqual(['bittorrent'])
  })

  it('при пустом плане и при ошибке параметров «Применить» заблокирована', async () => {
    const applied = {
      ...CONFIG,
      outbounds: [
        { tag: 'direct', protocol: 'freedom', settings: {} },
        { tag: 'block', protocol: 'blackhole', settings: {} },
      ],
      routing: { rules: [{ domain: ['geosite:category-ads-all'], outboundTag: 'block' }] },
    } as XrayConfig
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <RecipesDialog open config={applied} onApply={vi.fn()} onOpenGeo={() => {}} onClose={() => {}} />
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: /Блокировка рекламы/ }))
    expect(screen.getByRole('button', { name: 'Применить' })).toBeDisabled()
    expect(screen.getByText(/уже есть/)).toBeInTheDocument()

    // WARP без ключа — ошибка валидации
    await userEvent.click(screen.getByRole('button', { name: /WARP для сервисов/ }))
    expect(screen.getByRole('button', { name: 'Применить' })).toBeDisabled()
    expect(screen.getByText(/Вставьте приватный ключ/)).toBeInTheDocument()
  })

  it('«Показать diff» рисует обе стороны сравнения', async () => {
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: /Блокировка рекламы/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Показать diff' }))
    expect(document.querySelectorAll('.cm-editor').length).toBe(2)
    await userEvent.click(screen.getByRole('button', { name: '← К параметрам' }))
    expect(screen.getByRole('button', { name: 'Применить' })).toBeInTheDocument()
  })

  it('замечание про geo даёт кнопку «Geo-базы»', async () => {
    const onOpenGeo = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <RecipesDialog open config={CONFIG} onApply={vi.fn()} onOpenGeo={onOpenGeo} onClose={() => {}} />
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: /Блокировка рекламы/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Geo-базы' }))
    expect(onOpenGeo).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из `frontend`: `npx vitest run test/recipes-dialog.test.tsx` → FAIL, модуля диалога нет.

- [ ] **Step 3: Создать `frontend/src/features/recipes/RecipesDialog.tsx`**

```tsx
import { useMemo, useState } from 'react'
import {
  DEFAULT_PARAMS,
  RECIPES,
  planFor,
  validateFor,
  type AllParams,
  type RecipeId,
  type XrayConfig,
} from '../../entities/xray'
import { Button, Dialog } from '../../shared/ui'
import { DiffView } from '../editor/DiffView'
import { BlockForm } from './forms/BlockForm'
import { ChainForm } from './forms/ChainForm'
import { TorrentForm } from './forms/TorrentForm'
import { WarpForm } from './forms/WarpForm'

interface Props {
  open: boolean
  config: XrayConfig
  onApply: (config: XrayConfig) => void
  onOpenGeo: () => void
  onClose: () => void
}

export function RecipesDialog({ open, config, onApply, onOpenGeo, onClose }: Props) {
  const [id, setId] = useState<RecipeId>('warp')
  // Параметры всех рецептов держим сразу: переключение списка не теряет введённое
  const [params, setParams] = useState<AllParams>(DEFAULT_PARAMS)
  const [diff, setDiff] = useState(false)

  const plan = useMemo(() => planFor(config, id, params), [config, id, params])
  const error = validateFor(id, params)
  const canApply = error === null && plan.changes.some((c) => c.status === 'add')

  const inboundTags = (config.inbounds ?? [])
    .map((i) => i.tag)
    .filter((t): t is string => typeof t === 'string')
  const outboundTags = (config.outbounds ?? [])
    .map((o) => o.tag)
    .filter((t): t is string => typeof t === 'string')

  function apply() {
    onApply(plan.config)
    setDiff(false)
    onClose()
  }

  return (
    <Dialog open={open} title="Рецепты" onClose={onClose} wide>
      {diff ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Слева — текущий черновик, справа — каким он станет после рецепта.
          </p>
          <DiffView
            original={JSON.stringify(config, null, 2)}
            modified={JSON.stringify(plan.config, null, 2)}
            maxHeight="55vh"
          />
          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={() => setDiff(false)}>
              ← К параметрам
            </Button>
            <span className="spacer" />
            <Button variant="primary" disabled={!canApply} onClick={apply}>
              Применить
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="recipes-layout">
            <div className="recipe-list">
              {RECIPES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={r.id === id ? 'recipe-item recipe-item-active' : 'recipe-item'}
                  aria-pressed={r.id === id}
                  onClick={() => setId(r.id)}
                >
                  <span className="recipe-item-title">{r.title}</span>
                  <span className="recipe-item-summary">{r.summary}</span>
                </button>
              ))}
            </div>

            <div className="recipe-body">
              {id === 'warp' && (
                <WarpForm value={params.warp} onChange={(warp) => setParams({ ...params, warp })} />
              )}
              {id === 'torrent' && (
                <TorrentForm
                  value={params.torrent}
                  inboundTags={inboundTags}
                  onChange={(torrent) => setParams({ ...params, torrent })}
                />
              )}
              {id === 'ads' && (
                <BlockForm value={params.ads} onChange={(ads) => setParams({ ...params, ads })} />
              )}
              {id === 'private' && (
                <BlockForm value={params.private} onChange={(v) => setParams({ ...params, private: v })} />
              )}
              {id === 'chain' && (
                <ChainForm
                  value={params.chain}
                  outboundTags={outboundTags}
                  onChange={(chain) => setParams({ ...params, chain })}
                />
              )}

              <h3 className="recipe-preview-title">Будет добавлено</h3>
              <ul className="recipe-changes" aria-label="Изменения рецепта">
                {plan.changes.map((c, i) => (
                  <li key={`${c.text}:${i}`} className={c.status === 'add' ? 'recipe-add' : 'recipe-exists'}>
                    <span aria-hidden="true">{c.status === 'add' ? '+' : '✓'}</span> {c.text}
                  </li>
                ))}
              </ul>

              {plan.notes.map((n) => (
                <p key={n.text} className="recipe-note">
                  {n.text}
                  {n.needsGeo === true && (
                    <Button variant="ghost" onClick={onOpenGeo}>
                      Geo-базы
                    </Button>
                  )}
                </p>
              ))}

              {error !== null && <span className="field-error">{error}</span>}
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <span className="spacer" />
            <Button onClick={() => setDiff(true)}>Показать diff</Button>
            <Button variant="primary" disabled={!canApply} onClick={apply}>
              Применить
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}
```

- [ ] **Step 4: Добавить стили**

В конец `frontend/src/shared/ui/tokens.css`:

```css
/* --- Рецепты --- */
.recipes-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 16px;
  align-items: start;
}
.recipe-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-right: 1px solid var(--border);
  padding-right: 12px;
}
.recipe-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.recipe-item:hover {
  background: var(--rail);
}
.recipe-item-active {
  background: var(--rail);
  border-color: var(--flux);
}
.recipe-item-title {
  font-weight: 600;
}
.recipe-item-summary {
  font-size: 12px;
  color: var(--ink-dim);
}
.recipe-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.recipe-preview-title {
  margin: 6px 0 0;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-dim);
}
.recipe-changes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 13px;
}
.recipe-add {
  color: var(--ink);
}
.recipe-exists {
  color: var(--ink-dim);
}
.recipe-note {
  margin: 0;
  font-size: 13px;
  color: var(--ink-dim);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
```

Используемые токены уже есть в начале файла: `--ink`, `--ink-dim`, `--rail`, `--border`,
`--flux`, `--radius-xs`, `--font-mono`, `--dur`, `--ease`. Обратите внимание: `--t-sm` — это
размер шрифта (12px), а не длительность анимации.

- [ ] **Step 5: Прогнать тест**

Из `frontend`: `npx vitest run test/recipes-dialog.test.tsx` → PASS, 4 теста.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/features/recipes/RecipesDialog.tsx frontend/src/shared/ui/tokens.css frontend/test/recipes-dialog.test.tsx
git commit -m "feat(frontend): recipes dialog with change preview and diff"
```

---

### Task 9: Подключение к редактору

**Files:**
- Modify: `frontend/src/features/topology/TopologyView.tsx` (проп `onOpenRecipes`, кнопка в доке)
- Modify: `frontend/src/features/editor/EditorPage.tsx` (состояние, монтирование диалога)
- Test: `frontend/e2e/recipes.spec.ts`

**Interfaces:**
- Consumes: `RecipesDialog` из `features/recipes/RecipesDialog`.
- Produces: проп `onOpenRecipes?: () => void` у `TopologyView`; кнопка «+ Рецепт» в доке.

- [ ] **Step 1: Написать падающий e2e**

Создать `frontend/e2e/recipes.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'

test('рецепт блокировки торрентов применяется и откатывается', async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node').first()).toBeVisible()

  await page.getByRole('button', { name: '+ Рецепт' }).click()
  await page.getByRole('button', { name: /Блокировка торрентов/ }).click()
  await expect(page.getByText(/протокол bittorrent/)).toBeVisible()

  await page.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(page.locator('.react-flow__node[data-id="out:block"]')).toBeVisible()

  // Рецепт — один снимок истории: Ctrl+Z убирает всё разом
  await page.keyboard.press('Control+z')
  await expect(page.locator('.react-flow__node[data-id="out:block"]')).toHaveCount(0)
})

test('повторное применение показывает, что всё уже есть', async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node').first()).toBeVisible()

  await page.getByRole('button', { name: '+ Рецепт' }).click()
  await page.getByRole('button', { name: /Блокировка рекламы/ }).click()
  await page.getByRole('button', { name: 'Применить', exact: true }).click()

  await page.getByRole('button', { name: '+ Рецепт' }).click()
  await page.getByRole('button', { name: /Блокировка рекламы/ }).click()
  await expect(page.getByText(/уже есть/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Применить', exact: true })).toBeDisabled()
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из `frontend`: `npm run e2e -w frontend -- recipes.spec.ts` (или из каталога `frontend`: `npx playwright test recipes.spec.ts`)
Ожидание: FAIL — кнопки «+ Рецепт» нет.

- [ ] **Step 3: Добавить кнопку в док топологии**

В `frontend/src/features/topology/TopologyView.tsx` в интерфейс пропсов (рядом с `dockExtra`) добавить:

```ts
  /** Открыть библиотеку рецептов; кнопка появляется только когда обработчик передан */
  onOpenRecipes?: () => void
```

добавить `onOpenRecipes` в деструктуризацию пропсов компонента и в доке, после кнопки «+ Правило»:

```tsx
          {onOpenRecipes && <Button onClick={onOpenRecipes}>+ Рецепт</Button>}
```

- [ ] **Step 4: Подключить диалог в редакторе**

В `frontend/src/features/editor/EditorPage.tsx`:

импорт рядом с прочими диалогами:

```ts
import { RecipesDialog } from '../recipes/RecipesDialog'
```

состояние рядом с `const [geoOpen, setGeoOpen] = useState(false)`:

```ts
const [recipesOpen, setRecipesOpen] = useState(false)
```

в `<TopologyView …>` добавить проп:

```tsx
                onOpenRecipes={() => setRecipesOpen(true)}
```

и рядом с `<GeoDataDialog …/>` смонтировать диалог:

```tsx
      {parsedConfig !== undefined && (
        <RecipesDialog
          open={recipesOpen}
          config={parsedConfig}
          onApply={(next) => {
            changeConfig(next)
            // Правила вставляются в начало: позиционные rule:N сдвигаются
            setSelectedNode(null)
          }}
          onOpenGeo={() => {
            setRecipesOpen(false)
            setGeoOpen(true)
          }}
          onClose={() => setRecipesOpen(false)}
        />
      )}
```

- [ ] **Step 5: Прогнать e2e и юнит-тесты**

Из `frontend`: `npx playwright test recipes.spec.ts` → PASS, 2 сценария.
Затем весь фронтовый прогон: `npx vitest run` → PASS.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/features/topology/TopologyView.tsx frontend/src/features/editor/EditorPage.tsx frontend/e2e/recipes.spec.ts
git commit -m "feat(frontend): open the recipe library from the topology dock"
```

---

### Task 10: Рецепты при создании профиля

**Files:**
- Modify: `frontend/src/features/profiles/CreateProfileDialog.tsx`
- Test: `frontend/test/create-profile.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `planFor`, `DEFAULT_PARAMS`, `XrayConfigSchema` из `entities/xray`.
- Produces: чекбоксы рецептов в диалоге создания; конфиг уходит в панель уже с применёнными рецептами.

- [ ] **Step 1: Написать падающий тест**

Дописать в `frontend/test/create-profile.test.tsx` новый `describe` в конец файла. В этом файле
нет мока хука — запросы перехватываются `vi.stubGlobal('fetch', …)`, а `renderDialog()` уже
объявлен выше по файлу; `afterEach(() => vi.unstubAllGlobals())` там тоже уже есть:

```tsx
describe('CreateProfileDialog — рецепты', () => {
  it('отмеченные рецепты применяются к шаблону перед созданием', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/profiles')) {
        return new Response(
          JSON.stringify({ profile: { uuid: 'p1', name: 'Germany', config: {} } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`неожиданный запрос: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDialog()
    await userEvent.type(screen.getByLabelText('Имя профиля'), 'Germany 1')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Блокировать торренты' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Блокировать рекламу' }))
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))

    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/profiles'))).toBe(true)
    })
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/profiles'))!
    const sent = JSON.parse(String((call[1] as RequestInit).body)) as {
      config: {
        outbounds: { tag: string }[]
        routing: { rules: { protocol?: string[]; domain?: string[] }[] }
      }
    }
    expect(sent.config.outbounds.some((o) => o.tag === 'block')).toBe(true)
    expect(sent.config.routing.rules.some((r) => r.protocol?.[0] === 'bittorrent')).toBe(true)
    expect(sent.config.routing.rules.some((r) => r.domain?.[0] === 'geosite:category-ads-all')).toBe(
      true,
    )
  })
})
```

Вызов `fetchMock` объявлен с одним аргументом, но `apiFetch` передаёт второй — в тесте он
читается через `call[1]`, как в соседнем тесте файла.

- [ ] **Step 2: Убедиться, что тест падает**

Из `frontend`: `npx vitest run test/create-profile.test.tsx` → FAIL: чекбокса «Блокировать торренты» нет.

- [ ] **Step 3: Реализовать чекбоксы**

В `frontend/src/features/profiles/CreateProfileDialog.tsx`:

```ts
import { DEFAULT_PARAMS, XrayConfigSchema, planFor, type RecipeId } from '../../entities/xray'
import { Checkbox } from '../../shared/ui'

// Рецепты без обязательных параметров — их можно применить сразу при создании
const CREATE_RECIPES: { id: RecipeId; label: string }[] = [
  { id: 'torrent', label: 'Блокировать торренты' },
  { id: 'ads', label: 'Блокировать рекламу' },
  { id: 'private', label: 'Блокировать локальные сети' },
]

function withRecipes(base: unknown, picks: RecipeId[]): unknown {
  if (picks.length === 0) return base
  let config = XrayConfigSchema.parse(base)
  for (const id of picks) config = planFor(config, id, DEFAULT_PARAMS).config
  return config
}
```

в компоненте — состояние и разметка:

```tsx
  const [picks, setPicks] = useState<RecipeId[]>([])
```

```tsx
      <div className="field">
        <span className="field-label">Готовые рецепты</span>
        {CREATE_RECIPES.map((r) => (
          <Checkbox
            key={r.id}
            label={r.label}
            checked={picks.includes(r.id)}
            onChange={(on) =>
              setPicks((prev) => (on ? [...prev, r.id] : prev.filter((id) => id !== r.id)))
            }
          />
        ))}
      </div>
```

и в `submit` обернуть конфиг:

```ts
    create.mutate(
      { name, config: withRecipes(config, picks) },
      { onSuccess: (profile) => navigate(`/profiles/${profile.uuid}`) },
    )
```

`Checkbox` принимает `{ label, checked, onChange }` — ровно как в коде выше; галочка получает accessible-имя из `label`, поэтому в тесте она находится через `getByRole('checkbox', { name: … })`.

- [ ] **Step 4: Прогнать тест**

Из `frontend`: `npx vitest run test/create-profile.test.tsx` → PASS, включая новый тест.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/profiles/CreateProfileDialog.tsx frontend/test/create-profile.test.tsx
git commit -m "feat(frontend): apply blocking recipes when creating a profile"
```

---

### Task 11: Документация и полный прогон

**Files:**
- Modify: `README.md` (раздел про рецепты + строка в списке возможностей)
- Modify: `CLAUDE.md` (абзац про слой рецептов)
- Modify: `frontend/src/features/editor/ShortcutsDialog.tsx` — **не трогаем**, хоткея у рецептов нет

- [ ] **Step 1: Дополнить README**

После существующего раздела «↩️ Отмена, клавиши и файлы» добавить:

```markdown
## 🧩 Рецепты

Кнопка «+ Рецепт» в доке топологии открывает библиотеку готовых заготовок:

| Рецепт | Что добавляет |
| --- | --- |
| WARP для сервисов | wireguard-outbound Cloudflare и правило на выбранные категории (OpenAI, Google, Netflix…) |
| Блокировка торрентов | правило по протоколу `bittorrent` в blackhole и включение sniffing |
| Блокировка рекламы | `geosite:category-ads-all` в blackhole |
| Блокировка локальных сетей | `geoip:private` и `geosite:private` в blackhole — закрывает клиентам локальную сеть ноды |
| Цепочка через другой сервер | outbound vless/trojan/socks на второй сервер, при желании через `dialerProxy` |

Рецепт не заменяет конфиг, а складывается с ним: занятый тег переиспользуется, такое же
правило не дублируется, а список изменений виден до применения («+ добавим», «✓ уже есть»).
Кнопка «Показать diff» сравнивает черновик с результатом. Применение — один шаг истории:
Ctrl+Z откатывает рецепт целиком.

Ключи WARP можно вставить вручную (их выдаёт `wgcf`) или получить кнопкой «Получить ключи» —
сервер зарегистрирует бесплатный аккаунт в Cloudflare. Ручка неофициальная: при отказе
показывается сообщение, а поля остаются доступны для ручного ввода.

Рецепты блокировок доступны и при создании профиля — чекбоксами в диалоге «Создать профиль».
```

В списке возможностей в начале README добавить строку:

```markdown
- **Рецепты** — WARP, блокировка торрентов и рекламы, защита локальной сети, цепочка через второй сервер.
```

- [ ] **Step 2: Дополнить CLAUDE.md**

В раздел «Frontend» после абзаца про `features/diagnostics` добавить:

```markdown
- `entities/xray/recipes` — библиотека рецептов чистыми функциями `plan(config, params) →
  { config, changes, notes }`: вход не мутируется, идемпотентность держится на трёх примитивах
  (`ensureOutbound`/`ensureRule`/`ensureSniffing`) из `apply.ts`. Правила вставляются в начало
  `routing.rules` (в Xray выигрывает первое совпавшее), маршрутные — сразу за ведущей серией
  блокирующих. Реестр в `recipes/index.ts`: `planFor`/`validateFor` разводят рецепты switch’ем
  по `RecipeId`, параметры всех рецептов лежат одной картой `AllParams` — так `RecipesDialog`
  не теряет введённое при переключении списка. UI — `features/recipes` (диалог + формы
  параметров), вход через кнопку «+ Рецепт» в доке топологии, применение идёт через
  `changeConfig` (то есть одним снимком истории).
```

- [ ] **Step 3: Полный прогон**

Из корня репозитория:

```bash
npm test -w backend
npm run typecheck -w backend
npm run typecheck -w frontend
npm run build
```

Из каталога `frontend`:

```bash
npx vitest run
npx playwright test
```

Ожидание: все зелёные. Ориентир по числам: backend 188 → ~193, frontend 542 → ~575, e2e 43 → 45.

- [ ] **Step 4: Коммит**

```bash
git add README.md CLAUDE.md
git commit -m "docs: describe the recipe library"
```

---

## Проверка после реализации

Автоматические тесты не покрывают одного: настоящий ответ Cloudflare. Ручка
`POST /api/tools/warp-account` проверена только на стабе `fetch`, а урок этапа 3 фазы 3 гласит,
что заглушки показывают лишь заложенное. Поэтому после Task 6 (или в конце работы) —
одна живая проверка из запущенного бэкенда:

```bash
curl -s -X POST http://localhost:3000/api/tools/warp-account -H 'content-type: application/json' -b <cookie> | head -c 400
```

Ожидание: JSON с `secretKey` длиной 44 символа, двумя адресами и тремя числами в `reserved`.
Если форма ответа Cloudflare изменилась — правится `regSchema` в `backend/src/tools/warp.ts`,
и текст ошибки должен остаться понятным пользователю.
