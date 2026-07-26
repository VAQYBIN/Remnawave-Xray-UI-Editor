# Балансеры и обсерватория — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Балансировка нагрузки становится частью топологии: узел балансера между правилами и
outbound'ами, узел глобальной обсерватории, формы, валидации, трассировка до списка кандидатов и
рецепт «Балансировка».

**Architecture:** Всё живёт во фронтенде — бэкенд не трогаем: балансеры это часть JSON-конфига,
который редактор и так целиком гоняет через черновик. Слои прежние: `entities/xray` (схемы и
чистые функции) → `entities/graph` (узлы, рёбра, мутации) → `features/*` (React). Единственная
реализация префиксного сопоставления тегов лежит в `entities/xray/balancers.ts` и потребляется
всеми — граф, формы, валидации, трассировка, рецепт.

**Tech Stack:** TypeScript, React 19, zod, @xyflow/react, vitest + @testing-library, Playwright.

Спека: `docs/superpowers/specs/2026-07-26-balancers-design.md`.

## Global Constraints

- Язык UI, подсказок и сообщений об ошибках — **русский**. Коммиты — английские, conventional
  (`feat(frontend): ...`).
- Все команды запускаются из каталога `frontend`: `npx vitest run test/<file>`,
  `npm run typecheck -w frontend`, `npm run e2e -w frontend`.
- Схемы zod остаются `passthrough` на всех уровнях: незнакомые поля чужих конфигов не теряются.
- Чистые функции конфига **не мутируют вход** и возвращают **тот же объект по ссылке**, когда
  делать нечего (вызывающий сравнивает через `===`).
- Термины в коде и UI: балансер (`bal:<tag>`), обсерватория (узел `obs`), кандидаты — теги
  outbound'ов, попавшие под `selector`.
- Семантика Xray, на которую всё опирается: `selector` матчит теги outbound'ов **по префиксу**;
  при одновременно заданных `outboundTag` и `balancerTag` действует `outboundTag`; `leastPing`
  требует `observatory`, `leastLoad` — `burstObservatory`; обе секции глобальны (по одной на
  конфиг).

## Структура файлов

**Создаются:**

| Файл | Ответственность |
|---|---|
| `frontend/src/entities/xray/balancers.ts` | Схема балансера, префиксное сопоставление, `expandSelector` |
| `frontend/src/entities/xray/observatory.ts` | Схемы обеих обсерваторий, покрытие `subjectSelector`, `ensureObservatorySection` |
| `frontend/src/entities/xray/recipes/balance.ts` | Рецепт «Балансировка» |
| `frontend/src/features/inspector/BalancerForm.tsx` | Форма узла балансера |
| `frontend/src/features/inspector/ObservatoryForm.tsx` | Форма узла обсерватории |
| `frontend/src/features/recipes/forms/BalanceForm.tsx` | Параметры рецепта |
| `frontend/test/xray-balancers.test.ts` | Чистые функции и схемы |
| `frontend/test/graph-balancers.test.ts` | Мутации и сборка графа |
| `frontend/test/balancer-form.test.tsx` | Формы балансера и обсерватории |
| `frontend/test/recipes-balance.test.ts` | Рецепт |
| `frontend/e2e/balancers.spec.ts` | Сквозной сценарий |

**Правятся:** `entities/xray/{routing,config,index,docSchema}.ts`, `entities/xray/trace.ts`,
`entities/xray/recipes/{apply,index}.ts`, `entities/graph/{types,buildGraph,mutations,locate,search}.ts`,
`features/topology/{TopologyView,nodes,edges,NodeInspector}.tsx`, `features/recipes/RecipesDialog.tsx`,
`features/diagnostics/TracePanel.tsx`, `features/editor/EditorPage.tsx`,
`features/editor/intellisense/context.ts`, `shared/ui/tokens.css`, `test/xray-config.test.ts`,
`test/trace.test.ts`, `CLAUDE.md`.

---

### Task 1: Схемы и чистые функции балансеров и обсерватории

**Files:**
- Create: `frontend/src/entities/xray/balancers.ts`, `frontend/src/entities/xray/observatory.ts`
- Modify: `frontend/src/entities/xray/routing.ts`, `frontend/src/entities/xray/config.ts:21-37`,
  `frontend/src/entities/xray/index.ts`
- Test: `frontend/test/xray-balancers.test.ts`

**Interfaces:**
- Consumes: `XrayConfig` из `./config` (только как тип — `import type`, иначе получится
  runtime-цикл `config → routing → balancers → config`).
- Produces:
  - `BALANCER_STRATEGIES: readonly ['random','roundRobin','leastPing','leastLoad']`
  - `BalancerSchema`, `type Balancer = z.infer<typeof BalancerSchema>`
  - `matchPrefixes(tags: string[], prefixes: string[] | undefined): string[]`
  - `balancerCandidates(config: XrayConfig, balancer: Balancer): string[]`
  - `outboundTagsOf(config: XrayConfig): string[]`
  - `findBalancer(config: XrayConfig, tag: string): Balancer | undefined`
  - `expandSelector(config: XrayConfig, balancerTag: string, dropTag: string): XrayConfig`
  - `ObservatorySchema`, `BurstObservatorySchema`, `type Observatory`, `type BurstObservatory`
  - `subjectCovers(subjectSelector: string[] | undefined, tag: string): boolean`
  - `ensureObservatorySection(config, kind: 'observatory' | 'burst', subjects: string[]): XrayConfig`

**Важное решение по схеме:** `strategy.type` хранится **строкой**, а не `z.enum`. Незнакомая
стратегия из чужого конфига должна давать предупреждение (Task 2), а не рушить разбор всего
конфига и блокировать редактор.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/xray-balancers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  balancerCandidates, expandSelector, findBalancer, matchPrefixes,
} from '../src/entities/xray/balancers'
import { ensureObservatorySection, subjectCovers } from '../src/entities/xray/observatory'
import { validateXrayConfig } from '../src/entities/xray/config'

const base = () => ({
  outbounds: [
    { tag: 'proxy-de', protocol: 'vless' },
    { tag: 'proxy-nl', protocol: 'vless' },
    { tag: 'direct', protocol: 'freedom' },
  ],
  routing: {
    rules: [],
    balancers: [{ tag: 'bal-eu', selector: ['proxy-'], strategy: { type: 'leastPing' } }],
  },
})

describe('balancers', () => {
  it('matchPrefixes выбирает теги по префиксу, а не по подстроке', () => {
    expect(matchPrefixes(['proxy-de', 'proxy-nl', 'direct', 'my-proxy-x'], ['proxy-']))
      .toEqual(['proxy-de', 'proxy-nl'])
  })

  it('пустой и отсутствующий selector не дают кандидатов', () => {
    expect(matchPrefixes(['a', 'b'], [])).toEqual([])
    expect(matchPrefixes(['a', 'b'], undefined)).toEqual([])
  })

  it('balancerCandidates считает кандидатов по конфигу', () => {
    const cfg = base()
    expect(balancerCandidates(cfg, cfg.routing.balancers[0])).toEqual(['proxy-de', 'proxy-nl'])
    expect(balancerCandidates(cfg, { tag: 'x', selector: ['proxy-de'] })).toEqual(['proxy-de'])
  })

  it('findBalancer ищет по тегу', () => {
    expect(findBalancer(base(), 'bal-eu')?.selector).toEqual(['proxy-'])
    expect(findBalancer(base(), 'нет')).toBeUndefined()
  })

  it('expandSelector разворачивает префикс в точные теги без выброшенного', () => {
    const cfg = base()
    const next = expandSelector(cfg, 'bal-eu', 'proxy-nl')
    expect(next.routing.balancers[0].selector).toEqual(['proxy-de'])
    expect(cfg.routing.balancers[0].selector).toEqual(['proxy-']) // вход не мутирован
  })

  it('expandSelector на неизвестном балансере возвращает тот же конфиг', () => {
    const cfg = base()
    expect(expandSelector(cfg, 'нет', 'proxy-nl')).toBe(cfg)
  })

  it('subjectCovers работает по префиксу', () => {
    expect(subjectCovers(['proxy-'], 'proxy-de')).toBe(true)
    expect(subjectCovers(['proxy-de'], 'proxy-nl')).toBe(false)
    expect(subjectCovers(undefined, 'proxy-de')).toBe(false)
  })

  it('ensureObservatorySection создаёт секцию и дополняет subjectSelector, не затирая чужое', () => {
    const created = ensureObservatorySection(base(), 'observatory', ['proxy-de'])
    expect(created.observatory).toEqual({ subjectSelector: ['proxy-de'] })

    const extended = ensureObservatorySection(
      { ...base(), burstObservatory: { subjectSelector: ['other'], pingConfig: { interval: '1m' } } },
      'burst',
      ['proxy-de', 'other'],
    )
    expect(extended.burstObservatory).toEqual({
      subjectSelector: ['other', 'proxy-de'],
      pingConfig: { interval: '1m' },
    })
  })

  it('ensureObservatorySection ничего не делает, когда всё уже покрыто', () => {
    const cfg = { ...base(), observatory: { subjectSelector: ['proxy-'] } }
    expect(ensureObservatorySection(cfg, 'observatory', ['proxy-de'])).toBe(cfg)
  })

  it('схема принимает балансер и обсерваторию и не теряет чужие поля', () => {
    const text = JSON.stringify({
      outbounds: [{ tag: 'proxy-de', protocol: 'vless' }],
      routing: {
        balancers: [
          { tag: 'bal', selector: ['proxy-'], fallbackTag: 'proxy-de',
            strategy: { type: 'leastLoad', settings: { expected: 2 } }, futureField: 1 },
        ],
      },
      observatory: { subjectSelector: ['proxy-'], probeUrl: 'https://x/generate_204', unknown: true },
      burstObservatory: { subjectSelector: ['proxy-'], pingConfig: { interval: '1m', sampling: 10 } },
    })
    const res = validateXrayConfig(text)
    expect(res.ok).toBe(true)
    expect((res.config as Record<string, never>)).toBeDefined()
  })

  it('незнакомая стратегия не рушит разбор конфига', () => {
    const text = JSON.stringify({
      outbounds: [{ tag: 'proxy-de', protocol: 'vless' }],
      routing: { balancers: [{ tag: 'bal', selector: ['proxy-'], strategy: { type: 'futureStrategy' } }] },
    })
    expect(validateXrayConfig(text).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run test/xray-balancers.test.ts`
Expected: FAIL — `Failed to resolve import "../src/entities/xray/balancers"`.

- [ ] **Step 3: Написать `balancers.ts`**

```ts
// Балансеры маршрутизации. Ключевая деталь домена: selector матчит теги outbound'ов
// ПО ПРЕФИКСУ — ["proxy-"] захватывает proxy-de и proxy-nl. Единственная реализация
// этого правила живёт здесь; граф, формы, валидации, трассировка и рецепт зовут её.

import { z } from 'zod'
import type { XrayConfig } from './config'

export const BALANCER_STRATEGIES = ['random', 'roundRobin', 'leastPing', 'leastLoad'] as const

// strategy.type — строка, а не z.enum: незнакомая стратегия из чужого конфига должна
// давать предупреждение, а не рушить разбор всего конфига
export const BalancerSchema = z
  .object({
    tag: z.string(),
    selector: z.array(z.string()).optional(),
    fallbackTag: z.string().optional(),
    strategy: z
      .object({
        type: z.string().optional(),
        settings: z.object({}).passthrough().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export type Balancer = z.infer<typeof BalancerSchema>

export function matchPrefixes(tags: string[], prefixes: string[] | undefined): string[] {
  const list = prefixes ?? []
  if (list.length === 0) return []
  return tags.filter((tag) => list.some((p) => tag.startsWith(p)))
}

export function outboundTagsOf(config: XrayConfig): string[] {
  return (config.outbounds ?? [])
    .map((o) => o.tag)
    .filter((t): t is string => typeof t === 'string')
}

export function balancerCandidates(config: XrayConfig, balancer: Balancer): string[] {
  return matchPrefixes(outboundTagsOf(config), balancer.selector)
}

export function findBalancer(config: XrayConfig, tag: string): Balancer | undefined {
  return (config.routing?.balancers ?? []).find((b) => b.tag === tag)
}

/**
 * Разворачивает selector в точные теги текущих кандидатов, выбрасывая dropTag.
 * Нужно разрыву ребра, кандидат которого пришёл из префикса: убрать одного,
 * не переписав префикс, нельзя. Неизвестный балансер — ТОТ ЖЕ конфиг.
 */
export function expandSelector(
  config: XrayConfig,
  balancerTag: string,
  dropTag: string,
): XrayConfig {
  const index = (config.routing?.balancers ?? []).findIndex((b) => b.tag === balancerTag)
  if (index === -1) return config
  const next = structuredClone(config)
  const balancer = next.routing!.balancers![index]!
  balancer.selector = balancerCandidates(config, balancer).filter((t) => t !== dropTag)
  return next
}
```

`balancers.ts` **не реэкспортирует** `observatory.ts`: оба модуля выставляются наружу из
`entities/xray/index.ts`, а двойной путь к одному имени только запутывает импорты.

- [ ] **Step 4: Написать `observatory.ts`**

```ts
// Глобальные секции проверки живости outbound'ов. Их ровно две на конфиг:
// observatory (нужна стратегии leastPing) и burstObservatory (leastLoad).
// subjectSelector, как и selector балансера, матчит теги по префиксу.

import { z } from 'zod'
import type { XrayConfig } from './config'

export const ObservatorySchema = z
  .object({
    subjectSelector: z.array(z.string()).optional(),
    probeUrl: z.string().optional(),
    probeInterval: z.string().optional(),
    enableConcurrency: z.boolean().optional(),
  })
  .passthrough()

export const PingConfigSchema = z
  .object({
    destination: z.string().optional(),
    connectivity: z.string().optional(),
    interval: z.string().optional(),
    sampling: z.number().optional(),
    timeout: z.string().optional(),
    httpMethod: z.string().optional(),
  })
  .passthrough()

export const BurstObservatorySchema = z
  .object({
    subjectSelector: z.array(z.string()).optional(),
    pingConfig: PingConfigSchema.optional(),
  })
  .passthrough()

export type Observatory = z.infer<typeof ObservatorySchema>
export type BurstObservatory = z.infer<typeof BurstObservatorySchema>

export type ObservatoryKind = 'observatory' | 'burst'

export function subjectCovers(subjectSelector: string[] | undefined, tag: string): boolean {
  return (subjectSelector ?? []).some((p) => tag.startsWith(p))
}

/**
 * Создаёт секцию или ДОПОЛНЯЕТ её subjectSelector непокрытыми тегами. Чужие значения
 * не затираются: секция общая на конфиг, и другой балансер мог вписать туда своё.
 * Когда добавлять нечего — ТОТ ЖЕ конфиг.
 */
export function ensureObservatorySection(
  config: XrayConfig,
  kind: ObservatoryKind,
  subjects: string[],
): XrayConfig {
  const key = kind === 'burst' ? 'burstObservatory' : 'observatory'
  const current = config[key] as { subjectSelector?: string[] } | undefined
  const existing = current?.subjectSelector ?? []
  const missing = subjects.filter((tag) => !subjectCovers(existing, tag))
  if (current !== undefined && missing.length === 0) return config
  return {
    ...config,
    [key]: { ...(current ?? {}), subjectSelector: [...existing, ...missing] },
  }
}
```

- [ ] **Step 5: Подключить схемы в `routing.ts` и `config.ts`**

В `routing.ts` заменить `balancers: z.array(obj()).optional()` на:

```ts
import { BalancerSchema } from './balancers'
// ...
    balancers: z.array(BalancerSchema).optional(),
```

В `config.ts` заменить две строки (`config.ts:33-34`):

```ts
import { BurstObservatorySchema, ObservatorySchema } from './observatory'
// ...
    observatory: ObservatorySchema.optional(),
    burstObservatory: BurstObservatorySchema.optional(),
```

В `entities/xray/index.ts` добавить реэкспорт **после** `./config` (порядок важен только для
читаемости, циклов нет — `balancers.ts` берёт `XrayConfig` через `import type`):

```ts
export * from './balancers'
export * from './observatory'
```

- [ ] **Step 6: Запустить тесты и typecheck**

Run: `npx vitest run test/xray-balancers.test.ts && npm run typecheck -w frontend`
Expected: PASS, typecheck без ошибок.

- [ ] **Step 7: Прогнать весь фронтовый набор — схема стала строже**

Run: `npx vitest run`
Expected: PASS. Если падает `xray-config.test.ts` на конфиге с балансером без `tag` — это
ожидаемо: поправьте фикстуру, добавив тег, схема теперь требует его.

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/entities/xray/balancers.ts frontend/src/entities/xray/observatory.ts \
        frontend/src/entities/xray/routing.ts frontend/src/entities/xray/config.ts \
        frontend/src/entities/xray/index.ts frontend/test/xray-balancers.test.ts
git commit -m "feat(frontend): schemas and prefix matching for balancers"
```

---

### Task 2: Валидации балансеров в `analyzeIntegrity`

**Files:**
- Modify: `frontend/src/entities/xray/config.ts:61-151`
- Test: `frontend/test/xray-config.test.ts`

**Interfaces:**
- Consumes: `balancerCandidates`, `BALANCER_STRATEGIES`, `subjectCovers` (Task 1).
- Produces: диагностики с путями `['routing','balancers',i,'tag'|'selector'|'fallbackTag'|'strategy']`
  и `['routing','rules',i,'balancerTag']` — на них завяжется Task 5.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `frontend/test/xray-config.test.ts`:

```ts
describe('валидация балансеров', () => {
  const cfg = (balancers: unknown[], extra: Record<string, unknown> = {}) => ({
    outbounds: [
      { tag: 'proxy-de', protocol: 'vless' },
      { tag: 'direct', protocol: 'freedom' },
    ],
    routing: { rules: [], balancers },
    ...extra,
  })

  const messages = (config: unknown) =>
    analyzeIntegrity(config as never).map((i) => `${i.level}:${i.path}:${i.message}`)

  it('дубликат тега балансера — ошибка', () => {
    const found = messages(cfg([
      { tag: 'bal', selector: ['proxy-'] },
      { tag: 'bal', selector: ['proxy-'] },
    ]))
    expect(found.some((m) => m.startsWith('error:routing.balancers.1.tag'))).toBe(true)
  })

  it('селектор без совпадений — ошибка', () => {
    const found = messages(cfg([{ tag: 'bal', selector: ['нет-такого-'] }]))
    expect(found.some((m) => m.startsWith('error:routing.balancers.0.selector'))).toBe(true)
  })

  it('пустой селектор — ошибка', () => {
    const found = messages(cfg([{ tag: 'bal', selector: [] }]))
    expect(found.some((m) => m.startsWith('error:routing.balancers.0.selector'))).toBe(true)
  })

  it('висячий fallbackTag — предупреждение', () => {
    const found = messages(cfg([{ tag: 'bal', selector: ['proxy-'], fallbackTag: 'нет' }]))
    expect(found.some((m) => m.startsWith('warning:routing.balancers.0.fallbackTag'))).toBe(true)
  })

  it('leastPing без observatory — предупреждение, с ней — нет', () => {
    const bal = [{ tag: 'bal', selector: ['proxy-'], strategy: { type: 'leastPing' } }]
    expect(messages(cfg(bal)).some((m) => m.startsWith('warning:routing.balancers.0.strategy'))).toBe(true)
    const ok = messages(cfg(bal, { observatory: { subjectSelector: ['proxy-'] } }))
    expect(ok.some((m) => m.startsWith('warning:routing.balancers.0.strategy'))).toBe(false)
  })

  it('leastLoad без burstObservatory — предупреждение', () => {
    const found = messages(cfg([{ tag: 'bal', selector: ['proxy-'], strategy: { type: 'leastLoad' } }]))
    expect(found.some((m) => m.startsWith('warning:routing.balancers.0.strategy'))).toBe(true)
  })

  it('subjectSelector не покрывает кандидата — предупреждение', () => {
    const found = messages(
      cfg([{ tag: 'bal', selector: ['proxy-'], strategy: { type: 'leastPing' } }],
        { observatory: { subjectSelector: ['другое-'] } }),
    )
    expect(found.some((m) => m.includes('observatory.subjectSelector') && m.includes('proxy-de'))).toBe(true)
  })

  it('неизвестная стратегия — предупреждение', () => {
    const found = messages(cfg([{ tag: 'bal', selector: ['proxy-'], strategy: { type: 'wat' } }]))
    expect(found.some((m) => m.startsWith('warning:routing.balancers.0.strategy'))).toBe(true)
  })

  it('правило с обоими тегами — предупреждение про приоритет outboundTag', () => {
    const config = {
      outbounds: [{ tag: 'proxy-de', protocol: 'vless' }],
      routing: {
        rules: [{ outboundTag: 'proxy-de', balancerTag: 'bal' }],
        balancers: [{ tag: 'bal', selector: ['proxy-'] }],
      },
    }
    const found = messages(config)
    expect(found.some((m) => m.startsWith('warning:routing.rules.0.balancerTag'))).toBe(true)
  })
})
```

Если `analyzeIntegrity` в этом файле ещё не импортирован — добавить его в существующий импорт из
`../src/entities/xray/config`.

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `npx vitest run test/xray-config.test.ts`
Expected: FAIL — новых сообщений нет.

- [ ] **Step 3: Реализовать проверки**

В `config.ts` заменить блок `balancerTags` (`config.ts:99-103`) на использование типизированного
списка и добавить проверку правила внутри существующего `rules.forEach`:

```ts
const balancers = config.routing?.balancers ?? []
const balancerTags = new Set(balancers.map((b) => b.tag))
```

Внутри `rules.forEach`, рядом с проверкой висячего `balancerTag`:

```ts
    if (rule.balancerTag && rule.outboundTag) {
      issues.push(
        issue(
          ['routing', 'rules', i, 'balancerTag'],
          `У правила заданы и outboundTag «${rule.outboundTag}», и балансер «${rule.balancerTag}» — ядро возьмёт outboundTag, балансер не сработает`,
          'warning',
        ),
      )
    }
```

После цикла по правилам добавить цикл по балансерам:

```ts
  // Балансер выбирает outbound по ПРЕФИКСУ тега, а стратегии leastPing/leastLoad
  // работают только вместе с глобальной секцией обсерватории
  const seenBalancerTags = new Set<string>()
  balancers.forEach((bal, i) => {
    if (seenBalancerTags.has(bal.tag)) {
      issues.push(issue(['routing', 'balancers', i, 'tag'], `Дубликат тега балансера «${bal.tag}»`, 'error'))
    }
    seenBalancerTags.add(bal.tag)

    const candidates = balancerCandidates(config, bal)
    if (candidates.length === 0) {
      issues.push(
        issue(
          ['routing', 'balancers', i, 'selector'],
          'Селектор не совпал ни с одним outbound — балансеру не из чего выбирать',
          'error',
        ),
      )
    }
    if (bal.fallbackTag !== undefined && !outboundTags.has(bal.fallbackTag)) {
      issues.push(
        issue(
          ['routing', 'balancers', i, 'fallbackTag'],
          `Запасной выход «${bal.fallbackTag}» не найден среди outbound'ов`,
          'warning',
        ),
      )
    }

    const type = bal.strategy?.type
    if (type !== undefined && !(BALANCER_STRATEGIES as readonly string[]).includes(type)) {
      issues.push(
        issue(
          ['routing', 'balancers', i, 'strategy'],
          `Неизвестная стратегия «${type}»; ядро знает: ${BALANCER_STRATEGIES.join(', ')}`,
          'warning',
        ),
      )
    }
    if (type === 'leastPing' || type === 'leastLoad') {
      const kindKey = type === 'leastPing' ? 'observatory' : 'burstObservatory'
      const section = config[kindKey] as { subjectSelector?: string[] } | undefined
      if (section === undefined) {
        issues.push(
          issue(
            ['routing', 'balancers', i, 'strategy'],
            `Стратегия ${type} измеряет выходы через ${kindKey} — этой секции в конфиге нет`,
            'warning',
          ),
        )
      } else {
        const missed = candidates.filter((tag) => !subjectCovers(section.subjectSelector, tag))
        if (missed.length > 0) {
          issues.push(
            issue(
              [kindKey, 'subjectSelector'],
              `Обсерватория не покрывает ${missed.join(', ')} — ядро не будет их мерить`,
              'warning',
            ),
          )
        }
      }
    }
  })
```

Импорты в начале файла:

```ts
import { BALANCER_STRATEGIES, balancerCandidates } from './balancers'
import { subjectCovers } from './observatory'
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run test/xray-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/config.ts frontend/test/xray-config.test.ts
git commit -m "feat(frontend): validate balancers and observatory wiring"
```

---

### Task 3: Мутации графа для балансеров и обсерватории

**Files:**
- Modify: `frontend/src/entities/graph/mutations.ts`
- Test: `frontend/test/graph-balancers.test.ts` (создать)

**Interfaces:**
- Consumes: `balancerCandidates`, `expandSelector` (Task 1).
- Produces:
  - `addBalancer(config): XrayConfig`
  - `setRuleBalancer(config, ruleIndex: number, balancerTag: string): XrayConfig`
  - `attachOutboundToBalancer(config, balancerTag: string, outboundTag: string): XrayConfig`
  - `setRuleOutbound` — теперь снимает `balancerTag`
  - `getNodeJson` / `applyNodeJson` / `removeNode` понимают `bal:<tag>` и `obs`
  - `disconnectEdge` понимает `e:rule:<i>->bal:<tag>`, `e:bal:<tag>->out:<tag>`,
    `e:bal:<tag>->fb:<tag>`

**Договорённости по id рёбер** (их строит Task 4, но разбирает эта задача):

| id | смысл |
|---|---|
| `e:rule:<i>->bal:<tag>` | правило ведёт в балансер |
| `e:bal:<tag>->out:<tag>` | кандидат по selector |
| `e:bal:<tag>->fb:<tag>` | запасной выход (`fallbackTag`) |
| `e:obs->bal:<tag>` | зависимость стратегии от обсерватории |

У fallback-ребра **свой префикс `fb:`**, потому что тег может быть одновременно кандидатом и
запасным выходом — два ребра с одинаковым id сломали бы React Flow.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/graph-balancers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  addBalancer, applyNodeJson, attachOutboundToBalancer, disconnectEdge, getNodeJson, removeNode,
  setRuleBalancer, setRuleOutbound,
} from '../src/entities/graph/mutations'

const base = () => ({
  outbounds: [
    { tag: 'proxy-de', protocol: 'vless' },
    { tag: 'proxy-nl', protocol: 'vless' },
    { tag: 'direct', protocol: 'freedom' },
  ],
  routing: {
    rules: [{ inboundTag: ['in'], balancerTag: 'bal-eu' }],
    balancers: [{ tag: 'bal-eu', selector: ['proxy-'], strategy: { type: 'leastPing' } }],
  },
  observatory: { subjectSelector: ['proxy-'] },
})

describe('мутации балансеров', () => {
  it('addBalancer добавляет балансер с уникальным тегом', () => {
    const once = addBalancer(base())
    const twice = addBalancer(once)
    expect(twice.routing!.balancers!.map((b) => b.tag)).toEqual(['bal-eu', 'balancer', 'balancer-2'])
    expect(twice.routing!.balancers![1]).toEqual({ tag: 'balancer', selector: [], strategy: { type: 'roundRobin' } })
  })

  it('setRuleBalancer ставит balancerTag и снимает outboundTag', () => {
    const cfg = { ...base(), routing: { ...base().routing, rules: [{ outboundTag: 'direct' }] } }
    const next = setRuleBalancer(cfg, 0, 'bal-eu')
    expect(next.routing!.rules![0]).toEqual({ balancerTag: 'bal-eu' })
  })

  it('setRuleOutbound снимает balancerTag', () => {
    const next = setRuleOutbound(base(), 0, 'direct')
    expect(next.routing!.rules![0]).toEqual({ inboundTag: ['in'], outboundTag: 'direct' })
  })

  it('attachOutboundToBalancer дописывает точный тег, а покрытого префиксом не трогает', () => {
    const added = attachOutboundToBalancer(base(), 'bal-eu', 'direct')
    expect(added.routing!.balancers![0]!.selector).toEqual(['proxy-', 'direct'])
    const cfg = base()
    expect(attachOutboundToBalancer(cfg, 'bal-eu', 'proxy-de')).toBe(cfg) // уже кандидат
    expect(attachOutboundToBalancer(cfg, 'нет', 'direct')).toBe(cfg)
  })

  it('getNodeJson и applyNodeJson работают с балансером', () => {
    expect((getNodeJson(base(), 'bal:bal-eu') as { selector: string[] }).selector).toEqual(['proxy-'])
    const next = applyNodeJson(base(), 'bal:bal-eu', { tag: 'bal-new', selector: ['proxy-de'] })
    expect(next.routing!.balancers![0]!.tag).toBe('bal-new')
    // переименование тащится в правила
    expect(next.routing!.rules![0]!.balancerTag).toBe('bal-new')
  })

  it('узел obs отдаёт обе секции и пишет их обратно', () => {
    expect(getNodeJson(base(), 'obs')).toEqual({ observatory: { subjectSelector: ['proxy-'] } })
    const next = applyNodeJson(base(), 'obs', {
      burstObservatory: { subjectSelector: ['proxy-'], pingConfig: { interval: '1m' } },
    })
    expect(next.observatory).toBeUndefined()
    expect(next.burstObservatory).toEqual({ subjectSelector: ['proxy-'], pingConfig: { interval: '1m' } })
  })

  it('removeNode удаляет балансер и обе секции обсерватории', () => {
    expect(removeNode(base(), 'bal:bal-eu').routing!.balancers).toHaveLength(0)
    const cleared = removeNode({ ...base(), burstObservatory: { subjectSelector: ['x'] } }, 'obs')
    expect(cleared.observatory).toBeUndefined()
    expect(cleared.burstObservatory).toBeUndefined()
  })

  it('disconnectEdge: правило → балансер удаляет правило', () => {
    expect(disconnectEdge(base(), 'e:rule:0->bal:bal-eu').routing!.rules).toHaveLength(0)
  })

  it('disconnectEdge: точный тег уходит из selector', () => {
    const cfg = {
      ...base(),
      routing: { ...base().routing, balancers: [{ tag: 'bal-eu', selector: ['proxy-de', 'proxy-nl'] }] },
    }
    const next = disconnectEdge(cfg, 'e:bal:bal-eu->out:proxy-nl')
    expect(next.routing!.balancers![0]!.selector).toEqual(['proxy-de'])
  })

  it('disconnectEdge: префиксного кандидата не трогает (UI спросит про разворот)', () => {
    const cfg = base()
    expect(disconnectEdge(cfg, 'e:bal:bal-eu->out:proxy-nl')).toBe(cfg)
  })

  it('disconnectEdge: fallback-ребро снимает fallbackTag', () => {
    const cfg = {
      ...base(),
      routing: { ...base().routing, balancers: [{ tag: 'bal-eu', selector: ['proxy-'], fallbackTag: 'direct' }] },
    }
    const next = disconnectEdge(cfg, 'e:bal:bal-eu->fb:direct')
    expect(next.routing!.balancers![0]!.fallbackTag).toBeUndefined()
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run test/graph-balancers.test.ts`
Expected: FAIL — `addBalancer is not exported`.

- [ ] **Step 3: Реализовать мутации**

В `mutations.ts` добавить импорт и хелпер индекса:

```ts
import { balancerCandidates } from '../xray/balancers'

function balancerIndex(config: XrayConfig, tag: string): number {
  return (config.routing?.balancers ?? []).findIndex((b) => b.tag === tag)
}
```

`retagInPlace` получает третий вид (сигнатура меняется на
`kind: 'inbound' | 'outbound' | 'balancer'`), в начале функции:

```ts
  if (kind === 'balancer') {
    for (const rule of config.routing?.rules ?? []) {
      if (rule.balancerTag === oldTag) rule.balancerTag = newTag
    }
    return
  }
```

`getNodeJson` — две ветки перед `return undefined`:

```ts
  if (nodeId.startsWith('bal:')) {
    const i = balancerIndex(config, nodeId.slice(4))
    return i === -1 ? undefined : config.routing!.balancers![i]
  }
  // Узел obs представляет ДВЕ глобальные секции сразу — в JSON-вкладке
  // видно и правится ровно то, что уйдёт в конфиг
  if (nodeId === 'obs') {
    const value: Record<string, unknown> = {}
    if (config.observatory) value.observatory = config.observatory
    if (config.burstObservatory) value.burstObservatory = config.burstObservatory
    return value
  }
```

`applyNodeJson` — две ветки:

```ts
  if (nodeId.startsWith('bal:')) {
    const oldTag = nodeId.slice(4)
    const next = clone(config)
    const i = balancerIndex(next, oldTag)
    if (i !== -1) next.routing!.balancers![i] = value as NonNullable<NonNullable<XrayConfig['routing']>['balancers']>[number]
    const newTag = tagOf(value)
    if (i !== -1 && newTag !== undefined && newTag !== oldTag) {
      retagInPlace(next, 'balancer', oldTag, newTag)
    }
    return next
  }
  if (nodeId === 'obs') {
    const next = clone(config)
    const obj = (value ?? {}) as { observatory?: unknown; burstObservatory?: unknown }
    if (obj.observatory === undefined) delete next.observatory
    else next.observatory = obj.observatory as XrayConfig['observatory']
    if (obj.burstObservatory === undefined) delete next.burstObservatory
    else next.burstObservatory = obj.burstObservatory as XrayConfig['burstObservatory']
    return next
  }
```

Обе ветки ставятся **до** блока `if (nodeId.startsWith('rule:'))` — порядок веток не важен,
префиксы не пересекаются.

`removeNode`:

```ts
  if (nodeId.startsWith('bal:')) {
    const next = clone(config)
    const i = balancerIndex(next, nodeId.slice(4))
    if (i !== -1) next.routing!.balancers!.splice(i, 1)
    return next
  }
  if (nodeId === 'obs') {
    const next = clone(config)
    delete next.observatory
    delete next.burstObservatory
    return next
  }
```

Новые мутации (в конец блока с `addRule`/`connectRule`):

```ts
export function addBalancer(config: XrayConfig): XrayConfig {
  const next = clone(config)
  next.routing = next.routing ?? {}
  next.routing.balancers = next.routing.balancers ?? []
  const tag = uniqueTag(new Set(next.routing.balancers.map((b) => b.tag)), 'balancer')
  next.routing.balancers.push({ tag, selector: [], strategy: { type: 'roundRobin' } })
  return next
}

// Ребро правило → балансер. outboundTag снимаем: при обоих заданных тегах ядро
// берёт outboundTag, и балансер не сработал бы вовсе.
export function setRuleBalancer(config: XrayConfig, ruleIndex: number, balancerTag: string): XrayConfig {
  const rule = config.routing?.rules?.[ruleIndex]
  if (!rule) return config
  if (rule.balancerTag === balancerTag && rule.outboundTag === undefined) return config
  const next = clone(config)
  const target = next.routing!.rules![ruleIndex]!
  target.balancerTag = balancerTag
  delete target.outboundTag
  return next
}

// Ребро балансер → outbound: в selector уходит ТОЧНЫЙ тег. Уже покрытый префиксом
// кандидат не дублируется.
export function attachOutboundToBalancer(
  config: XrayConfig,
  balancerTag: string,
  outboundTag: string,
): XrayConfig {
  const i = balancerIndex(config, balancerTag)
  if (i === -1) return config
  const balancer = config.routing!.balancers![i]!
  if (balancerCandidates(config, balancer).includes(outboundTag)) return config
  const next = clone(config)
  const target = next.routing!.balancers![i]!
  target.selector = [...(target.selector ?? []), outboundTag]
  return next
}
```

`setRuleOutbound` — снимает `balancerTag`:

```ts
export function setRuleOutbound(config: XrayConfig, ruleIndex: number, outboundTag: string): XrayConfig {
  const rule = config.routing?.rules?.[ruleIndex]
  if (!rule) return config
  if (rule.outboundTag === outboundTag && rule.balancerTag === undefined) return config
  const next = clone(config)
  const target = next.routing!.rules![ruleIndex]!
  target.outboundTag = outboundTag
  delete target.balancerTag
  return next
}
```

`disconnectEdge` — три новых разбора перед `return config`:

```ts
const EDGE_RULE_BAL = /^e:rule:(\d+)->bal:(.+)$/
const EDGE_BAL_OUT = /^e:bal:(.+)->out:(.+)$/
const EDGE_BAL_FB = /^e:bal:(.+)->fb:(.+)$/
```

```ts
  // Правило без назначения бессмысленно — удаляем его целиком, как и для ребра rule→out
  const ruleBal = EDGE_RULE_BAL.exec(edgeId)
  if (ruleBal) {
    const next = clone(config)
    next.routing?.rules?.splice(Number(ruleBal[1]), 1)
    return next
  }
  const balFb = EDGE_BAL_FB.exec(edgeId)
  if (balFb) {
    const i = balancerIndex(config, balFb[1]!)
    if (i === -1) return config
    const next = clone(config)
    delete next.routing!.balancers![i]!.fallbackTag
    return next
  }
  const balOut = EDGE_BAL_OUT.exec(edgeId)
  if (balOut) {
    const i = balancerIndex(config, balOut[1]!)
    if (i === -1) return config
    const selector = config.routing!.balancers![i]!.selector ?? []
    // Кандидат пришёл из префикса: убрать одного, не переписав selector, нельзя —
    // возвращаем тот же конфиг, TopologyView спросит про разворот префикса
    if (!selector.includes(balOut[2]!)) return config
    const next = clone(config)
    const target = next.routing!.balancers![i]!
    target.selector = selector.filter((s) => s !== balOut[2])
    return next
  }
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run test/graph-balancers.test.ts test/graph-mutations.test.ts`
Expected: PASS оба файла.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/graph/mutations.ts frontend/test/graph-balancers.test.ts
git commit -m "feat(frontend): graph mutations for balancers and observatory"
```

---

### Task 4: Сборка графа — узлы, рёбра, колонки

**Files:**
- Modify: `frontend/src/entities/graph/types.ts`, `frontend/src/entities/graph/buildGraph.ts`
- Test: `frontend/test/graph-balancers.test.ts` (дополнить), `frontend/test/build-graph.test.ts`

**Interfaces:**
- Consumes: `balancerCandidates` (Task 1).
- Produces:
  - `COLUMN_X = { squad: -380, inbound: 0, rule: 430, balancer: 860, outbound: 1290 }`
  - `BalancerNodeData { kind:'balancer'; index; tag; strategy?; candidates: number; issueCount? }`
  - `ObservatoryNodeData { kind:'observatory'; hasObservatory: boolean; hasBurst: boolean;
    subjectsCount: number; issueCount? }`
  - Узлы `bal:<tag>`, `obs`; рёбра по таблице из Task 3.

- [ ] **Step 1: Написать падающий тест**

Добавить в `frontend/test/graph-balancers.test.ts`:

```ts
import { buildGraph, COLUMN_X, layoutColumns } from '../src/entities/graph/buildGraph'

const withRules = () => ({
  inbounds: [{ tag: 'in', protocol: 'vless' }],
  outbounds: [
    { tag: 'proxy-de', protocol: 'vless' },
    { tag: 'proxy-nl', protocol: 'vless' },
    { tag: 'direct', protocol: 'freedom' },
  ],
  routing: {
    rules: [{ inboundTag: ['in'], balancerTag: 'bal-eu' }, { outboundTag: 'direct' }],
    balancers: [
      { tag: 'bal-eu', selector: ['proxy-'], fallbackTag: 'direct', strategy: { type: 'leastPing' } },
    ],
  },
  observatory: { subjectSelector: ['proxy-'] },
})

describe('граф с балансерами', () => {
  it('строит узлы балансера и обсерватории', () => {
    const { nodes } = buildGraph(withRules())
    const bal = nodes.find((n) => n.id === 'bal:bal-eu')
    expect(bal?.data).toMatchObject({ kind: 'balancer', tag: 'bal-eu', strategy: 'leastPing', candidates: 2 })
    expect(nodes.find((n) => n.id === 'obs')?.data).toMatchObject({
      kind: 'observatory', hasObservatory: true, hasBurst: false, subjectsCount: 1,
    })
  })

  it('строит все четыре вида рёбер', () => {
    const ids = buildGraph(withRules()).edges.map((e) => e.id)
    expect(ids).toContain('e:rule:0->bal:bal-eu')
    expect(ids).toContain('e:bal:bal-eu->out:proxy-de')
    expect(ids).toContain('e:bal:bal-eu->out:proxy-nl')
    expect(ids).toContain('e:bal:bal-eu->fb:direct')
    expect(ids).toContain('e:obs->bal:bal-eu')
  })

  it('ребро obs → балансер не рисуется для стратегий без замеров', () => {
    const cfg = withRules()
    cfg.routing.balancers[0]!.strategy = { type: 'roundRobin' }
    expect(buildGraph(cfg).edges.map((e) => e.id)).not.toContain('e:obs->bal:bal-eu')
  })

  it('ребро obs → балансер не рисуется без нужной секции', () => {
    const cfg = withRules()
    cfg.routing.balancers[0]!.strategy = { type: 'leastLoad' } // нужна burstObservatory, её нет
    expect(buildGraph(cfg).edges.map((e) => e.id)).not.toContain('e:obs->bal:bal-eu')
  })

  it('дубликат тега балансера пропускается — id узлов уникальны', () => {
    const cfg = withRules()
    cfg.routing.balancers.push({ tag: 'bal-eu', selector: ['direct'] })
    const ids = buildGraph(cfg).nodes.filter((n) => n.id === 'bal:bal-eu')
    expect(ids).toHaveLength(1)
  })

  it('узла obs нет, когда обеих секций нет', () => {
    const cfg = withRules()
    delete (cfg as { observatory?: unknown }).observatory
    expect(buildGraph(cfg).nodes.find((n) => n.id === 'obs')).toBeUndefined()
  })

  it('раскладка ставит балансеры в свою колонку, obs — под ними', () => {
    const laid = layoutColumns(buildGraph(withRules()).nodes)
    expect(laid.find((n) => n.id === 'bal:bal-eu')!.position.x).toBe(COLUMN_X.balancer)
    expect(laid.find((n) => n.id === 'out:direct')!.position.x).toBe(COLUMN_X.outbound)
    const obs = laid.find((n) => n.id === 'obs')!
    expect(obs.position.x).toBe(COLUMN_X.balancer)
    expect(obs.position.y).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run test/graph-balancers.test.ts`
Expected: FAIL — узла `bal:bal-eu` нет.

- [ ] **Step 3: Добавить типы узлов**

В `entities/graph/types.ts`:

```ts
export interface BalancerNodeData extends Record<string, unknown> {
  kind: 'balancer'; index: number; tag: string
  /** Строка стратегии как в конфиге; undefined — Xray возьмёт random */
  strategy?: string
  /** Сколько outbound'ов попало под selector */
  candidates: number
  issueCount?: IssueCount
}
export interface ObservatoryNodeData extends Record<string, unknown> {
  kind: 'observatory'; hasObservatory: boolean; hasBurst: boolean; subjectsCount: number
  issueCount?: IssueCount
}
```

- [ ] **Step 4: Достроить `buildGraph`**

Колонки:

```ts
export const COLUMN_X = { squad: -380, inbound: 0, rule: 430, balancer: 860, outbound: 1290 } as const
```

После цикла по правилам (там, где сейчас рисуются рёбра `rule → out`) добавить:

```ts
  // Балансеры: дубликаты тегов пропускаем — одинаковые id узлов ломают React Flow
  const balancers = config.routing?.balancers ?? []
  const seenBalancerTags = new Set<string>()
  balancers.forEach((bal, index) => {
    if (seenBalancerTags.has(bal.tag)) return
    seenBalancerTags.add(bal.tag)
    const candidates = balancerCandidates(config, bal)
    nodes.push({
      id: `bal:${bal.tag}`,
      type: 'balancer',
      position: { x: 0, y: 0 },
      data: {
        kind: 'balancer',
        index,
        tag: bal.tag,
        strategy: bal.strategy?.type,
        candidates: candidates.length,
      },
    })
    for (const tag of candidates) {
      edges.push({ id: `e:bal:${bal.tag}->out:${tag}`, source: `bal:${bal.tag}`, target: `out:${tag}` })
    }
    // Запасной выход — не кандидат балансировки: отдельный id и свой стиль ребра
    if (bal.fallbackTag !== undefined && outboundTags.has(bal.fallbackTag)) {
      edges.push({
        id: `e:bal:${bal.tag}->fb:${bal.fallbackTag}`,
        source: `bal:${bal.tag}`,
        target: `out:${bal.fallbackTag}`,
      })
    }
  })

  const balancerTags = new Set(seenBalancerTags)
  rules.forEach((rule, index) => {
    if (rule.balancerTag && balancerTags.has(rule.balancerTag)) {
      edges.push({
        id: `e:rule:${index}->bal:${rule.balancerTag}`,
        source: `rule:${index}`,
        target: `bal:${rule.balancerTag}`,
      })
    }
  })

  // Обсерватория — глобальная секция, поэтому один узел на конфиг, как dns
  const observatory = config.observatory as { subjectSelector?: string[] } | undefined
  const burst = config.burstObservatory as { subjectSelector?: string[] } | undefined
  if (observatory || burst) {
    nodes.push({
      id: 'obs',
      type: 'observatory',
      position: { x: 0, y: 0 },
      data: {
        kind: 'observatory',
        hasObservatory: observatory !== undefined,
        hasBurst: burst !== undefined,
        subjectsCount: new Set([
          ...(observatory?.subjectSelector ?? []),
          ...(burst?.subjectSelector ?? []),
        ]).size,
      },
    })
    for (const bal of balancers) {
      const type = bal.strategy?.type
      const needed = type === 'leastPing' ? observatory : type === 'leastLoad' ? burst : undefined
      if (!needed || !seenBalancerTags.has(bal.tag)) continue
      // Зависимость, а не поток трафика: ребро нельзя разорвать кабелем
      edges.push({
        id: `e:obs->bal:${bal.tag}`,
        source: 'obs',
        target: `bal:${bal.tag}`,
        deletable: false,
      })
    }
  }
```

Импорт наверху файла: `import { balancerCandidates } from '../xray/balancers'`.

`layoutColumns` — счётчик балансеров и позиция `obs` под колонкой балансеров:

```ts
export function layoutColumns(nodes: FlowNode[]): FlowNode[] {
  const counters = { squad: 0, inbound: 0, rule: 0, balancer: 0, outbound: 0 }
  let inboundTotal = 0
  let balancerTotal = 0
  for (const n of nodes) {
    if (n.data.kind === 'inbound') inboundTotal += 1
    if (n.data.kind === 'balancer') balancerTotal += 1
  }

  return nodes.map((n) => {
    const kind = n.data.kind as keyof typeof counters | 'dns' | 'observatory'
    if (kind === 'dns') {
      return { ...n, position: { x: COLUMN_X.inbound, y: (inboundTotal + 1) * ROW_H } }
    }
    if (kind === 'observatory') {
      return { ...n, position: { x: COLUMN_X.balancer, y: (balancerTotal + 1) * ROW_H } }
    }
    const y = counters[kind] * ROW_H
    counters[kind] += 1
    return { ...n, position: { x: COLUMN_X[kind], y } }
  })
}
```

- [ ] **Step 5: Запустить тесты**

Run: `npx vitest run test/graph-balancers.test.ts test/build-graph.test.ts && npm run typecheck -w frontend`
Expected: PASS. `build-graph.test.ts` мог проверять точные x-координаты outbound'ов — обновите
ожидания на новое значение `COLUMN_X.outbound`.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/graph/types.ts frontend/src/entities/graph/buildGraph.ts \
        frontend/test/graph-balancers.test.ts frontend/test/build-graph.test.ts
git commit -m "feat(frontend): balancer and observatory nodes in the graph"
```

---

### Task 5: Резолверы — клик по проблеме и поиск

**Files:**
- Modify: `frontend/src/entities/graph/locate.ts`, `frontend/src/entities/graph/search.ts`
- Test: `frontend/test/graph-locate.test.ts`, `frontend/test/graph-search.test.ts`

**Interfaces:**
- Consumes: пути диагностик из Task 2, id узлов из Task 4.
- Produces: `nodeIdForPath` понимает `routing.balancers.<i>`, `observatory`, `burstObservatory`;
  `searchNodes` возвращает хиты `kind: 'balancer' | 'observatory'`.

- [ ] **Step 1: Написать падающие тесты**

В `frontend/test/graph-locate.test.ts`:

```ts
it('путь балансера и обсерватории ведёт к своим узлам', () => {
  const config = {
    outbounds: [{ tag: 'proxy-de', protocol: 'vless' }],
    routing: { rules: [], balancers: [{ tag: 'bal-eu', selector: ['proxy-'] }] },
    observatory: { subjectSelector: ['proxy-'] },
  }
  expect(nodeIdForPath(['routing', 'balancers', 0, 'selector'], config)).toBe('bal:bal-eu')
  expect(nodeIdForPath(['observatory', 'subjectSelector'], config)).toBe('obs')
  expect(nodeIdForPath(['burstObservatory', 'subjectSelector'], config)).toBe('obs')
  expect(nodeIdForPath(['routing', 'balancers', 5, 'selector'], config)).toBeNull()
})
```

В `frontend/test/graph-search.test.ts`:

```ts
it('находит балансер по тегу и по стратегии', () => {
  const config = {
    outbounds: [{ tag: 'proxy-de', protocol: 'vless' }],
    routing: { rules: [], balancers: [{ tag: 'bal-eu', selector: ['proxy-'], strategy: { type: 'leastPing' } }] },
  }
  expect(searchNodes(config, {}, 'bal-eu')[0]).toMatchObject({ nodeId: 'bal:bal-eu', kind: 'balancer' })
  expect(searchNodes(config, {}, 'leastping')[0]).toMatchObject({ nodeId: 'bal:bal-eu' })
})
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `npx vitest run test/graph-locate.test.ts test/graph-search.test.ts`
Expected: FAIL — `null` вместо id, пустой список хитов.

- [ ] **Step 3: Реализовать**

В `locate.ts`, перед финальным `return null`:

```ts
  if (head === 'observatory' || head === 'burstObservatory') {
    return config.observatory || config.burstObservatory ? 'obs' : null
  }

  if (head === 'routing' && second === 'balancers' && typeof third === 'number') {
    const tag = config.routing?.balancers?.[third]?.tag
    return tag ? `bal:${tag}` : null
  }
```

В `search.ts` расширить тип и добавить цикл после правил:

```ts
  kind: 'inbound' | 'outbound' | 'rule' | 'squad' | 'dns' | 'balancer'
```

```ts
  for (const bal of config.routing?.balancers ?? []) {
    const matched = firstMatch(needle, [
      { label: 'тег', value: bal.tag },
      { label: 'стратегия', value: bal.strategy?.type },
      { label: 'селектор', value: bal.selector },
    ])
    if (matched) {
      push({ nodeId: `bal:${bal.tag}`, kind: 'balancer', title: bal.tag, matchedOn: matched })
    }
  }
```

В `features/topology/SearchBox.tsx` добавить подпись вида: `balancer: 'балансер'`.

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run test/graph-locate.test.ts test/graph-search.test.ts test/search-box.test.tsx`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/graph/locate.ts frontend/src/entities/graph/search.ts \
        frontend/src/features/topology/SearchBox.tsx \
        frontend/test/graph-locate.test.ts frontend/test/graph-search.test.ts
git commit -m "feat(frontend): locate and search balancer nodes"
```

---

### Task 6: Отрисовка узлов и кабелей

**Files:**
- Modify: `frontend/src/features/topology/nodes.tsx`, `frontend/src/features/topology/edges.tsx`,
  `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/topology-nodes.test.tsx`

**Interfaces:**
- Consumes: `BalancerNodeData`, `ObservatoryNodeData` (Task 4).
- Produces: `nodeTypes.balancer`, `nodeTypes.observatory`; `edgeHues` знает про `bal`/`obs`;
  `isDashedEdge(id: string): boolean` (экспортируется из `edges.tsx` для теста).

- [ ] **Step 1: Написать падающие тесты**

В `frontend/test/topology-nodes.test.tsx`:

```ts
import { edgeHues, isDashedEdge } from '../src/features/topology/edges'

it('кабель правило → балансер стальной, балансер → выход уходит в янтарь', () => {
  expect(edgeHues('e:rule:0->bal:bal-eu')).toEqual(['var(--cable-steel)', 'var(--cable-steel)'])
  expect(edgeHues('e:bal:bal-eu->out:proxy-de')).toEqual(['var(--cable-steel)', 'var(--ember)'])
})

it('fallback и зависимость обсерватории рисуются пунктиром', () => {
  expect(isDashedEdge('e:bal:bal-eu->fb:direct')).toBe(true)
  expect(isDashedEdge('e:obs->bal:bal-eu')).toBe(true)
  expect(isDashedEdge('e:bal:bal-eu->out:proxy-de')).toBe(false)
})
```

Плюс рендер-тесты узлов — там же, через уже принятые в файле `nodeTypes` + `wrap()`:

```tsx
import type { BalancerNodeData, ObservatoryNodeData } from '../src/entities/graph/types'

const BalancerNode = nodeTypes.balancer as unknown as ComponentType<{ data: BalancerNodeData; selected?: boolean }>
const ObservatoryNode = nodeTypes.observatory as unknown as ComponentType<{ data: ObservatoryNodeData; selected?: boolean }>

it('узел балансера показывает стратегию и число кандидатов', () => {
  wrap(
    <BalancerNode
      data={{ kind: 'balancer' as const, index: 0, tag: 'bal-eu', strategy: 'leastPing', candidates: 2 }}
      selected={false}
    />,
  )
  expect(screen.getByText('bal-eu')).toBeInTheDocument()
  expect(screen.getByText('leastPing')).toBeInTheDocument()
  expect(screen.getByText('кандидатов: 2')).toBeInTheDocument()
})

it('узел обсерватории показывает включённые секции', () => {
  wrap(
    <ObservatoryNode
      data={{ kind: 'observatory' as const, hasObservatory: true, hasBurst: false, subjectsCount: 1 }}
      selected={false}
    />,
  )
  expect(screen.getByText('observatory')).toBeInTheDocument()
  expect(screen.getByText('целей: 1')).toBeInTheDocument()
})

it('балансер без стратегии показывает подразумеваемый random', () => {
  wrap(<BalancerNode data={{ kind: 'balancer' as const, index: 0, tag: 'b', candidates: 0 }} selected={false} />)
  expect(screen.getByText('random')).toBeInTheDocument()
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run test/topology-nodes.test.tsx`
Expected: FAIL — `isDashedEdge` не экспортируется.

- [ ] **Step 3: Дополнить `edges.tsx`**

```ts
/** Пунктиром рисуем то, что не является потоком трафика: запасной выход и зависимость от обсерватории */
export function isDashedEdge(id: string): boolean {
  return id.includes('->fb:') || id.startsWith('e:obs')
}

export function edgeHues(id: string): [string, string] {
  if (id.startsWith('e:squad:')) return [FLUX, FLUX]
  if (id.startsWith('e:obs')) return [STEEL, STEEL]
  // Балансер — такой же переключатель, как правило: сталь на входе, янтарь на выходе
  if (id.startsWith('e:bal:')) return [STEEL, EMBER]
  if (id.includes('->bal:')) return [STEEL, STEEL]
  if (id.startsWith('e:rule:')) return [STEEL, EMBER]
  if (id.startsWith('e:in:')) return [FLUX, id.includes('->out:') ? EMBER : STEEL]
  return [STEEL, STEEL]
}
```

В `SignalEdge` — пунктир на обеих линиях:

```ts
  const dashed = isDashedEdge(id)
  // ...
      <BaseEdge id={id} path={path}
        style={{ stroke: `url(#${gid})`, opacity: active ? 1 : 0.85, strokeDasharray: dashed ? '7 6' : undefined }} />
```

и на `.edge-halo` — `style={{ stroke: `url(#${gid})`, strokeDasharray: dashed ? '7 6' : undefined }}`.

- [ ] **Step 4: Добавить узлы в `nodes.tsx`**

```ts
function BalancerNode({ data, selected }: { data: BalancerNodeData; selected?: boolean }) {
  return (
    <div className={frame('balancer', selected)} style={enter('balancer')}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-head">
        <span className="fnode-kind">балансер</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.tag}</div>
      <div className="metrics">
        <Metric accent>{data.strategy ?? 'random'}</Metric>
        <Metric>{`кандидатов: ${data.candidates}`}</Metric>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function ObservatoryNode({ data, selected }: { data: ObservatoryNodeData; selected?: boolean }) {
  return (
    <div className={frame('observatory', selected)} style={enter('observatory')}>
      <div className="fnode-head">
        <span className="fnode-kind">проверка живости</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">Обсерватория</div>
      <div className="metrics">
        {data.hasObservatory && <Metric>observatory</Metric>}
        {data.hasBurst && <Metric>burst</Metric>}
        <Metric>{`целей: ${data.subjectsCount}`}</Metric>
      </div>
      {/* Связь с балансером выводится из стратегии, кабелем её не задают */}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}
```

Регистрация и вспомогательные карты:

```ts
const ENTER_DELAY: Record<string, number> = {
  squad: 0, inbound: 70, dns: 70, rule: 140, balancer: 210, observatory: 210, outbound: 280,
}

export const nodeTypes = {
  inbound: InboundNode, outbound: OutboundNode, rule: RuleNode, dns: DnsNode, squad: SquadNode,
  balancer: BalancerNode, observatory: ObservatoryNode,
} as unknown as Record<string, React.ComponentType<NodeProps>>
```

В `frame()` добавить `kind === 'balancer' ? 'fnode-bal' : ''`.

- [ ] **Step 5: Стили в `tokens.css`**

Рядом с `.fnode-squad` (около `tokens.css:1008`):

```css
/* Балансер — переключатель без своего hue, как правило: сталь */
.fnode-bal { --node-hue: var(--cable-steel); --node-select: var(--ember); }
```

- [ ] **Step 6: Запустить тесты**

Run: `npx vitest run test/topology-nodes.test.tsx && npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/features/topology/nodes.tsx frontend/src/features/topology/edges.tsx \
        frontend/src/shared/ui/tokens.css frontend/test/topology-nodes.test.tsx
git commit -m "feat(frontend): render balancer and observatory nodes"
```

---

### Task 7: Коммутация в TopologyView и разворот префикса

**Files:**
- Modify: `frontend/src/features/topology/TopologyView.tsx`
- Test: `frontend/test/topology-balancers.test.ts` (создать)

**Interfaces:**
- Consumes: `setRuleBalancer`, `attachOutboundToBalancer`, `disconnectEdge` (Task 3),
  `expandSelector` (Task 1), `addBalancer` (Task 3).
- Produces: обновлённые `isValidConnection` / `applyConnection`; кнопка «+ Балансер» в доке;
  подтверждение разворота префикса.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/topology-balancers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyConnection, isValidConnection } from '../src/features/topology/TopologyView'

const cfg = () => ({
  outbounds: [{ tag: 'proxy-de', protocol: 'vless' }, { tag: 'direct', protocol: 'freedom' }],
  routing: {
    rules: [{ outboundTag: 'direct' }],
    balancers: [{ tag: 'bal-eu', selector: [] }],
  },
})

describe('коммутация балансеров', () => {
  it('правило можно подключить к балансеру, балансер — к выходу', () => {
    expect(isValidConnection({ source: 'rule:0', target: 'bal:bal-eu' })).toBe(true)
    expect(isValidConnection({ source: 'bal:bal-eu', target: 'out:proxy-de' })).toBe(true)
  })

  it('запрещённые пары остаются запрещёнными', () => {
    expect(isValidConnection({ source: 'in:in', target: 'bal:bal-eu' })).toBe(false)
    expect(isValidConnection({ source: 'bal:bal-eu', target: 'rule:0' })).toBe(false)
    expect(isValidConnection({ source: 'obs', target: 'bal:bal-eu' })).toBe(false)
  })

  it('кабель правило → балансер снимает outboundTag', () => {
    const next = applyConnection(cfg(), { source: 'rule:0', target: 'bal:bal-eu' })
    expect(next.routing!.rules![0]).toEqual({ balancerTag: 'bal-eu' })
  })

  it('кабель балансер → выход дописывает точный тег в selector', () => {
    const next = applyConnection(cfg(), { source: 'bal:bal-eu', target: 'out:proxy-de' })
    expect(next.routing!.balancers![0]!.selector).toEqual(['proxy-de'])
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run test/topology-balancers.test.ts`
Expected: FAIL — `isValidConnection` возвращает `false` для новых пар.

- [ ] **Step 3: Обновить коммутацию**

```ts
/**
 * Что можно коммутировать: inbound уходит в правило или напрямую в outbound
 * (тогда правило создаётся само), правило — в балансер либо в outbound, балансер —
 * в outbound. Гнёзда сквадов и обсерватории закрыты: привязку сквадов задаёт панель,
 * а связь обсерватории с балансером выводится из стратегии.
 */
export function isValidConnection(conn: { source?: string | null; target?: string | null }): boolean {
  const source = conn.source ?? ''
  const target = conn.target ?? ''
  if (source === target) return false
  if (source.startsWith('in:')) return target.startsWith('rule:') || target.startsWith('out:')
  if (source.startsWith('rule:')) return target.startsWith('out:') || target.startsWith('bal:')
  if (source.startsWith('bal:')) return target.startsWith('out:')
  return false
}
```

В `applyConnection` — две новые ветки перед `return config`:

```ts
  if (source.startsWith('rule:') && target.startsWith('bal:')) {
    return setRuleBalancer(config, Number(source.slice(5)), target.slice(4))
  }
  if (source.startsWith('bal:') && target.startsWith('out:')) {
    return attachOutboundToBalancer(config, source.slice(4), target.slice(4))
  }
```

Импорт пополняется: `addBalancer, attachOutboundToBalancer, setRuleBalancer`, а из
`entities/xray` — `expandSelector`.

- [ ] **Step 4: Кнопка в доке и колонка**

В массив `COLUMNS` добавить `{ kind: 'balancer', title: 'балансеры', x: COLUMN_X.balancer }`
между правилами и outbound'ами. В доке, после «+ Правило»:

```tsx
          <Button onClick={() => onChangeConfig(addBalancer(config))}>+ Балансер</Button>
```

- [ ] **Step 5: Подтверждение разворота префикса**

Состояние и обработка в компоненте:

```tsx
  // Разрыв ребра балансер → выход, кандидат которого пришёл из префикса: убрать одного,
  // не переписав selector, нельзя — спрашиваем разрешение развернуть префикс
  const [expand, setExpand] = useState<{ balancerTag: string; outboundTag: string } | null>(null)
```

Внутри `onEdgesDelete`, в цикле по `sorted`:

```ts
      const BAL_OUT = /^e:bal:(.+)->out:(.+)$/
      let pending: { balancerTag: string; outboundTag: string } | null = null
      let next = config
      for (const edge of sorted) {
        const before = next
        next = disconnectEdge(next, edge.id)
        const m = BAL_OUT.exec(edge.id)
        if (next === before && m) pending = { balancerTag: m[1]!, outboundTag: m[2]! }
      }
      if (next !== config) onChangeConfig(next)
      if (pending) setExpand(pending)
```

Диалог (внутри `<ReactFlow>`, рядом с `<Panel>`; `Dialog` уже импортируется из `shared/ui`
— добавьте его в существующий импорт):

```tsx
      <Dialog open={expand !== null} title="Убрать выход из балансера" onClose={() => setExpand(null)}>
        <p>
          Кандидат «{expand?.outboundTag}» попал в балансер «{expand?.balancerTag}» по префиксу.
          Чтобы убрать только его, селектор придётся переписать точными тегами остальных кандидатов.
        </p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setExpand(null)}>Отмена</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (expand) onChangeConfig(expandSelector(config, expand.balancerTag, expand.outboundTag))
              setExpand(null)
            }}
          >
            Развернуть префикс
          </Button>
        </div>
      </Dialog>
```

- [ ] **Step 6: Запустить тесты**

Run: `npx vitest run test/topology-balancers.test.ts test/topology-resync.test.ts test/topology-trace.test.ts && npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/features/topology/TopologyView.tsx frontend/test/topology-balancers.test.ts
git commit -m "feat(frontend): wire balancers on the canvas"
```

---

### Task 8: Формы балансера и обсерватории

**Files:**
- Create: `frontend/src/features/inspector/BalancerForm.tsx`,
  `frontend/src/features/inspector/ObservatoryForm.tsx`
- Modify: `frontend/src/features/topology/NodeInspector.tsx`,
  `frontend/src/features/editor/EditorPage.tsx`
- Test: `frontend/test/balancer-form.test.tsx` (создать)

**Interfaces:**
- Consumes: `matchPrefixes`, `subjectCovers`, `BALANCER_STRATEGIES`, `ensureObservatorySection`
  (Task 1); поля из `features/inspector/fields.tsx` (`TextField`, `SelectField`,
  `StringListField`, `NumberField`, `CheckboxField`).
- Produces:
  - `BalancerForm({ value, onChange, outboundTags, observatory, onSetupObservatory })`
  - `ObservatoryForm({ value, onChange, outboundTags })` — `value` это `{ observatory?,
    burstObservatory? }`, тот же объект, что отдаёт `getNodeJson(config, 'obs')`
  - `NodeInspector` получает необязательный проп
    `onSetupObservatory?: (kind: 'observatory' | 'burst', subjects: string[]) => void`

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/balancer-form.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BalancerForm } from '../src/features/inspector/BalancerForm'
import { ObservatoryForm } from '../src/features/inspector/ObservatoryForm'
import { selectOption } from './helpers'

const tags = ['proxy-de', 'proxy-nl', 'direct']

describe('BalancerForm', () => {
  it('показывает кандидатов, совпавших с префиксом', () => {
    render(
      <BalancerForm value={{ tag: 'bal-eu', selector: ['proxy-'] }} onChange={() => {}} outboundTags={tags} />,
    )
    expect(screen.getByText(/proxy-de, proxy-nl/)).toBeInTheDocument()
  })

  it('пустой селектор подсвечен ошибкой', () => {
    render(<BalancerForm value={{ tag: 'bal-eu', selector: [] }} onChange={() => {}} outboundTags={tags} />)
    expect(screen.getByText(/не совпал ни с одним outbound/i)).toBeInTheDocument()
  })

  it('смена стратегии уходит наверх', async () => {
    const onChange = vi.fn()
    render(
      <BalancerForm value={{ tag: 'bal-eu', selector: ['proxy-'] }} onChange={onChange} outboundTags={tags} />,
    )
    await selectOption('Стратегия', 'leastPing')
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: expect.objectContaining({ type: 'leastPing' }) }),
    )
  })

  it('для leastPing без обсерватории предлагает её настроить', async () => {
    const onSetup = vi.fn()
    render(
      <BalancerForm
        value={{ tag: 'bal-eu', selector: ['proxy-'], strategy: { type: 'leastPing' } }}
        onChange={() => {}}
        outboundTags={tags}
        observatory={{ present: false, missing: [] }}
        onSetupObservatory={onSetup}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Настроить проверку живости' }))
    expect(onSetup).toHaveBeenCalledWith('observatory', ['proxy-de', 'proxy-nl'])
  })

  it('сообщает о непокрытых кандидатах', () => {
    render(
      <BalancerForm
        value={{ tag: 'bal-eu', selector: ['proxy-'], strategy: { type: 'leastPing' } }}
        onChange={() => {}}
        outboundTags={tags}
        observatory={{ present: true, missing: ['proxy-nl'] }}
      />,
    )
    expect(screen.getByText(/не покрывает proxy-nl/)).toBeInTheDocument()
  })
})

describe('ObservatoryForm', () => {
  it('включение burst создаёт секцию с пустым pingConfig', async () => {
    const onChange = vi.fn()
    render(<ObservatoryForm value={{}} onChange={onChange} outboundTags={tags} />)
    await userEvent.click(screen.getByLabelText('Замеры под нагрузкой (burstObservatory)'))
    expect(onChange).toHaveBeenCalledWith({ burstObservatory: { subjectSelector: [] } })
  })

  it('выключение секции убирает её из значения', async () => {
    const onChange = vi.fn()
    render(
      <ObservatoryForm
        value={{ observatory: { subjectSelector: ['proxy-'] } }}
        onChange={onChange}
        outboundTags={tags}
      />,
    )
    await userEvent.click(screen.getByLabelText('Фоновые пробы (observatory)'))
    expect(onChange).toHaveBeenCalledWith({})
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run test/balancer-form.test.tsx`
Expected: FAIL — модулей нет.

- [ ] **Step 3: Написать `BalancerForm.tsx`**

```tsx
import { BALANCER_STRATEGIES, matchPrefixes } from '../../entities/xray'
import { Button } from '../../shared/ui'
import { SelectField, StringListField, TextField, type Option } from './fields'

type Obj = Record<string, unknown>

const STRATEGIES: Option[] = [
  { value: 'random', label: 'random — случайный выход' },
  { value: 'roundRobin', label: 'roundRobin — по кругу' },
  { value: 'leastPing', label: 'leastPing — самый быстрый (нужна observatory)' },
  { value: 'leastLoad', label: 'leastLoad — наименее загруженный (нужна burstObservatory)' },
]

export interface ObservatoryState {
  /** Есть ли нужная стратегии секция */
  present: boolean
  /** Кандидаты, которых не покрывает subjectSelector */
  missing: string[]
}

interface Props {
  value: Obj // объект балансера целиком (getNodeJson(config, 'bal:<tag>'))
  onChange: (next: Obj) => void
  outboundTags: string[]
  observatory?: ObservatoryState
  onSetupObservatory?: (kind: 'observatory' | 'burst', subjects: string[]) => void
}

export function BalancerForm({ value, onChange, outboundTags, observatory, onSetupObservatory }: Props) {
  const selector = value.selector as string[] | undefined
  const candidates = matchPrefixes(outboundTags, selector)
  const strategy = (value.strategy as { type?: string } | undefined)?.type ?? 'random'
  const needsObservatory = strategy === 'leastPing' || strategy === 'leastLoad'
  const kind = strategy === 'leastLoad' ? 'burst' : 'observatory'

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  const fallbackOptions: Option[] = [
    { value: '', label: 'без запасного выхода' },
    ...outboundTags.map((t) => ({ value: t, label: t })),
  ]

  return (
    <>
      <TextField
        label="Тег балансера"
        mono
        hint="На него ссылается balancerTag правила"
        value={value.tag as string | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.tag; else n.tag = v })}
      />
      <StringListField
        label="Селектор (selector)"
        hint="ПРЕФИКСЫ тегов outbound’ов: «proxy-» захватит proxy-de и proxy-nl"
        placeholder={'proxy-\nvless-'}
        value={selector}
        onChange={(v) => patch((n) => { n.selector = v ?? [] })}
      />
      {candidates.length > 0 ? (
        <p className="field-hint">Кандидаты: {candidates.join(', ')}</p>
      ) : (
        <p className="field-error">Селектор не совпал ни с одним outbound — балансеру не из чего выбирать</p>
      )}
      <SelectField
        label="Стратегия"
        value={(BALANCER_STRATEGIES as readonly string[]).includes(strategy) ? strategy : 'random'}
        options={STRATEGIES}
        onChange={(v) =>
          patch((n) => {
            const prev = (n.strategy as Obj | undefined) ?? {}
            n.strategy = { ...prev, type: v }
          })
        }
      />
      <SelectField
        label="Запасной выход (fallbackTag)"
        hint="Куда уйдёт трафик, когда все кандидаты недоступны"
        value={(value.fallbackTag as string | undefined) ?? ''}
        options={fallbackOptions}
        onChange={(v) => patch((n) => { if (v === '') delete n.fallbackTag; else n.fallbackTag = v })}
      />

      {needsObservatory && (
        <div className="field">
          <span className="field-label">Проверка живости</span>
          {observatory?.present !== true ? (
            <>
              <span className="field-warning">
                Стратегия {strategy} измеряет выходы, а секции {kind === 'burst' ? 'burstObservatory' : 'observatory'} в конфиге нет
              </span>
              {onSetupObservatory && (
                <Button onClick={() => onSetupObservatory(kind, candidates)}>Настроить проверку живости</Button>
              )}
            </>
          ) : observatory.missing.length > 0 ? (
            <>
              <span className="field-warning">
                Обсерватория не покрывает {observatory.missing.join(', ')} — ядро не будет их мерить
              </span>
              {onSetupObservatory && (
                <Button onClick={() => onSetupObservatory(kind, candidates)}>Добавить в проверку</Button>
              )}
            </>
          ) : (
            <span className="field-hint">Настроена, все кандидаты под наблюдением</span>
          )}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 4: Написать `ObservatoryForm.tsx`**

```tsx
import { CheckboxField, NumberField, StringListField, TextField } from './fields'

type Obj = Record<string, unknown>

interface Props {
  /** { observatory?, burstObservatory? } — то, что отдаёт getNodeJson(config, 'obs') */
  value: Obj
  onChange: (next: Obj) => void
  outboundTags: string[]
}

export function ObservatoryForm({ value, onChange }: Props) {
  const obs = value.observatory as Obj | undefined
  const burst = value.burstObservatory as Obj | undefined
  const ping = (burst?.pingConfig as Obj | undefined) ?? {}

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }
  const setObs = (mut: (s: Obj) => void) =>
    patch((n) => { const s = { ...((n.observatory as Obj) ?? {}) }; mut(s); n.observatory = s })
  const setBurst = (mut: (s: Obj) => void) =>
    patch((n) => { const s = { ...((n.burstObservatory as Obj) ?? {}) }; mut(s); n.burstObservatory = s })

  return (
    <>
      <CheckboxField
        label="Фоновые пробы (observatory)"
        hint="Нужна стратегии leastPing: периодический запрос probeUrl через каждый выход"
        value={obs !== undefined}
        onChange={(v) =>
          patch((n) => { if (v) n.observatory = { subjectSelector: [] }; else delete n.observatory })
        }
      />
      {obs !== undefined && (
        <>
          <StringListField
            label="Наблюдаемые выходы (subjectSelector)"
            hint="ПРЕФИКСЫ тегов outbound’ов — как selector балансера"
            placeholder="proxy-"
            value={obs.subjectSelector as string[] | undefined}
            onChange={(v) => setObs((s) => { s.subjectSelector = v ?? [] })}
          />
          <TextField
            label="URL пробы (probeUrl)"
            mono
            placeholder="https://www.google.com/generate_204"
            value={obs.probeUrl as string | undefined}
            onChange={(v) => setObs((s) => { if (v === undefined) delete s.probeUrl; else s.probeUrl = v })}
          />
          <TextField
            label="Интервал (probeInterval)"
            mono
            placeholder="10s"
            hint="Число с единицей: 10s, 1m"
            value={obs.probeInterval as string | undefined}
            onChange={(v) => setObs((s) => { if (v === undefined) delete s.probeInterval; else s.probeInterval = v })}
          />
          <CheckboxField
            label="Мерить параллельно (enableConcurrency)"
            value={obs.enableConcurrency as boolean | undefined}
            onChange={(v) => setObs((s) => { if (v === undefined) delete s.enableConcurrency; else s.enableConcurrency = v })}
          />
        </>
      )}

      <CheckboxField
        label="Замеры под нагрузкой (burstObservatory)"
        hint="Нужна стратегии leastLoad: серия проб с усреднением"
        value={burst !== undefined}
        onChange={(v) =>
          patch((n) => { if (v) n.burstObservatory = { subjectSelector: [] }; else delete n.burstObservatory })
        }
      />
      {burst !== undefined && (
        <>
          <StringListField
            label="Наблюдаемые выходы (subjectSelector)"
            hint="ПРЕФИКСЫ тегов outbound’ов"
            placeholder="proxy-"
            value={burst.subjectSelector as string[] | undefined}
            onChange={(v) => setBurst((s) => { s.subjectSelector = v ?? [] })}
          />
          <TextField
            label="Адрес проверки (destination)"
            mono
            placeholder="https://connectivitycheck.gstatic.com/generate_204"
            hint="Должен отвечать HTTP 204"
            value={ping.destination as string | undefined}
            onChange={(v) => setBurst((s) => {
              const p = { ...((s.pingConfig as Obj) ?? {}) }
              if (v === undefined) delete p.destination; else p.destination = v
              s.pingConfig = p
            })}
          />
          <TextField
            label="Интервал (interval)"
            mono
            placeholder="1m"
            hint="Минимум 10s"
            value={ping.interval as string | undefined}
            onChange={(v) => setBurst((s) => {
              const p = { ...((s.pingConfig as Obj) ?? {}) }
              if (v === undefined) delete p.interval; else p.interval = v
              s.pingConfig = p
            })}
          />
          <NumberField
            label="Хранить замеров (sampling)"
            placeholder="10"
            value={ping.sampling as number | undefined}
            onChange={(v) => setBurst((s) => {
              const p = { ...((s.pingConfig as Obj) ?? {}) }
              if (v === undefined) delete p.sampling; else p.sampling = v
              s.pingConfig = p
            })}
          />
          <TextField
            label="Таймаут (timeout)"
            mono
            placeholder="5s"
            value={ping.timeout as string | undefined}
            onChange={(v) => setBurst((s) => {
              const p = { ...((s.pingConfig as Obj) ?? {}) }
              if (v === undefined) delete p.timeout; else p.timeout = v
              s.pingConfig = p
            })}
          />
        </>
      )}
    </>
  )
}
```

- [ ] **Step 5: Подключить формы в `NodeInspector`**

Определение вида узла (`NodeInspector.tsx:56-64`) пополняется:

```ts
  const kind = nodeId.startsWith('in:')
    ? 'inbound'
    : nodeId.startsWith('out:')
      ? 'outbound'
      : nodeId.startsWith('rule:')
        ? 'rule'
        : nodeId.startsWith('bal:')
          ? 'balancer'
          : nodeId === 'dns'
            ? 'dns'
            : nodeId === 'obs'
              ? 'observatory'
              : 'other'
```

`KIND_LABEL` — `balancer: 'балансер'`, `observatory: 'проверка живости'`.

Подсказки JSON: `xrayIntellisense` умеет корни `config | inbound | outbound | rule | dns`.
Узел балансера получает свой корень в Task 11, узел `obs` — это фрагмент корня конфига,
поэтому здесь:

```ts
  const rootKind: XrayRootKind | null =
    kind === 'inbound' || kind === 'outbound' || kind === 'rule' || kind === 'dns'
      ? kind
      : kind === 'observatory'
        ? 'config'
        : null
  const extensions = useMemo(
    () => [json(), ...(rootKind ? [xrayIntellisense(rootKind)] : []), inspectorTheme],
    [rootKind],
  )
```

Рендер форм — две новые ветки рядом с `DnsForm`:

```tsx
            {parsedNode !== null && kind === 'balancer' && (
              <BalancerForm
                value={parsedNode}
                onChange={(next) => setText(JSON.stringify(next, null, 2))}
                outboundTags={(config.outbounds ?? []).map((o) => o.tag)}
                observatory={observatoryState(config, parsedNode)}
                onSetupObservatory={onSetupObservatory}
              />
            )}
            {parsedNode !== null && kind === 'observatory' && (
              <ObservatoryForm
                value={parsedNode}
                onChange={(next) => setText(JSON.stringify(next, null, 2))}
                outboundTags={(config.outbounds ?? []).map((o) => o.tag)}
              />
            )}
```

Хелпер там же, в `NodeInspector.tsx`:

```ts
/** Состояние глобальной обсерватории для карточки балансера */
function observatoryState(config: XrayConfig, balancer: Obj): ObservatoryState | undefined {
  const strategy = (balancer.strategy as { type?: string } | undefined)?.type
  if (strategy !== 'leastPing' && strategy !== 'leastLoad') return undefined
  const section = (strategy === 'leastLoad' ? config.burstObservatory : config.observatory) as
    | { subjectSelector?: string[] }
    | undefined
  const candidates = matchPrefixes(
    (config.outbounds ?? []).map((o) => o.tag),
    balancer.selector as string[] | undefined,
  )
  return {
    present: section !== undefined,
    missing: section === undefined ? [] : candidates.filter((t) => !subjectCovers(section.subjectSelector, t)),
  }
}
```

Проп в интерфейсе `Props`:

```ts
  onSetupObservatory?: (kind: 'observatory' | 'burst', subjects: string[]) => void
```

- [ ] **Step 6: Прокинуть создание секции из `EditorPage`**

Там, где `EditorPage` рендерит `<NodeInspector ... inboundSquads={ctx.inboundSquads} />`
(`EditorPage.tsx:489`), добавить:

```tsx
                onSetupObservatory={(kind, subjects) => {
                  changeConfig(ensureObservatorySection(config, kind, subjects))
                  setSelectedNode('obs')
                }}
```

Имена `changeConfig`, `config` и `setSelectedNode` возьмите те, что уже используются в этом
компоненте (правка конфига обязана идти через ту же функцию, что и остальные — один снимок
истории). Импорт `ensureObservatorySection` — из `../../entities/xray`.

- [ ] **Step 7: Запустить тесты**

Run: `npx vitest run test/balancer-form.test.tsx test/node-inspector.test.tsx && npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/features/inspector/BalancerForm.tsx frontend/src/features/inspector/ObservatoryForm.tsx \
        frontend/src/features/topology/NodeInspector.tsx frontend/src/features/editor/EditorPage.tsx \
        frontend/test/balancer-form.test.tsx
git commit -m "feat(frontend): forms for balancer and observatory nodes"
```

---

### Task 9: Трассировка через балансер

**Files:**
- Modify: `frontend/src/entities/xray/trace.ts`,
  `frontend/src/features/topology/TopologyView.tsx` (функция `tracedEdgeIds`),
  `frontend/src/features/diagnostics/TracePanel.tsx`
- Test: `frontend/test/trace.test.ts`, `frontend/test/topology-trace.test.ts`,
  `frontend/test/trace-panel.test.tsx`

**Interfaces:**
- Consumes: `findBalancer`, `balancerCandidates` (Task 1).
- Produces: `TraceWinner` с полями `balancerCandidates?: string[]` и `balancerStrategy?: string`;
  `tracedEdgeIds` подсвечивает `e:rule:<i>->bal:<tag>` и `e:bal:<tag>->out:<tag>`.

- [ ] **Step 1: Написать падающие тесты**

В `frontend/test/trace.test.ts`:

Файл уже держит константы `NO_GEO` и `TARGET` (цель — `api.openai.com:443/tcp`) — используем их:

```ts
describe('трассировка через балансер', () => {
  const balanced = (selector: string[], strategy = 'leastPing'): XrayConfig =>
    ({
      outbounds: [
        { tag: 'proxy-de', protocol: 'vless' },
        { tag: 'proxy-nl', protocol: 'vless' },
        { tag: 'direct', protocol: 'freedom' },
      ],
      routing: {
        rules: [{ domain: ['domain:openai.com'], balancerTag: 'bal-eu' }],
        balancers: [{ tag: 'bal-eu', selector, strategy: { type: strategy } }],
      },
    }) as XrayConfig

  it('победитель несёт кандидатов и стратегию', () => {
    const res = traceRoute(balanced(['proxy-']), TARGET, NO_GEO)
    expect(res.winner).toMatchObject({
      ruleIndex: 0,
      balancerTag: 'bal-eu',
      balancerStrategy: 'leastPing',
      balancerCandidates: ['proxy-de', 'proxy-nl'],
    })
  })

  it('оговорка про непредсказуемость конкретного выхода', () => {
    const res = traceRoute(balanced(['proxy-']), TARGET, NO_GEO)
    expect(res.caveats.some((c) => c.includes('выбирает ядро в рантайме'))).toBe(true)
  })

  it('пустой балансер — отдельная оговорка', () => {
    const res = traceRoute(balanced(['нет-такого-']), TARGET, NO_GEO)
    expect(res.caveats.some((c) => c.includes('нет кандидатов'))).toBe(true)
  })
})
```

Существующая проверка в этом же файле сравнивает победителя через `toEqual({ ruleIndex: 1,
outboundTag: 'warp', balancerTag: undefined })` — новые поля не должны появляться у победителя
без балансера, иначе она упадёт. Реализация ниже это обеспечивает: `withBalancer` возвращает
исходный объект, когда `balancerTag` не задан.

В `frontend/test/topology-trace.test.ts`:

```ts
it('подсвечивает путь через балансер целиком', () => {
  const config = {
    inbounds: [{ tag: 'in', protocol: 'vless' }],
    outbounds: [{ tag: 'proxy-de', protocol: 'vless' }, { tag: 'proxy-nl', protocol: 'vless' }],
    routing: {
      rules: [{ inboundTag: ['in'], balancerTag: 'bal-eu' }],
      balancers: [{ tag: 'bal-eu', selector: ['proxy-'] }],
    },
  }
  const ids = tracedEdgeIds(
    { verdicts: [], caveats: [], winner: { ruleIndex: 0, balancerTag: 'bal-eu', balancerCandidates: ['proxy-de', 'proxy-nl'] } },
    config,
  )
  expect([...ids]).toEqual(expect.arrayContaining([
    'e:in:in->rule:0', 'e:rule:0->bal:bal-eu', 'e:bal:bal-eu->out:proxy-de', 'e:bal:bal-eu->out:proxy-nl',
  ]))
})
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `npx vitest run test/trace.test.ts test/topology-trace.test.ts`
Expected: FAIL — полей нет, рёбра не подсвечиваются.

- [ ] **Step 3: Дополнить `trace.ts`**

```ts
export interface TraceWinner {
  /** null — ни одно правило не совпало, сработал дефолт (первый outbound) */
  ruleIndex: number | null
  outboundTag?: string
  balancerTag?: string
  /** Выходы, между которыми балансер будет выбирать; сам выбор — за ядром */
  balancerCandidates?: string[]
  balancerStrategy?: string
}
```

`pickWinner` получает кандидатов:

```ts
function withBalancer(winner: TraceWinner, config: XrayConfig): TraceWinner {
  if (!winner.balancerTag) return winner
  const balancer = findBalancer(config, winner.balancerTag)
  if (!balancer) return winner
  return {
    ...winner,
    balancerCandidates: balancerCandidates(config, balancer),
    balancerStrategy: balancer.strategy?.type ?? 'random',
  }
}
```

и оборачивает оба свои `return`: `return withBalancer({ ... }, config)`.

В `collectCaveats`, в конец, перед `return caveats`:

```ts
  if (winner?.balancerTag) {
    const candidates = winner.balancerCandidates ?? []
    if (candidates.length === 0) {
      caveats.push(
        `У балансера «${winner.balancerTag}» нет кандидатов: трафик уйдёт в запасной выход либо будет отброшен.`,
      )
    } else {
      caveats.push(
        `Балансер «${winner.balancerTag}» (${winner.balancerStrategy}) выберет один из выходов: ${candidates.join(', ')} — конкретный выбирает ядро в рантайме по замерам.`,
      )
    }
  }
```

Импорт: `import { balancerCandidates, findBalancer } from './balancers'`.

- [ ] **Step 4: Дополнить `tracedEdgeIds` в `TopologyView.tsx`**

```ts
  if (rule.outboundTag) ids.add(`e:rule:${index}->out:${rule.outboundTag}`)
  if (rule.balancerTag) {
    ids.add(`e:rule:${index}->bal:${rule.balancerTag}`)
    // Победителя среди кандидатов редактор не знает — подсвечиваем всех
    for (const tag of result?.winner?.balancerCandidates ?? []) {
      ids.add(`e:bal:${rule.balancerTag}->out:${tag}`)
    }
  }
```

- [ ] **Step 5: Показать кандидатов в `TracePanel`**

Заменить строку с балансером (`TracePanel.tsx:98`) на:

```tsx
            {winner.balancerTag && (
              <span className="metric">{`балансер ${winner.balancerTag} · ${winner.balancerStrategy ?? 'random'}`}</span>
            )}
            {winner.balancerCandidates?.map((tag) => (
              <span key={tag} className="metric metric-accent">{tag}</span>
            ))}
```

- [ ] **Step 6: Запустить тесты**

Run: `npx vitest run test/trace.test.ts test/topology-trace.test.ts test/trace-panel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/entities/xray/trace.ts frontend/src/features/topology/TopologyView.tsx \
        frontend/src/features/diagnostics/TracePanel.tsx \
        frontend/test/trace.test.ts frontend/test/topology-trace.test.ts
git commit -m "feat(frontend): trace routes through a balancer"
```

---

### Task 10: Рецепт «Балансировка»

**Files:**
- Create: `frontend/src/entities/xray/recipes/balance.ts`,
  `frontend/src/features/recipes/forms/BalanceForm.tsx`
- Modify: `frontend/src/entities/xray/recipes/apply.ts`,
  `frontend/src/entities/xray/recipes/index.ts`, `frontend/src/features/recipes/RecipesDialog.tsx`
- Test: `frontend/test/recipes-balance.test.ts` (создать), `frontend/test/recipes-registry.test.ts`

**Interfaces:**
- Consumes: `ensureObservatorySection` (Task 1), `ensureRule`/`ruleOrdinal` (существующие).
- Produces:
  - `ensureBalancer(config, balancer: Balancer): MergeResult`
  - `repointRules(config, outboundTags: string[], balancerTag: string): { config; count: number }`
  - `BalanceParams`, `BALANCE_DEFAULTS`, `planBalance`, `validateBalance`
  - `RecipeId` пополняется значением `'balance'`

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/recipes-balance.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BALANCE_DEFAULTS, planBalance, validateBalance } from '../src/entities/xray/recipes/balance'

const base = () => ({
  outbounds: [
    { tag: 'proxy-de', protocol: 'vless' },
    { tag: 'proxy-nl', protocol: 'vless' },
    { tag: 'direct', protocol: 'freedom' },
  ],
  routing: { rules: [{ domain: ['example.com'], outboundTag: 'proxy-de' }] },
})

const params = {
  ...BALANCE_DEFAULTS,
  tag: 'bal-eu',
  members: ['proxy-de', 'proxy-nl'],
  strategy: 'leastPing' as const,
  fallbackTag: 'direct',
  repoint: true,
}

describe('рецепт «Балансировка»', () => {
  it('создаёт балансер с точными тегами и обсерваторию', () => {
    const plan = planBalance(base(), params)
    expect(plan.config.routing!.balancers).toEqual([
      { tag: 'bal-eu', selector: ['proxy-de', 'proxy-nl'], fallbackTag: 'direct', strategy: { type: 'leastPing' } },
    ])
    expect(plan.config.observatory).toEqual({ subjectSelector: ['proxy-de', 'proxy-nl'] })
  })

  it('переводит правила выбранных выходов на балансер', () => {
    const plan = planBalance(base(), params)
    expect(plan.config.routing!.rules![0]).toEqual({ domain: ['example.com'], balancerTag: 'bal-eu' })
  })

  it('без repoint правила не трогает', () => {
    const plan = planBalance(base(), { ...params, repoint: false })
    expect(plan.config.routing!.rules![0]).toEqual({ domain: ['example.com'], outboundTag: 'proxy-de' })
  })

  it('идемпотентен: повторное применение ничего не добавляет', () => {
    const once = planBalance(base(), params).config
    const twice = planBalance(once, params)
    expect(twice.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(twice.config).toEqual(once)
  })

  it('не мутирует вход', () => {
    const cfg = base()
    planBalance(cfg, params)
    expect(cfg.routing.rules[0]).toEqual({ domain: ['example.com'], outboundTag: 'proxy-de' })
    expect((cfg as { routing: { balancers?: unknown } }).routing.balancers).toBeUndefined()
  })

  it('валидация ловит пустой список, fallback внутри списка и занятый тег', () => {
    expect(validateBalance({ ...params, members: [] })).toMatch(/выберите/i)
    expect(validateBalance({ ...params, fallbackTag: 'proxy-de' })).toMatch(/запасной/i)
    expect(validateBalance({ ...params, tag: '' })).toMatch(/тег/i)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run test/recipes-balance.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Добавить примитивы в `apply.ts`**

```ts
import type { Balancer } from '../balancers'

export function ensureBalancer(config: XrayConfig, balancer: Balancer): MergeResult {
  const list = config.routing?.balancers ?? []
  if (list.some((b) => b.tag === balancer.tag)) return { config, status: 'exists' }
  return {
    config: { ...config, routing: { ...(config.routing ?? {}), balancers: [...list, balancer] } },
    status: 'add',
  }
}

/**
 * Переводит правила, ведущие в перечисленные outbound’ы, на балансер. outboundTag
 * снимается: при обоих заданных тегах ядро берёт его, и балансер не сработал бы.
 */
export function repointRules(
  config: XrayConfig,
  outboundTags: string[],
  balancerTag: string,
): { config: XrayConfig; count: number } {
  const rules = config.routing?.rules ?? []
  let count = 0
  const next = rules.map((rule) => {
    if (rule.outboundTag === undefined || !outboundTags.includes(rule.outboundTag)) return rule
    count += 1
    const { outboundTag: _drop, ...rest } = rule
    return { ...rest, balancerTag }
  })
  if (count === 0) return { config, count }
  return { config: { ...config, routing: { ...(config.routing ?? {}), rules: next } }, count }
}
```

- [ ] **Step 4: Написать `balance.ts`**

```ts
// Рецепт «Балансировка»: объединяет существующие outbound’ы в один балансер,
// при необходимости заводит обсерваторию и переводит на балансер правила,
// которые сейчас ведут в эти выходы напрямую.

import type { XrayConfig } from '../config'
import { ensureObservatorySection } from '../observatory'
import { ensureBalancer, repointRules } from './apply'
import type { RecipeChange, RecipeNote, RecipePlan } from './types'

export const BALANCE_STRATEGY_OPTIONS = [
  { value: 'roundRobin', label: 'roundRobin — по кругу' },
  { value: 'random', label: 'random — случайный' },
  { value: 'leastPing', label: 'leastPing — самый быстрый' },
  { value: 'leastLoad', label: 'leastLoad — наименее загруженный' },
]

export interface BalanceParams {
  tag: string
  /** Теги outbound’ов, которые объединяем */
  members: string[]
  strategy: 'random' | 'roundRobin' | 'leastPing' | 'leastLoad'
  /** Пусто — без запасного выхода */
  fallbackTag: string
  /** Перевести правила этих выходов на балансер */
  repoint: boolean
}

export const BALANCE_DEFAULTS: BalanceParams = {
  tag: 'balancer',
  members: [],
  strategy: 'roundRobin',
  fallbackTag: '',
  repoint: true,
}

export function validateBalance(params: BalanceParams): string | null {
  if (params.tag.trim() === '') return 'Укажите тег балансера'
  if (params.members.length < 2) return 'Выберите хотя бы два выхода — балансировать один смысла нет'
  if (params.fallbackTag !== '' && params.members.includes(params.fallbackTag)) {
    return 'Запасной выход не должен входить в список балансируемых'
  }
  return null
}

export function planBalance(config: XrayConfig, params: BalanceParams): RecipePlan {
  const changes: RecipeChange[] = []
  const notes: RecipeNote[] = []
  const tag = params.tag.trim()

  const balancer = {
    tag,
    selector: [...params.members],
    ...(params.fallbackTag === '' ? {} : { fallbackTag: params.fallbackTag }),
    strategy: { type: params.strategy },
  }
  const withBalancer = ensureBalancer(config, balancer)
  changes.push({
    status: withBalancer.status,
    text:
      withBalancer.status === 'add'
        ? `балансер ${tag} (${params.strategy}) из ${params.members.join(', ')}`
        : `балансер ${tag} — уже есть, используем`,
  })

  let next = withBalancer.config
  if (params.strategy === 'leastPing' || params.strategy === 'leastLoad') {
    const kind = params.strategy === 'leastLoad' ? 'burst' : 'observatory'
    const afterObs = ensureObservatorySection(next, kind, params.members)
    changes.push({
      status: afterObs === next ? 'exists' : 'add',
      text:
        afterObs === next
          ? `${kind === 'burst' ? 'burstObservatory' : 'observatory'} — уже наблюдает эти выходы`
          : `${kind === 'burst' ? 'burstObservatory' : 'observatory'} наблюдает ${params.members.join(', ')}`,
    })
    next = afterObs
  }

  if (params.repoint) {
    const repointed = repointRules(next, params.members, tag)
    changes.push({
      status: repointed.count > 0 ? 'add' : 'exists',
      text:
        repointed.count > 0
          ? `правил переведено на балансер: ${repointed.count}`
          : 'правил, ведущих в эти выходы напрямую, нет',
    })
    next = repointed.config
  }

  if (params.fallbackTag === '') {
    notes.push({
      text: 'Без запасного выхода недоступность всех кандидатов означает обрыв соединений.',
    })
  }

  return { config: next, changes, notes }
}
```

- [ ] **Step 5: Зарегистрировать рецепт**

В `recipes/index.ts`:

```ts
import { BALANCE_DEFAULTS, planBalance, validateBalance } from './balance'
import type { BalanceParams } from './balance'
export * from './balance'

export type RecipeId = 'warp' | 'torrent' | 'ads' | 'private' | 'chain' | 'balance'

export interface AllParams {
  // ...существующие
  balance: BalanceParams
}

export const DEFAULT_PARAMS: AllParams = {
  // ...существующие
  balance: BALANCE_DEFAULTS,
}
```

В `RECIPES` добавить:

```ts
  {
    id: 'balance',
    title: 'Балансировка',
    summary: 'Объединяет несколько выходов в балансер и переводит на него правила',
  },
```

В `planFor` и `validateFor` — ветки `case 'balance': return planBalance(config, all.balance)` и
`case 'balance': return validateBalance(all.balance)`.

- [ ] **Step 6: Форма параметров**

Создать `frontend/src/features/recipes/forms/BalanceForm.tsx`:

```tsx
import { BALANCE_STRATEGY_OPTIONS, type BalanceParams } from '../../../entities/xray'
import { CheckboxField, MultiSelectField, SelectField, TextField, type Option } from '../../inspector/fields'

export function BalanceForm({
  value,
  outboundTags,
  onChange,
}: {
  value: BalanceParams
  outboundTags: string[]
  onChange: (v: BalanceParams) => void
}) {
  const fallbackOptions: Option[] = [
    { value: '', label: 'без запасного выхода' },
    ...outboundTags.filter((t) => !value.members.includes(t)).map((t) => ({ value: t, label: t })),
  ]
  return (
    <>
      <TextField label="Тег балансера" value={value.tag} onChange={(v) => onChange({ ...value, tag: v ?? '' })} />
      <MultiSelectField
        label="Балансируемые выходы"
        hint="В selector уйдут точные теги — префиксы можно дописать потом в форме балансера"
        options={outboundTags.map((t) => ({ value: t, label: t }))}
        value={value.members.length > 0 ? value.members : undefined}
        onChange={(v) => onChange({ ...value, members: v ?? [] })}
      />
      <SelectField
        label="Стратегия"
        hint="leastPing и leastLoad дополнительно заведут секцию наблюдения"
        value={value.strategy}
        options={BALANCE_STRATEGY_OPTIONS}
        onChange={(v) => onChange({ ...value, strategy: v as BalanceParams['strategy'] })}
      />
      <SelectField
        label="Запасной выход"
        value={value.fallbackTag}
        options={fallbackOptions}
        onChange={(v) => onChange({ ...value, fallbackTag: v })}
      />
      <CheckboxField
        label="Перевести правила этих выходов на балансер"
        hint="Правила с outboundTag выбранных выходов получат balancerTag вместо него"
        value={value.repoint ? true : undefined}
        onChange={(v) => onChange({ ...value, repoint: v === true })}
      />
    </>
  )
}
```

В `RecipesDialog.tsx` — импорт и ветка рядом с остальными:

```tsx
              {id === 'balance' && (
                <BalanceForm
                  value={params.balance}
                  outboundTags={outboundTags}
                  onChange={(balance) => setParams({ ...params, balance })}
                />
              )}
```

- [ ] **Step 7: Запустить тесты**

Run: `npx vitest run test/recipes-balance.test.ts test/recipes-registry.test.ts test/recipes-dialog.test.tsx test/recipes-apply.test.ts && npm run typecheck -w frontend`
Expected: PASS. `recipes-registry.test.ts` может проверять число рецептов — обновите ожидание
на шесть.

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/entities/xray/recipes/balance.ts frontend/src/entities/xray/recipes/apply.ts \
        frontend/src/entities/xray/recipes/index.ts frontend/src/features/recipes/forms/BalanceForm.tsx \
        frontend/src/features/recipes/RecipesDialog.tsx \
        frontend/test/recipes-balance.test.ts frontend/test/recipes-registry.test.ts
git commit -m "feat(frontend): balancing recipe"
```

---

### Task 11: Подсказки JSON, e2e и документация

**Files:**
- Modify: `frontend/src/entities/xray/docSchema.ts`,
  `frontend/src/features/editor/intellisense/context.ts`,
  `frontend/src/features/topology/NodeInspector.tsx`, `CLAUDE.md`
- Create: `frontend/e2e/balancers.spec.ts`
- Test: `frontend/test/intellisense.test.ts`, `frontend/e2e/balancers.spec.ts`

**Interfaces:**
- Consumes: узлы и формы из Task 4–8, рецепт из Task 10.
- Produces: `XrayRootKind` пополняется значением `'balancer'`; узлы docSchema `balancer`,
  `balancerStrategy`, `observatory`, `burstObservatory`, `pingConfig`.

- [ ] **Step 1: Написать падающий тест подсказок**

В `frontend/test/intellisense.test.ts` добавить импорт словаря и блок проверок (корневой узел
дерева называется `config` — см. `NODES` в `docSchema.ts:151`):

```ts
import { descend, nodeFields } from '../src/entities/xray/docSchema'

describe('словарь: балансеры и обсерватория', () => {
  it('знает поля балансера и обеих обсерваторий', () => {
    expect(Object.keys(nodeFields('balancer'))).toEqual(
      expect.arrayContaining(['tag', 'selector', 'fallbackTag', 'strategy']),
    )
    expect(Object.keys(nodeFields('observatory'))).toEqual(
      expect.arrayContaining(['subjectSelector', 'probeUrl', 'probeInterval', 'enableConcurrency']),
    )
    expect(Object.keys(nodeFields('pingConfig'))).toEqual(
      expect.arrayContaining(['destination', 'interval', 'sampling', 'timeout']),
    )
  })

  it('спуск по дереву доводит до нужных узлов', () => {
    expect(descend('routing', 'balancers')).toBe('balancer')
    expect(descend('balancer', 'strategy')).toBe('balancerStrategy')
    expect(descend('config', 'observatory')).toBe('observatory')
    expect(descend('config', 'burstObservatory')).toBe('burstObservatory')
    expect(descend('burstObservatory', 'pingConfig')).toBe('pingConfig')
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run test/intellisense.test.ts`
Expected: FAIL — узлов нет.

- [ ] **Step 3: Дополнить `docSchema.ts`**

В корневом узле (там, где сейчас `observatory: { doc: ..., type: 'object' }`, `docSchema.ts:164`)
добавить ссылки на узлы:

```ts
      observatory: { doc: 'Наблюдение за состоянием outbound-ов', type: 'object', node: 'observatory' },
      burstObservatory: { doc: 'Наблюдение с конкурентными замерами', type: 'object', node: 'burstObservatory' },
```

В узле `routing`:

```ts
      balancers: { doc: 'Балансировщики outbound-ов', type: 'array', itemsNode: 'balancer' },
```

Новые узлы рядом с `rule`:

```ts
  balancer: {
    fields: {
      tag: { doc: 'Тег балансера — на него ссылается balancerTag правила', type: 'string' },
      selector: { doc: 'ПРЕФИКСЫ тегов outbound-ов: «proxy-» захватит proxy-de и proxy-nl', type: 'array' },
      fallbackTag: { doc: 'Выход, когда все кандидаты недоступны', type: 'string' },
      strategy: { doc: 'Как выбирать выход', type: 'object', node: 'balancerStrategy' },
    },
  },
  balancerStrategy: {
    fields: {
      type: {
        doc: 'Стратегия выбора',
        type: 'string',
        enum: [
          { value: 'random', doc: 'Случайный выход' },
          { value: 'roundRobin', doc: 'По кругу' },
          { value: 'leastPing', doc: 'Самый быстрый; нужна секция observatory' },
          { value: 'leastLoad', doc: 'Наименее загруженный; нужна секция burstObservatory' },
        ],
      },
      settings: { doc: 'Тонкая настройка leastLoad: expected, maxRTT, tolerance, baselines, costs', type: 'object' },
    },
  },
  observatory: {
    fields: {
      subjectSelector: { doc: 'ПРЕФИКСЫ тегов наблюдаемых outbound-ов', type: 'array' },
      probeUrl: { doc: 'URL пробы; должен отвечать 204', type: 'string' },
      probeInterval: { doc: 'Интервал проб: 10s, 1m', type: 'string' },
      enableConcurrency: { doc: 'Мерить выходы параллельно', type: 'boolean' },
    },
  },
  burstObservatory: {
    fields: {
      subjectSelector: { doc: 'ПРЕФИКСЫ тегов наблюдаемых outbound-ов', type: 'array' },
      pingConfig: { doc: 'Параметры замеров', type: 'object', node: 'pingConfig' },
    },
  },
  pingConfig: {
    fields: {
      destination: { doc: 'Адрес проверки; должен отвечать HTTP 204', type: 'string' },
      connectivity: { doc: 'Адрес проверки локальной сети (только если основная проба упала)', type: 'string' },
      interval: { doc: 'Средний интервал между проверками, минимум 10s', type: 'string' },
      sampling: { doc: 'Сколько последних результатов хранить', type: 'number' },
      timeout: { doc: 'Таймаут запроса проверки', type: 'string' },
      httpMethod: { doc: 'Метод запроса проверки (HEAD, GET)', type: 'string' },
    },
  },
```

- [ ] **Step 4: Разрешить корень `balancer` в узловом редакторе**

В `features/editor/intellisense/context.ts`:

```ts
export type XrayRootKind = 'config' | 'inbound' | 'outbound' | 'rule' | 'dns' | 'balancer'
```

В `NodeInspector.tsx` расширить условие из Task 8, добавив `kind === 'balancer'` в список
корней, которые получают `xrayIntellisense`.

- [ ] **Step 5: Написать e2e**

Хелпер перетаскивания `connect` сейчас живёт локально в `e2e/connections.spec.ts:10-21`.
Переносим его в `e2e/helpers.ts` (экспортом, тело без изменений), в `connections.spec.ts`
заменяем определение на импорт — дублировать мышиный драг в двух файлах не нужно.

Мок-профиль (`e2e/mocks.ts`) содержит выходы `direct` и `block` — на них и собираем сценарий,
менять мок не требуется:

```ts
import { expect, test } from '@playwright/test'
import { connect } from './helpers'
import { UUID, mockApi } from './mocks'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
})

test('балансер собирается кабелями и показывает кандидатов', async ({ page }) => {
  await page.getByRole('button', { name: '+ Балансер' }).click()
  await expect(page.locator('.react-flow__node[data-id="bal:balancer"]')).toBeVisible()

  await connect(page, 'rule:0', 'bal:balancer')
  await connect(page, 'bal:balancer', 'out:direct')
  await connect(page, 'bal:balancer', 'out:block')

  await expect(page.locator('.react-flow__edge[data-id="e:rule:0->bal:balancer"]')).toBeVisible()
  await expect(page.locator('.react-flow__edge[data-id="e:bal:balancer->out:direct"]')).toBeVisible()
  await expect(page.locator('.react-flow__edge[data-id="e:bal:balancer->out:block"]')).toBeVisible()

  // Правило переехало на балансер — прежнего кабеля в outbound не осталось
  await expect(page.locator('.react-flow__edge[data-id="e:rule:0->out:direct"]')).toHaveCount(0)

  await page.locator('.react-flow__node[data-id="bal:balancer"]').click()
  const inspector = page.locator('aside')
  await expect(inspector.getByText(/Кандидаты:.*direct/)).toBeVisible()
  await expect(inspector.getByText(/Кандидаты:.*block/)).toBeVisible()
})
```

- [ ] **Step 6: Запустить тесты**

Run: `npx vitest run && npm run typecheck -w frontend && npm run e2e -w frontend`
Expected: PASS всё.

- [ ] **Step 7: Дописать `CLAUDE.md`**

В раздел «Frontend» после описания `entities/graph` добавить абзац:

```markdown
- **Балансеры.** `routing.balancers` — колонка графа между правилами и outbound'ами
  (`COLUMN_X.balancer`), узел `bal:<tag>`. `selector` матчит теги outbound'ов **по префиксу** —
  единственная реализация в `entities/xray/balancers.ts` (`matchPrefixes`/`balancerCandidates`),
  её же зовут форма, валидации, трассировка и рецепт. Разрыв ребра «балансер → выход»,
  заданного префиксом, требует подтверждения: `expandSelector` переписывает `selector` точными
  тегами. `observatory`/`burstObservatory` — глобальные секции (по одной на конфиг), живут в
  узле `obs` рядом с колонкой балансеров; `leastPing` требует первую, `leastLoad` — вторую.
  При заданных сразу `outboundTag` и `balancerTag` ядро берёт `outboundTag`, поэтому мутации
  графа снимают парный тег.
```

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/entities/xray/docSchema.ts frontend/src/features/editor/intellisense/context.ts \
        frontend/src/features/topology/NodeInspector.tsx frontend/e2e/balancers.spec.ts \
        frontend/e2e/helpers.ts frontend/e2e/mocks.ts frontend/test/intellisense.test.ts CLAUDE.md
git commit -m "docs: describe balancers and wire their JSON hints"
```

---

## Проверка перед завершением

- [ ] `npx vitest run` из `frontend` — зелёный
- [ ] `npm run typecheck -w frontend` — без ошибок
- [ ] `npm run e2e -w frontend` — зелёный
- [ ] `npm run build` из корня — собирается
- [ ] Ручная проверка: собрать балансер из двух выходов, выбрать `leastPing`, нажать «Настроить
  проверку живости», убедиться, что появился узел `obs` и предупреждение исчезло; проверить
  конфиг ядром кнопкой «Проверить». Если ядро откажется стартовать при `leastPing` без
  обсерватории — поднять этот уровень с `warning` до `error` в `analyzeIntegrity` отдельным
  коммитом (см. спеку, раздел «Валидации»).
