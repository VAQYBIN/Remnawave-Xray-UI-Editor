# Поддержка Mihomo, план 1 — ядро

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Шаблон подписки `MIHOMO` читается, проверяется, отображается графом и сохраняется в панель — без своей страницы редактора.

**Architecture:** Источником истины остаётся текст YAML: `yaml.parseDocument` даёт модель и диапазоны узлов, а все правки возвращаются списком `TextEdit` и накладываются на исходную строку сплайсами. Модель обратно в текст не печатается никогда, кроме одного изолированного места — подготовки временного файла для проверки ядром, результат которой сразу выбрасывается.

**Tech Stack:** TypeScript 7, `yaml` ^2.9, zod 4, Fastify 5, vitest 4, React Flow 12 (только типы узлов и рёбер).

**Spec:** `docs/superpowers/specs/2026-09-05-mihomo-templates-design.md`

## Global Constraints

- Источником истины является текст документа; модель строится из текста и никогда не печатается обратно. Единственное исключение — `backend/src/mihomo/dummyProxies.ts`, чей результат уходит во временный файл для ядра и удаляется.
- Правки применяются сплайсами по диапазонам узлов (`node.range`), а не перепечаткой документа. `doc.toString()` в коде фронтенда запрещён.
- Байты вне диапазона правки обязаны остаться прежними — это проверяется тестом, а не договорённостью.
- Значение, пришедшее через якорь или слияние `<<:`, из формы не редактируется: операция правки для такого поля возвращает пустой список рёбер правок, а вызывающий показывает поле только для чтения.
- Схемы разбора — `z.looseObject`; `type` группы, `behavior` набора правил и тип правила разбираются как строки, а не `z.enum`: незнакомое значение чужого шаблона обязано пройти насквозь и стать диагностикой, а не обрушить разбор документа.
- Ссылка на несуществующее имя цели — предупреждение (`warning`), а не ошибка: это может оказаться именем хоста, которое подставит панель. Имена подставленных хостов не предсказуемы в принципе.
- Язык UI, сообщений об ошибках и комментариев — русский; коммиты — английский conventional style (`feat(frontend): ...`).
- Существующие тесты редакторов Xray (профиля и шаблона) проходят без правки хотя бы одной строки. Понадобилась правка теста — уехало поведение, а не устарел тест.
- Маркер подстановки — комментарий `# LEAVE THIS LINE!`. Его отсутствие на корневом `proxies:` ошибкой не считается.

---

## Структура файлов

**Фронтенд, модель — `frontend/src/entities/mihomo/`**

| Файл | Ответственность |
|---|---|
| `parse.ts` | `parseMihomo(text)`: документ `yaml`, ошибки разбора в диагностики, доступ к секциям и диапазонам |
| `marker.ts` | константа маркера подстановки и его поиск в исходном тексте |
| `rules.ts` | разбор и печать строки правила, включая логические `AND`/`OR`/`NOT` |
| `groups.ts` | чтение `proxy-groups`, `proxy-providers`, `rule-providers`, `sub-rules` |
| `inject.ts` | маркеры подстановки и ключи `remnawave` |
| `resolve.ts` | имя цели → вид цели |
| `validate.ts` | диагностики документа |
| `edits.ts` | `TextEdit`, `applyEdits` и операции правки |
| `index.ts` | реэкспорт |

**Фронтенд, граф — `frontend/src/entities/graph/mihomo/`**

| Файл | Ответственность |
|---|---|
| `types.ts` | данные узлов графа Mihomo |
| `buildGraph.ts` | узлы, рёбра, колонки, глубина групп, циклы |
| `mutations.ts` | коммутация кабелем поверх `edits.ts` |

**Бэкенд**

| Файл | Ответственность |
|---|---|
| `backend/src/proc/spawn.ts` | общий `SpawnRunner` и запуск процесса (вынесен из `xray/service.ts`) |
| `backend/src/templates/hash.ts` | хэш по виду содержимого |
| `backend/src/templates/starterMihomo.ts` | каркас нового `MIHOMO`-шаблона |
| `backend/src/catalog/service.ts` | каталог шаблонов: загрузка индекса, кэш, белый список |
| `backend/src/routes/catalog.ts` | роуты каталога |
| `backend/src/mihomo/dummyProxies.ts` | подстановка фиктивных прокси вместо маркеров |
| `backend/src/mihomo/service.ts` | запуск `mihomo -t -f` |
| `backend/src/mihomo/parseOutput.ts` | разбор вывода ядра |

**Фикстуры и тесты**

`frontend/test/fixtures/mihomo/` — три настоящих шаблона; тесты `frontend/test/mihomo-*.test.ts`, `backend/test/templates-yaml.test.ts`, `backend/test/catalog.test.ts`, `backend/test/mihomo-test.test.ts`.

---

### Task 1: Разбор документа и фикстуры

**Files:**
- Create: `frontend/src/entities/mihomo/parse.ts`
- Create: `frontend/src/entities/mihomo/index.ts`
- Create: `frontend/test/fixtures/mihomo/default.yaml`, `simple.yaml`, `bundle.yaml`
- Modify: `frontend/package.json` (зависимость `yaml`)
- Modify: `frontend/test/helpers.ts` (чтение фикстур)
- Test: `frontend/test/mihomo-parse.test.ts`

**Interfaces:**
- Consumes: `ValidationIssue`, `PathParts` из `frontend/src/entities/xray/config.ts` (`{ parts: PathParts; path: string; message: string; level: 'error' | 'warning' }`).
- Produces: `parseMihomo(text: string): MihomoDoc`; `MihomoDoc = { text: string; doc: Document.Parsed; issues: ValidationIssue[] }`; `Range = { from: number; to: number }`; `rangeOf(node: unknown): Range | null`; `sectionNode(md: MihomoDoc, key: string): unknown`; хелпер тестов `mihomoFixture(name: 'default' | 'simple' | 'bundle'): string`.

- [ ] **Step 1: Положить фикстуры**

Три настоящих шаблона из официального репозитория. Они покрывают якоря, слияния `<<:`, обе роли маркера и отсутствие корневого маркера.

```bash
mkdir -p frontend/test/fixtures/mihomo
curl -fsSL -o frontend/test/fixtures/mihomo/default.yaml \
  https://raw.githubusercontent.com/remnawave/templates/main/remnawave-default/subscription-templates/mihomo.yaml
curl -fsSL -o frontend/test/fixtures/mihomo/simple.yaml \
  https://raw.githubusercontent.com/remnawave/templates/main/by-legiz/subscription-templates/mihomo-simple-without-ru.yaml
curl -fsSL -o frontend/test/fixtures/mihomo/bundle.yaml \
  https://raw.githubusercontent.com/remnawave/templates/main/by-legiz/subscription-templates/mihomo-ru-bundle.yaml
```

Проверить, что файлы не пустые и содержат маркеры:

```bash
grep -c "LEAVE THIS LINE" frontend/test/fixtures/mihomo/*.yaml
```

Ожидается: `default.yaml:2`, `simple.yaml:3`, `bundle.yaml:4`.

- [ ] **Step 2: Поставить зависимость**

```bash
npm i yaml@^2.9.0 -w frontend
```

- [ ] **Step 3: Добавить чтение фикстур в общие хелперы**

Дописать в конец `frontend/test/helpers.ts`. Хелпер живёт здесь, а не в тест-файле:
импорт одного тест-файла из другого заставил бы vitest выполнить его `describe` дважды.

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Настоящие шаблоны из remnawave/templates: якоря, слияния и обе роли маркера */
export function mihomoFixture(name: 'default' | 'simple' | 'bundle'): string {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/mihomo/${name}.yaml`, import.meta.url)),
    'utf8',
  )
}
```

- [ ] **Step 4: Написать падающий тест**

`frontend/test/mihomo-parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseMihomo, rangeOf, sectionNode } from '../src/entities/mihomo/parse'
import { mihomoFixture } from './helpers'

describe('разбор шаблона Mihomo', () => {
  it('читает секции всех трёх эталонных шаблонов', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const md = parseMihomo(mihomoFixture(name))
      expect(md.issues, `${name}: неожиданные ошибки разбора`).toEqual([])
      expect(sectionNode(md, 'proxy-groups')).toBeDefined()
      expect(sectionNode(md, 'rules')).toBeDefined()
    }
  })

  it('диапазон узла указывает на его текст', () => {
    const md = parseMihomo('rules:\n  - MATCH,DIRECT\n')
    const range = rangeOf(sectionNode(md, 'rules'))
    expect(range).not.toBeNull()
    expect(md.text.slice(range!.from, range!.to)).toContain('MATCH,DIRECT')
  })

  it('синтаксическая ошибка становится диагностикой, а не исключением', () => {
    const md = parseMihomo('proxy-groups:\n  - name: a\n   type: select\n')
    expect(md.issues.length).toBeGreaterThan(0)
    expect(md.issues[0]!.level).toBe('error')
  })

  it('незакрытая структура не гасит уже разобранное', () => {
    const md = parseMihomo('rules:\n  - MATCH,DIRECT\nproxy-groups:\n  - name: "a\n')
    expect(sectionNode(md, 'rules')).toBeDefined()
  })
})
```

- [ ] **Step 5: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/mihomo-parse.test.ts`
Ожидается: FAIL — модуль `../src/entities/mihomo/parse` не найден.

- [ ] **Step 6: Реализовать разбор**

`frontend/src/entities/mihomo/parse.ts`:

```ts
// Разбор шаблона Mihomo. Документ библиотеки `yaml` сохраняется целиком: из него
// берутся не только значения, но и диапазоны узлов в исходном тексте — на них
// строятся все правки (см. edits.ts). Модель обратно в текст не печатается.

import { isMap, isNode, parseDocument, type Document } from 'yaml'
import type { ValidationIssue } from '../xray/config'

export interface Range {
  from: number
  to: number
}

export interface MihomoDoc {
  text: string
  doc: Document.Parsed
  /** Только ошибки разбора YAML; смысловые проверки живут в validate.ts */
  issues: ValidationIssue[]
}

export function parseMihomo(text: string): MihomoDoc {
  const doc = parseDocument(text, { keepSourceTokens: true })
  const issues: ValidationIssue[] = doc.errors.map((e) => ({
    parts: [],
    path: '',
    message: `Синтаксис YAML: ${e.message}`,
    level: 'error' as const,
  }))
  return { text, doc, issues }
}

/**
 * Диапазон узла в исходном тексте. `node.range` — тройка
 * [начало, конец значения, конец узла с завершающими пробелами и комментарием];
 * правкам нужен второй элемент, иначе замена съест чужой комментарий.
 */
export function rangeOf(node: unknown): Range | null {
  if (!isNode(node) || node.range === undefined) return null
  const [from, to] = node.range
  return { from, to }
}

/** Узел секции верхнего уровня; undefined — секции в документе нет */
export function sectionNode(md: MihomoDoc, key: string): unknown {
  const contents = md.doc.contents
  if (!isMap(contents)) return undefined
  return contents.get(key, true) ?? undefined
}
```

`frontend/src/entities/mihomo/index.ts`:

```ts
export * from './parse'
```

- [ ] **Step 7: Убедиться, что тест проходит**

Из каталога `frontend`: `npx vitest run test/mihomo-parse.test.ts`
Ожидается: PASS, 4 теста.

- [ ] **Step 8: Коммит**

```bash
git add frontend/package.json package-lock.json frontend/src/entities/mihomo frontend/test/helpers.ts frontend/test/mihomo-parse.test.ts frontend/test/fixtures/mihomo
git commit -m "feat(frontend): разбор шаблона Mihomo с диапазонами узлов"
```

---

### Task 2: Правила маршрутизации

**Files:**
- Create: `frontend/src/entities/mihomo/rules.ts`
- Modify: `frontend/src/entities/mihomo/index.ts`
- Test: `frontend/test/mihomo-rules.test.ts`

**Interfaces:**
- Consumes: `MihomoDoc`, `Range`, `rangeOf`, `sectionNode` из `./parse`.
- Produces: `MihomoRule = { type: string; payload?: string; target: string; modifiers: string[]; raw: string }`; `parseRule(raw: string): MihomoRule | null`; `formatRule(rule: MihomoRule): string`; `RuleEntry = { index: number; rule: MihomoRule | null; raw: string; range: Range }`; `rulesOf(md: MihomoDoc): RuleEntry[]`; `RULE_TYPES: readonly string[]`; `splitTopLevel(value: string): string[]`.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/mihomo-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { formatRule, parseRule, RULE_TYPES, rulesOf, splitTopLevel } from '../src/entities/mihomo/rules'
import { mihomoFixture } from './helpers'

describe('разбор строки правила', () => {
  it('простое правило', () => {
    expect(parseRule('DOMAIN-SUFFIX,google.com,PROXY')).toEqual({
      type: 'DOMAIN-SUFFIX',
      payload: 'google.com',
      target: 'PROXY',
      modifiers: [],
      raw: 'DOMAIN-SUFFIX,google.com,PROXY',
    })
  })

  it('модификатор no-resolve', () => {
    const rule = parseRule('IP-CIDR,17.0.0.0/8,DIRECT,no-resolve')
    expect(rule?.modifiers).toEqual(['no-resolve'])
    expect(rule?.target).toBe('DIRECT')
  })

  it('MATCH не имеет значения, только цель', () => {
    const rule = parseRule('MATCH,🌍 VPN')
    expect(rule?.type).toBe('MATCH')
    expect(rule?.payload).toBeUndefined()
    expect(rule?.target).toBe('🌍 VPN')
  })

  it('логическое правило сохраняет скобки целиком', () => {
    const rule = parseRule('AND,((DOMAIN,baidu.com),(NETWORK,UDP)),DIRECT')
    expect(rule?.type).toBe('AND')
    expect(rule?.payload).toBe('((DOMAIN,baidu.com),(NETWORK,UDP))')
    expect(rule?.target).toBe('DIRECT')
  })

  it('печать возвращает исходную строку', () => {
    for (const raw of [
      'DOMAIN,ad.com,REJECT',
      'IP-CIDR,17.0.0.0/8,DIRECT,no-resolve',
      'OR,((RULE-SET,a),(RULE-SET,b)),🌍 VPN',
      'MATCH,DIRECT',
    ]) {
      expect(formatRule(parseRule(raw)!)).toBe(raw)
    }
  })

  it('мусор не разбирается, но и не бросает', () => {
    expect(parseRule('DIRECT')).toBeNull()
    expect(parseRule('')).toBeNull()
  })

  it('незнакомый тип разбирается — он станет диагностикой, а не поломкой', () => {
    const rule = parseRule('SOMETHING-NEW,value,DIRECT')
    expect(rule?.type).toBe('SOMETHING-NEW')
    expect(RULE_TYPES).not.toContain('SOMETHING-NEW')
  })

  it('разрез по запятым верхнего уровня не лезет в скобки', () => {
    expect(splitTopLevel('AND,((A,b),(C,d)),X')).toEqual(['AND', '((A,b),(C,d))', 'X'])
  })
})

describe('правила документа', () => {
  it('читает все правила эталонного шаблона с диапазонами', () => {
    const md = parseMihomo(mihomoFixture('simple'))
    const rules = rulesOf(md)
    expect(rules.length).toBeGreaterThan(10)
    const last = rules[rules.length - 1]!
    expect(last.rule?.type).toBe('MATCH')
    expect(md.text.slice(last.range.from, last.range.to)).toBe(last.raw)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/mihomo-rules.test.ts`
Ожидается: FAIL — модуль `rules` не найден.

- [ ] **Step 3: Реализовать**

`frontend/src/entities/mihomo/rules.ts`:

```ts
// Правило Mihomo — строка вида ТИП,значение,цель[,модификатор]. Логические типы
// прячут вложенные условия в скобках, поэтому разрез идёт по запятым ВЕРХНЕГО
// уровня: наивный split(',') разорвал бы ((DOMAIN,a),(NETWORK,UDP)) пополам.

import { isSeq } from 'yaml'
import { rangeOf, sectionNode, type MihomoDoc, type Range } from './parse'

export const RULE_TYPES = [
  'DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD', 'DOMAIN-REGEX', 'GEOSITE',
  'IP-CIDR', 'IP-CIDR6', 'IP-SUFFIX', 'IP-ASN', 'GEOIP',
  'SRC-GEOIP', 'SRC-IP-ASN', 'SRC-IP-CIDR', 'SRC-IP-SUFFIX',
  'DST-PORT', 'SRC-PORT', 'IN-PORT', 'IN-TYPE', 'IN-USER', 'IN-NAME',
  'PROCESS-PATH', 'PROCESS-PATH-WILDCARD', 'PROCESS-PATH-REGEX',
  'PROCESS-NAME', 'PROCESS-NAME-WILDCARD', 'PROCESS-NAME-REGEX',
  'UID', 'NETWORK', 'DSCP', 'RULE-SET', 'SUB-RULE',
  'AND', 'OR', 'NOT', 'MATCH',
] as const

/** Типы без значения: сразу после типа идёт цель */
const NO_PAYLOAD = new Set(['MATCH'])

export const RULE_MODIFIERS = ['no-resolve', 'src'] as const

export interface MihomoRule {
  type: string
  payload?: string
  target: string
  modifiers: string[]
  raw: string
}

export function splitTopLevel(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  out.push(current)
  return out
}

export function parseRule(raw: string): MihomoRule | null {
  const parts = splitTopLevel(raw.trim())
  if (parts.length < 2) return null
  const type = parts[0]!.trim()
  if (type === '') return null
  if (NO_PAYLOAD.has(type)) {
    return { type, target: parts[1]!, modifiers: parts.slice(2), raw }
  }
  if (parts.length < 3) return null
  return { type, payload: parts[1], target: parts[2]!, modifiers: parts.slice(3), raw }
}

export function formatRule(rule: MihomoRule): string {
  const parts = [rule.type]
  if (rule.payload !== undefined) parts.push(rule.payload)
  parts.push(rule.target, ...rule.modifiers)
  return parts.join(',')
}

export interface RuleEntry {
  index: number
  /** null — строку разобрать не удалось; validate.ts сделает из этого ошибку */
  rule: MihomoRule | null
  raw: string
  range: Range
}

export function rulesOf(md: MihomoDoc): RuleEntry[] {
  const node = sectionNode(md, 'rules')
  if (!isSeq(node)) return []
  const out: RuleEntry[] = []
  node.items.forEach((item, index) => {
    const range = rangeOf(item)
    if (range === null) return
    const raw = md.text.slice(range.from, range.to)
    out.push({ index, rule: parseRule(raw), raw, range })
  })
  return out
}
```

Добавить в `frontend/src/entities/mihomo/index.ts`:

```ts
export * from './rules'
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Из каталога `frontend`: `npx vitest run test/mihomo-rules.test.ts`
Ожидается: PASS, 9 тестов.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/mihomo frontend/test/mihomo-rules.test.ts
git commit -m "feat(frontend): разбор правил маршрутизации Mihomo"
```

---

### Task 3: Группы, провайдеры и подстановка

**Files:**
- Create: `frontend/src/entities/mihomo/marker.ts`
- Create: `frontend/src/entities/mihomo/groups.ts`
- Create: `frontend/src/entities/mihomo/inject.ts`
- Modify: `frontend/src/entities/mihomo/index.ts`
- Test: `frontend/test/mihomo-groups.test.ts`

**Interfaces:**
- Consumes: `MihomoDoc`, `Range`, `rangeOf`, `sectionNode` из `./parse`.
- Produces:
  - `INJECT_MARKER = 'LEAVE THIS LINE!'`, `markerAfterKey(md: MihomoDoc, map: unknown, key: string): boolean`
  - `MihomoGroup = { index: number; name: string; type?: string; proxies: string[]; use: string[]; includeAll: boolean; filter?: string; excludeFilter?: string; hidden: boolean; remnawave: RemnawaveKeys; hasMarker: boolean; range: Range }`
  - `RemnawaveKeys = { includeProxies?: boolean; selectRandomProxy?: boolean; shuffleProxiesOrder?: boolean }`
  - `MihomoProvider = { name: string; type?: string; includeProxies?: boolean; dialerProxy?: string; additionalPrefix?: string; range: Range }`
  - `RuleProviderRef = { name: string; behavior?: string; range: Range }`
  - `groupsOf(md): MihomoGroup[]`, `providersOf(md): MihomoProvider[]`, `ruleProvidersOf(md): RuleProviderRef[]`, `subRuleNames(md): string[]`
  - `INJECT_MARKER = 'LEAVE THIS LINE!'`, `hasRootMarker(md): boolean`, `groupGetsHosts(group: MihomoGroup): boolean`

- [ ] **Step 1: Написать падающий тест**

`frontend/test/mihomo-groups.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { groupGetsHosts, hasRootMarker } from '../src/entities/mihomo/inject'
import { groupsOf, providersOf, ruleProvidersOf } from '../src/entities/mihomo/groups'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { mihomoFixture } from './helpers'

describe('группы', () => {
  it('читает имя, тип и членство', () => {
    const md = parseMihomo(mihomoFixture('default'))
    const groups = groupsOf(md)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe('→ Remnawave')
    expect(groups[0]!.type).toBe('select')
    expect(groups[0]!.hasMarker).toBe(true)
  })

  it('видит ключи remnawave', () => {
    const md = parseMihomo(mihomoFixture('simple'))
    const direct = groupsOf(md).find((g) => g.name === '♻️ БезVPN')
    expect(direct?.remnawave.includeProxies).toBe(false)
    expect(direct?.hidden).toBe(true)
  })

  it('видит фильтры и include-all', () => {
    const md = parseMihomo(
      'proxy-groups:\n  - name: a\n    include-all: true\n    filter: "🇫🇮"\n    exclude-filter: "🇷🇺"\n',
    )
    const group = groupsOf(md)[0]!
    expect(group.includeAll).toBe(true)
    expect(group.filter).toBe('🇫🇮')
    expect(group.excludeFilter).toBe('🇷🇺')
  })
})

describe('подстановка хостов', () => {
  it('корневой маркер есть не везде, и это не ошибка', () => {
    expect(hasRootMarker(parseMihomo(mihomoFixture('default')))).toBe(true)
    expect(hasRootMarker(parseMihomo(mihomoFixture('simple')))).toBe(false)
  })

  it('группа получает хосты по маркеру, include-all или use', () => {
    const md = parseMihomo(
      'proxy-groups:\n' +
        '  - name: marker\n    proxies:\n      # LEAVE THIS LINE!\n' +
        '  - name: all\n    include-all: true\n' +
        '  - name: used\n    use:\n      - p1\n' +
        '  - name: empty\n    type: select\n',
    )
    const byName = Object.fromEntries(groupsOf(md).map((g) => [g.name, g]))
    expect(groupGetsHosts(byName.marker!)).toBe(true)
    expect(groupGetsHosts(byName.all!)).toBe(true)
    expect(groupGetsHosts(byName.used!)).toBe(true)
    expect(groupGetsHosts(byName.empty!)).toBe(false)
  })

  it('include-proxies: false отменяет маркер', () => {
    const md = parseMihomo(
      'proxy-groups:\n  - name: a\n    remnawave:\n      include-proxies: false\n    proxies:\n      # LEAVE THIS LINE!\n',
    )
    expect(groupGetsHosts(groupsOf(md)[0]!)).toBe(false)
  })
})

describe('провайдеры', () => {
  it('читает override цепочки', () => {
    const md = parseMihomo(
      'proxy-providers:\n  ru:\n    type: inline\n    remnawave:\n      include-proxies: true\n' +
        '    override:\n      dialer-proxy: 🇷🇺 Russia\n      additional-prefix: "🇷🇺➡️"\n',
    )
    const provider = providersOf(md)[0]!
    expect(provider.name).toBe('ru')
    expect(provider.includeProxies).toBe(true)
    expect(provider.dialerProxy).toBe('🇷🇺 Russia')
    expect(provider.additionalPrefix).toBe('🇷🇺➡️')
  })

  it('наборы правил читаются со своим поведением', () => {
    const md = parseMihomo(mihomoFixture('simple'))
    const names = ruleProvidersOf(md).map((p) => p.name)
    expect(names).toContain('youtube')
    expect(names).toContain('geoip-ru')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/mihomo-groups.test.ts`
Ожидается: FAIL — модули `groups`/`inject` не найдены.

- [ ] **Step 3: Реализовать поиск маркера**

Маркер ищется по ТЕКСТУ, а не по полю `comment` узла. Причина: библиотека `yaml` вешает
комментарий то на ключ, то на значение, то на следующий элемент списка — в зависимости от того,
пуст список или нет, а в живых шаблонах встречаются обе формы (`proxies: # LEAVE THIS LINE!` и
отдельная строка с комментарием внутри списка). Текстовый поиск от ключа до начала следующего
ключа того же отображения не зависит от того, куда именно библиотека прицепила комментарий.

`frontend/src/entities/mihomo/marker.ts`:

```ts
// Место подстановки хостов панель ищет по комментарию. Комментарий — не данные,
// поэтому и ищем мы его в тексте: любое обращение к разобранной модели зависело
// бы от того, к какому узлу библиотека прицепила комментарий в этот раз.

import { isMap } from 'yaml'
import { rangeOf, type MihomoDoc } from './parse'

export const INJECT_MARKER = 'LEAVE THIS LINE!'

/**
 * Есть ли маркер в области ключа `key` отображения `map` — от начала ключа до
 * начала следующего ключа того же отображения (или до конца отображения).
 * Именно в этой области живёт комментарий, к какому бы узлу он ни прицепился.
 */
export function markerAfterKey(md: MihomoDoc, map: unknown, key: string): boolean {
  if (!isMap(map)) return false
  const index = map.items.findIndex((p) => (p.key as { value?: unknown } | null)?.value === key)
  if (index === -1) return false

  const from = rangeOf(map.items[index]!.key as unknown)?.from
  if (from === undefined) return false

  const nextKey = map.items[index + 1]?.key as unknown
  const to = rangeOf(nextKey)?.from ?? rangeOf(map)?.to ?? md.text.length
  return md.text.slice(from, to).includes(INJECT_MARKER)
}
```

- [ ] **Step 4: Реализовать чтение групп**

`frontend/src/entities/mihomo/groups.ts`:

```ts
// Чтение сущностей шаблона. Никаких z.enum: `type` группы и `behavior` набора
// правил остаются строками, потому что незнакомое значение чужого шаблона должно
// стать диагностикой, а не обрушить разбор всего документа.

import { isMap, isSeq } from 'yaml'
import { markerAfterKey } from './marker'
import { rangeOf, sectionNode, type MihomoDoc, type Range } from './parse'

export interface RemnawaveKeys {
  includeProxies?: boolean
  selectRandomProxy?: boolean
  shuffleProxiesOrder?: boolean
}

export interface MihomoGroup {
  index: number
  name: string
  type?: string
  proxies: string[]
  use: string[]
  includeAll: boolean
  filter?: string
  excludeFilter?: string
  hidden: boolean
  remnawave: RemnawaveKeys
  /** В списке proxies стоит комментарий-маркер подстановки */
  hasMarker: boolean
  range: Range
}

function str(map: unknown, key: string): string | undefined {
  if (!isMap(map)) return undefined
  const value = map.get(key)
  return typeof value === 'string' ? value : undefined
}

function bool(map: unknown, key: string): boolean | undefined {
  if (!isMap(map)) return undefined
  const value = map.get(key)
  return typeof value === 'boolean' ? value : undefined
}

function strings(map: unknown, key: string): string[] {
  if (!isMap(map)) return []
  const value = map.get(key)
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function remnawaveKeys(map: unknown): RemnawaveKeys {
  if (!isMap(map)) return {}
  const section = map.get('remnawave')
  return {
    includeProxies: bool(section, 'include-proxies'),
    selectRandomProxy: bool(section, 'select-random-proxy'),
    shuffleProxiesOrder: bool(section, 'shuffle-proxies-order'),
  }
}

export function groupsOf(md: MihomoDoc): MihomoGroup[] {
  const node = sectionNode(md, 'proxy-groups')
  if (!isSeq(node)) return []
  const out: MihomoGroup[] = []
  node.items.forEach((item, index) => {
    const range = rangeOf(item)
    const name = str(item, 'name')
    if (range === null || name === undefined) return
    out.push({
      index,
      name,
      type: str(item, 'type'),
      proxies: strings(item, 'proxies'),
      use: strings(item, 'use'),
      includeAll: bool(item, 'include-all') === true || bool(item, 'include-all-proxies') === true,
      filter: str(item, 'filter'),
      excludeFilter: str(item, 'exclude-filter'),
      hidden: bool(item, 'hidden') === true,
      remnawave: remnawaveKeys(item),
      hasMarker: markerAfterKey(md, item, 'proxies'),
      range,
    })
  })
  return out
}

export interface MihomoProvider {
  name: string
  type?: string
  includeProxies?: boolean
  dialerProxy?: string
  additionalPrefix?: string
  range: Range
}

export function providersOf(md: MihomoDoc): MihomoProvider[] {
  const node = sectionNode(md, 'proxy-providers')
  if (!isMap(node)) return []
  const out: MihomoProvider[] = []
  for (const pair of node.items) {
    const name = (pair.key as { value?: unknown } | null)?.value
    const range = rangeOf(pair.value)
    if (typeof name !== 'string' || range === null) continue
    const override = isMap(pair.value) ? pair.value.get('override') : undefined
    out.push({
      name,
      type: str(pair.value, 'type'),
      includeProxies: remnawaveKeys(pair.value).includeProxies,
      dialerProxy: str(override, 'dialer-proxy'),
      additionalPrefix: str(override, 'additional-prefix'),
      range,
    })
  }
  return out
}

export interface RuleProviderRef {
  name: string
  behavior?: string
  range: Range
}

export function ruleProvidersOf(md: MihomoDoc): RuleProviderRef[] {
  const node = sectionNode(md, 'rule-providers')
  if (!isMap(node)) return []
  const out: RuleProviderRef[] = []
  for (const pair of node.items) {
    const name = (pair.key as { value?: unknown } | null)?.value
    const range = rangeOf(pair.value)
    if (typeof name !== 'string' || range === null) continue
    out.push({ name, behavior: str(pair.value, 'behavior'), range })
  }
  return out
}

export function subRuleNames(md: MihomoDoc): string[] {
  const node = sectionNode(md, 'sub-rules')
  if (!isMap(node)) return []
  return node.items
    .map((pair) => (pair.key as { value?: unknown } | null)?.value)
    .filter((name): name is string => typeof name === 'string')
}
```

- [ ] **Step 5: Реализовать подстановку**

`frontend/src/entities/mihomo/inject.ts`:

```ts
// Панель подставляет хосты туда, где стоит комментарий-маркер. Ключи remnawave
// уточняют, что именно попадёт в группу. Имена подставленных хостов НЕ
// предсказуемы: их даёт панель из примечаний хоста, а какие хосты подойдут под
// filter — знает только она. Отсюда мягкость всех проверок, опирающихся на имена.

import type { MihomoGroup } from './groups'
import { markerAfterKey } from './marker'
import type { MihomoDoc } from './parse'

export { INJECT_MARKER } from './marker'

/**
 * Есть ли маркер на корневом `proxies`. Его отсутствие ошибкой НЕ является:
 * в by-legiz/mihomo-simple-without-ru.yaml из официального репозитория его нет,
 * и шаблон рабочий.
 */
export function hasRootMarker(md: MihomoDoc): boolean {
  return markerAfterKey(md, md.doc.contents, 'proxies')
}

/** Положит ли панель в группу хоть что-нибудь */
export function groupGetsHosts(group: MihomoGroup): boolean {
  if (group.remnawave.includeProxies === false) return false
  if (group.remnawave.selectRandomProxy === true) return true
  if (group.remnawave.shuffleProxiesOrder === true) return true
  return group.hasMarker || group.includeAll || group.use.length > 0
}

/** Ключи, взаимно исключающие друг друга: обе выборки сразу невыразимы */
export function conflictingKeys(group: MihomoGroup): boolean {
  return group.remnawave.selectRandomProxy === true && group.remnawave.shuffleProxiesOrder === true
}
```

Добавить в `index.ts`:

```ts
export * from './marker'
export * from './groups'
export * from './inject'
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Из каталога `frontend`: `npx vitest run test/mihomo-groups.test.ts`
Ожидается: PASS, 7 тестов.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/entities/mihomo frontend/test/mihomo-groups.test.ts
git commit -m "feat(frontend): чтение групп, провайдеров и подстановки Mihomo"
```

---

### Task 4: Разрешение имён и диагностики

**Files:**
- Create: `frontend/src/entities/mihomo/resolve.ts`
- Create: `frontend/src/entities/mihomo/validate.ts`
- Modify: `frontend/src/entities/mihomo/index.ts`
- Test: `frontend/test/mihomo-validate.test.ts`

**Interfaces:**
- Consumes: `groupsOf`, `providersOf`, `ruleProvidersOf`, `subRuleNames`, `groupGetsHosts`, `conflictingKeys`, `rulesOf`, `RULE_TYPES` — все из задач 2 и 3.
- Produces: `BUILTIN_TARGETS: readonly string[]`; `TargetKind = 'group' | 'provider' | 'builtin' | 'unknown'`; `resolveTarget(md: MihomoDoc, name: string): TargetKind`; `validateMihomo(md: MihomoDoc): ValidationIssue[]`.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/mihomo-validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { resolveTarget } from '../src/entities/mihomo/resolve'
import { validateMihomo } from '../src/entities/mihomo/validate'
import { mihomoFixture } from './helpers'

const messages = (yaml: string) => validateMihomo(parseMihomo(yaml)).map((i) => i.message)

describe('разрешение имени цели', () => {
  it('различает группу, провайдера и встроенное имя', () => {
    const md = parseMihomo(
      'proxy-groups:\n  - name: VPN\nproxy-providers:\n  ru:\n    type: inline\n',
    )
    expect(resolveTarget(md, 'VPN')).toBe('group')
    expect(resolveTarget(md, 'ru')).toBe('provider')
    expect(resolveTarget(md, 'DIRECT')).toBe('builtin')
    expect(resolveTarget(md, 'что-то')).toBe('unknown')
  })
})

describe('диагностики', () => {
  it('эталонные шаблоны проходят без ошибок', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const errors = validateMihomo(parseMihomo(mihomoFixture(name))).filter((i) => i.level === 'error')
      expect(errors, `${name}: ${errors.map((e) => e.message).join('; ')}`).toEqual([])
    }
  })

  it('неизвестное имя цели — предупреждение, а не ошибка: это может быть хост панели', () => {
    const issues = validateMihomo(
      parseMihomo('proxy-groups:\n  - name: VPN\nrules:\n  - MATCH,🇫🇮 Finland1\n'),
    )
    expect(issues.every((i) => i.level === 'warning')).toBe(true)
    expect(issues.map((i) => i.message).join(' ')).toContain('🇫🇮 Finland1')
  })

  it('неразобранная строка правила — ошибка', () => {
    expect(messages('rules:\n  - DIRECT\n').join(' ')).toContain('не похоже на правило')
  })

  it('дублирование имён групп — ошибка', () => {
    const issues = validateMihomo(parseMihomo('proxy-groups:\n  - name: a\n  - name: a\n'))
    expect(issues.some((i) => i.level === 'error' && i.message.includes('повторяется'))).toBe(true)
  })

  it('цикл групп — ошибка', () => {
    const issues = validateMihomo(
      parseMihomo('proxy-groups:\n  - name: a\n    proxies:\n      - b\n  - name: b\n    proxies:\n      - a\n'),
    )
    expect(issues.some((i) => i.level === 'error' && i.message.includes('кольцо'))).toBe(true)
  })

  it('маркер при include-proxies: false — предупреждение о пустой группе', () => {
    const text =
      'proxy-groups:\n  - name: a\n    remnawave:\n      include-proxies: false\n    proxies:\n      # LEAVE THIS LINE!\n'
    expect(messages(text).join(' ')).toContain('останется пустой')
  })

  it('два способа выборки сразу — предупреждение', () => {
    const text =
      'proxy-groups:\n  - name: a\n    remnawave:\n      select-random-proxy: true\n      shuffle-proxies-order: true\n'
    expect(messages(text).join(' ')).toContain('одновременно')
  })

  it('ссылка на несуществующий набор правил — предупреждение', () => {
    expect(messages('rules:\n  - RULE-SET,нет-такого,DIRECT\n').join(' ')).toContain('нет-такого')
  })

  // У SUB-RULE третье поле — имя подсписка правил, а НЕ имя группы. Проверять его
  // как цель значит ругаться на каждый корректный шаблон с подправилами.
  it('SUB-RULE проверяется по sub-rules, а не по группам', () => {
    const good = 'sub-rules:\n  ru:\n    - MATCH,DIRECT\nrules:\n  - SUB-RULE,(NETWORK,tcp),ru\n  - MATCH,DIRECT\n'
    expect(messages(good).join(' ')).not.toContain('ru')
    const bad = 'rules:\n  - SUB-RULE,(NETWORK,tcp),нет-такого\n  - MATCH,DIRECT\n'
    expect(messages(bad).join(' ')).toContain('подсписок')
  })

  it('правило после MATCH недостижимо', () => {
    const text = 'rules:\n  - MATCH,DIRECT\n  - DOMAIN,a.com,DIRECT\n'
    expect(messages(text).join(' ')).toContain('никогда не сработает')
  })

  it('отсутствие MATCH — предупреждение', () => {
    expect(messages('rules:\n  - DOMAIN,a.com,DIRECT\n').join(' ')).toContain('MATCH')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/mihomo-validate.test.ts`
Ожидается: FAIL — модули `resolve`/`validate` не найдены.

- [ ] **Step 3: Реализовать разрешение имён**

`frontend/src/entities/mihomo/resolve.ts`:

```ts
import { groupsOf, providersOf } from './groups'
import type { MihomoDoc } from './parse'

/** Имена, которые ядро понимает само; COMPATIBLE — заглушка пустой группы */
export const BUILTIN_TARGETS = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE'] as const

export type TargetKind = 'group' | 'provider' | 'builtin' | 'unknown'

export function resolveTarget(md: MihomoDoc, name: string): TargetKind {
  if ((BUILTIN_TARGETS as readonly string[]).includes(name)) return 'builtin'
  if (groupsOf(md).some((g) => g.name === name)) return 'group'
  if (providersOf(md).some((p) => p.name === name)) return 'provider'
  return 'unknown'
}
```

- [ ] **Step 4: Реализовать диагностики**

`frontend/src/entities/mihomo/validate.ts`:

```ts
// Диагностики документа. Главное правило: имена подставленных панелью хостов
// редактору неизвестны, поэтому «неизвестное имя цели» — предупреждение, а не
// ошибка. Строгая проверка дала бы ложную тревогу на каждом корректном шаблоне.

import type { ValidationIssue, PathParts } from '../xray/config'
import { conflictingKeys, groupGetsHosts } from './inject'
import { groupsOf, providersOf, ruleProvidersOf, subRuleNames, type MihomoGroup } from './groups'
import type { MihomoDoc } from './parse'
import { resolveTarget } from './resolve'
import { RULE_TYPES, rulesOf } from './rules'

function issue(parts: PathParts, message: string, level: 'error' | 'warning'): ValidationIssue {
  return { parts, path: parts.join('.'), message, level }
}

/** Кольцо ссылок между группами: ядро на таком конфиге не поднимется */
function findCycle(groups: MihomoGroup[]): string[] | null {
  const byName = new Map(groups.map((g) => [g.name, g]))
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const walk = (name: string): string[] | null => {
    if (state.get(name) === 'done') return null
    if (state.get(name) === 'visiting') return [...stack.slice(stack.indexOf(name)), name]
    const group = byName.get(name)
    if (group === undefined) return null
    state.set(name, 'visiting')
    stack.push(name)
    for (const next of group.proxies) {
      const cycle = walk(next)
      if (cycle !== null) return cycle
    }
    stack.pop()
    state.set(name, 'done')
    return null
  }

  for (const group of groups) {
    const cycle = walk(group.name)
    if (cycle !== null) return cycle
  }
  return null
}

export function validateMihomo(md: MihomoDoc): ValidationIssue[] {
  const issues: ValidationIssue[] = [...md.issues]
  const groups = groupsOf(md)
  const providers = providersOf(md)
  const ruleProviders = new Set(ruleProvidersOf(md).map((p) => p.name))
  const subRules = new Set(subRuleNames(md))

  const seen = new Set<string>()
  groups.forEach((group) => {
    const at: PathParts = ['proxy-groups', group.index]
    if (seen.has(group.name)) {
      issues.push(issue([...at, 'name'], `Имя группы «${group.name}» повторяется`, 'error'))
    }
    seen.add(group.name)

    if (group.hasMarker && group.remnawave.includeProxies === false) {
      issues.push(
        issue(
          [...at, 'remnawave', 'include-proxies'],
          `Группа «${group.name}» останется пустой: маркер подстановки стоит, но include-proxies: false его отменяет`,
          'warning',
        ),
      )
    } else if (!groupGetsHosts(group) && group.proxies.length === 0) {
      issues.push(
        issue(at, `Панель ничего не положит в группу «${group.name}» — она останется пустой`, 'warning'),
      )
    }

    if (conflictingKeys(group)) {
      issues.push(
        issue(
          [...at, 'remnawave'],
          `У группы «${group.name}» заданы select-random-proxy и shuffle-proxies-order одновременно — способ выборки должен быть один`,
          'warning',
        ),
      )
    }

    group.proxies.forEach((name, i) => {
      if (resolveTarget(md, name) === 'unknown') {
        issues.push(
          issue(
            [...at, 'proxies', i],
            `«${name}» не найдено среди групп и провайдеров — если это не имя хоста от панели, ссылка не разрешится`,
            'warning',
          ),
        )
      }
    })
  })

  providers.forEach((provider) => {
    if (provider.includeProxies === false) {
      issues.push(
        issue(
          ['proxy-providers', provider.name, 'remnawave', 'include-proxies'],
          `include-proxies: false допустим только в proxy-groups; у провайдера «${provider.name}» он ничего не значит`,
          'warning',
        ),
      )
    }
  })

  const cycle = findCycle(groups)
  if (cycle !== null) {
    issues.push(issue(['proxy-groups'], `Группы ссылаются по кольцу: ${cycle.join(' → ')}`, 'error'))
  }

  const rules = rulesOf(md)
  let matchAt = -1
  rules.forEach((entry) => {
    const at: PathParts = ['rules', entry.index]
    if (entry.rule === null) {
      issues.push(issue(at, `«${entry.raw}» не похоже на правило: нужны тип, значение и цель`, 'error'))
      return
    }
    const { type, target, payload } = entry.rule
    if (!(RULE_TYPES as readonly string[]).includes(type)) {
      issues.push(issue(at, `Неизвестный тип правила «${type}»`, 'warning'))
    }
    if (type === 'MATCH' && matchAt === -1) matchAt = entry.index
    else if (matchAt !== -1) {
      issues.push(issue(at, `Правило никогда не сработает: выше стоит MATCH`, 'warning'))
    }
    if (type === 'RULE-SET' && payload !== undefined && !ruleProviders.has(payload)) {
      issues.push(issue(at, `Набор правил «${payload}» не объявлен в rule-providers`, 'warning'))
    }
    // У SUB-RULE третье поле — имя подсписка, а не группы: гонять его через
    // resolveTarget значит ругаться на каждый корректный шаблон с подправилами
    if (type === 'SUB-RULE') {
      if (!subRules.has(target)) {
        issues.push(issue(at, `Подсписок правил «${target}» не объявлен в sub-rules`, 'warning'))
      }
      return
    }
    if (resolveTarget(md, target) === 'unknown') {
      issues.push(
        issue(
          at,
          `Цель «${target}» не найдена среди групп и провайдеров — если это не имя хоста от панели, правило не разрешится`,
          'warning',
        ),
      )
    }
  })

  if (rules.length > 0 && matchAt === -1) {
    issues.push(
      issue(['rules'], 'В конце списка нет MATCH — трафик, не подошедший ни под одно правило, пойдёт напрямую', 'warning'),
    )
  }

  return issues
}
```

Добавить в `index.ts`:

```ts
export * from './resolve'
export * from './validate'
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Из каталога `frontend`: `npx vitest run test/mihomo-validate.test.ts`
Ожидается: PASS, 12 тестов.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/mihomo frontend/test/mihomo-validate.test.ts
git commit -m "feat(frontend): диагностики шаблона Mihomo"
```

---

### Task 5: Правки сплайсами

**Files:**
- Create: `frontend/src/entities/mihomo/edits.ts`
- Modify: `frontend/src/entities/mihomo/index.ts`
- Test: `frontend/test/mihomo-edits.test.ts`

**Interfaces:**
- Consumes: `MihomoDoc`, `Range`, `rangeOf`, `sectionNode`, `groupsOf`, `rulesOf`, `formatRule`.
- Produces: `TextEdit = { from: number; to: number; insert: string }`; `applyEdits(text: string, edits: TextEdit[]): string`; `FieldOrigin = 'own' | 'merged' | 'absent'`; `fieldOrigin(md, groupIndex, key): FieldOrigin`; `renameGroup(md, from, to): TextEdit[]`; `setGroupField(md, groupIndex, key, value: string | boolean): TextEdit[]`; `setRuleTarget(md, ruleIndex, target): TextEdit[]`; `removeRule(md, ruleIndex): TextEdit[]`; `addRule(md, raw, at?): TextEdit[]`.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/mihomo-edits.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  addRule, applyEdits, fieldOrigin, removeRule, renameGroup, setGroupField, setRuleTarget,
} from '../src/entities/mihomo/edits'
import { groupsOf } from '../src/entities/mihomo/groups'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { rulesOf } from '../src/entities/mihomo/rules'
import { mihomoFixture } from './helpers'

const edit = (text: string, make: (md: ReturnType<typeof parseMihomo>) => ReturnType<typeof renameGroup>) =>
  applyEdits(text, make(parseMihomo(text)))

describe('наложение правок', () => {
  it('накладывает несколько правок, не съезжая по смещениям', () => {
    expect(applyEdits('abcdef', [{ from: 0, to: 1, insert: 'X' }, { from: 4, to: 6, insert: 'YZ' }]))
      .toBe('Xbcd' + 'YZ')
  })

  it('пересекающиеся правки — исключение, а не тихая порча', () => {
    expect(() => applyEdits('abcdef', [{ from: 0, to: 3, insert: 'X' }, { from: 2, to: 4, insert: 'Y' }]))
      .toThrow(/пересек/i)
  })
})

describe('переименование группы', () => {
  it('меняет имя и все ссылки на него', () => {
    const text = mihomoFixture('simple')
    const out = edit(text, (md) => renameGroup(md, '▶️ YouTube', '▶️ Ютуб'))
    expect(out).toContain('name: ▶️ Ютуб')
    expect(out).toContain('RULE-SET,youtube,▶️ Ютуб')
    expect(out).not.toContain('▶️ YouTube')
  })

  it('не трогает байты вне правки', () => {
    const text = mihomoFixture('simple')
    const out = edit(text, (md) => renameGroup(md, '▶️ YouTube', '▶️ Ютуб'))
    const changed = out.split('\n').filter((line, i) => line !== text.split('\n')[i])
    // Ровно две строки: объявление группы и правило, ведущее в неё
    expect(changed).toHaveLength(2)
  })

  it('маркеры, якоря и слияния переживают правку', () => {
    const text = mihomoFixture('simple')
    const out = edit(text, (md) => renameGroup(md, '▶️ YouTube', '▶️ Ютуб'))
    const count = (s: string, needle: string) => s.split(needle).length - 1
    expect(count(out, 'LEAVE THIS LINE!')).toBe(count(text, 'LEAVE THIS LINE!'))
    expect(count(out, '<<:')).toBe(count(text, '<<:'))
    expect(count(out, '&rp_domain')).toBe(count(text, '&rp_domain'))
  })

  it('пустой список правок оставляет файл побайтово тем же', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const text = mihomoFixture(name)
      expect(applyEdits(text, [])).toBe(text)
    }
  })
})

describe('поля группы', () => {
  it('меняет тип группы', () => {
    const text = 'proxy-groups:\n  - name: a\n    type: select\n'
    const out = edit(text, (md) => setGroupField(md, 0, 'type', 'url-test'))
    expect(out).toBe('proxy-groups:\n  - name: a\n    type: url-test\n')
  })

  it('добавляет отсутствующее поле с отступом группы', () => {
    const text = 'proxy-groups:\n  - name: a\n    type: select\n'
    const out = edit(text, (md) => setGroupField(md, 0, 'hidden', true))
    expect(out).toContain('    hidden: true')
    expect(groupsOf(parseMihomo(out))[0]!.hidden).toBe(true)
  })

  it('значение из слияния правкой не трогается', () => {
    const text =
      'x-anchors:\n  base: &base\n    type: select\nproxy-groups:\n  - name: a\n    <<: *base\n'
    const md = parseMihomo(text)
    expect(fieldOrigin(md, 0, 'type')).toBe('merged')
    expect(setGroupField(md, 0, 'type', 'url-test')).toEqual([])
  })

  it('собственное поле рядом со слиянием правится', () => {
    const text =
      'x-anchors:\n  base: &base\n    lazy: true\nproxy-groups:\n  - name: a\n    <<: *base\n    type: select\n'
    const md = parseMihomo(text)
    expect(fieldOrigin(md, 0, 'type')).toBe('own')
    expect(setGroupField(md, 0, 'type', 'url-test')).not.toEqual([])
  })
})

describe('правила', () => {
  it('меняет цель правила, не трогая условие', () => {
    const text = 'rules:\n  - IP-CIDR,17.0.0.0/8,DIRECT,no-resolve\n'
    const out = edit(text, (md) => setRuleTarget(md, 0, 'VPN'))
    expect(out).toBe('rules:\n  - IP-CIDR,17.0.0.0/8,VPN,no-resolve\n')
  })

  it('удаляет правило вместе со строкой', () => {
    const text = 'rules:\n  - DOMAIN,a.com,DIRECT\n  - MATCH,DIRECT\n'
    const out = edit(text, (md) => removeRule(md, 0))
    expect(out).toBe('rules:\n  - MATCH,DIRECT\n')
  })

  it('вставляет правило перед указанным', () => {
    const text = 'rules:\n  - MATCH,DIRECT\n'
    const out = edit(text, (md) => addRule(md, 'DOMAIN,a.com,VPN', 0))
    expect(out).toBe('rules:\n  - DOMAIN,a.com,VPN\n  - MATCH,DIRECT\n')
    expect(rulesOf(parseMihomo(out))).toHaveLength(2)
  })

  it('вставка в конец списка', () => {
    const text = 'rules:\n  - DOMAIN,a.com,VPN\n'
    const out = edit(text, (md) => addRule(md, 'MATCH,DIRECT'))
    expect(out).toBe('rules:\n  - DOMAIN,a.com,VPN\n  - MATCH,DIRECT\n')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/mihomo-edits.test.ts`
Ожидается: FAIL — модуль `edits` не найден.

- [ ] **Step 3: Реализовать**

`frontend/src/entities/mihomo/edits.ts`:

```ts
// Единственный способ изменить документ. Каждая операция возвращает список
// правок по диапазонам исходного текста; перепечатка документа целиком
// (doc.toString()) запрещена — она меняет байты, которых пользователь не
// касался, и уничтожает комментарии-маркеры подстановки.

import { isMap, isSeq, stringify, type Pair } from 'yaml'
import { groupsOf } from './groups'
import { rangeOf, sectionNode, type MihomoDoc } from './parse'
import { rulesOf } from './rules'

export interface TextEdit {
  from: number
  to: number
  insert: string
}

export function applyEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.from - b.from)
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.from < sorted[i - 1]!.to) {
      throw new Error('Правки пересекаются — такой набор нельзя применить однозначно')
    }
  }
  let out = ''
  let cursor = 0
  for (const edit of sorted) {
    out += text.slice(cursor, edit.from) + edit.insert
    cursor = edit.to
  }
  return out + text.slice(cursor)
}

/** Печать одного скалярного значения так, как его записал бы YAML */
function scalar(value: string | boolean): string {
  return stringify(value).trimEnd()
}

export type FieldOrigin = 'own' | 'merged' | 'absent'

function groupNode(md: MihomoDoc, index: number): unknown {
  const node = sectionNode(md, 'proxy-groups')
  return isSeq(node) ? node.items[index] : undefined
}

function ownPair(map: unknown, key: string): Pair | undefined {
  if (!isMap(map)) return undefined
  return map.items.find((p) => (p.key as { value?: unknown } | null)?.value === key)
}

/**
 * Откуда у поля значение. `merged` — оно пришло через `<<: *anchor`, и править
 * его сплайсом нельзя: изменение затронуло бы все места, где используется якорь.
 */
export function fieldOrigin(md: MihomoDoc, groupIndex: number, key: string): FieldOrigin {
  const node = groupNode(md, groupIndex)
  if (ownPair(node, key) !== undefined) return 'own'
  if (ownPair(node, '<<') !== undefined && isMap(node) && node.get(key) !== undefined) return 'merged'
  return 'absent'
}

/** Отступ строки, на которой начинается указанное смещение */
function indentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const line = text.slice(lineStart, offset)
  return line.replace(/\S.*$/, '')
}

export function setGroupField(
  md: MihomoDoc,
  groupIndex: number,
  key: string,
  value: string | boolean,
): TextEdit[] {
  const origin = fieldOrigin(md, groupIndex, key)
  // Значение из якоря правкой не трогаем: форма показывает такое поле только для чтения
  if (origin === 'merged') return []

  const node = groupNode(md, groupIndex)
  if (origin === 'own') {
    const range = rangeOf(ownPair(node, key)?.value)
    if (range === null) return []
    return [{ from: range.from, to: range.to, insert: scalar(value) }]
  }

  // Поля нет — дописываем строкой после первого собственного ключа группы
  const first = isMap(node) ? node.items[0] : undefined
  const anchor = rangeOf(first?.value)
  if (anchor === null || anchor === undefined) return []
  const indent = indentAt(md.text, rangeOf(first?.key as unknown)?.from ?? anchor.from)
  return [{ from: anchor.to, to: anchor.to, insert: `\n${indent}${key}: ${scalar(value)}` }]
}

/**
 * Переименование группы. Меняется объявление и каждая ссылка: в rules, в списках
 * proxies других групп и в override.dialer-proxy провайдеров. Пропустить хоть
 * одну — оставить документ с висячей ссылкой.
 */
export function renameGroup(md: MihomoDoc, from: string, to: string): TextEdit[] {
  const edits: TextEdit[] = []
  const groups = groupsOf(md)
  const target = groups.find((g) => g.name === from)
  if (target === undefined) return []

  const namePair = ownPair(groupNode(md, target.index), 'name')
  const nameRange = rangeOf(namePair?.value)
  if (nameRange !== null) edits.push({ from: nameRange.from, to: nameRange.to, insert: scalar(to) })

  const section = sectionNode(md, 'proxy-groups')
  if (isSeq(section)) {
    section.items.forEach((item) => {
      const list = ownPair(item, 'proxies')?.value
      if (!isSeq(list)) return
      list.items.forEach((entry) => {
        if ((entry as { value?: unknown } | null)?.value !== from) return
        const range = rangeOf(entry)
        if (range !== null) edits.push({ from: range.from, to: range.to, insert: scalar(to) })
      })
    })
  }

  rulesOf(md).forEach((entry) => {
    if (entry.rule?.target !== from) return
    const insert = entry.raw.slice(0, entry.raw.lastIndexOf(from)) + to +
      entry.raw.slice(entry.raw.lastIndexOf(from) + from.length)
    edits.push({ from: entry.range.from, to: entry.range.to, insert })
  })

  const providers = sectionNode(md, 'proxy-providers')
  if (isMap(providers)) {
    providers.items.forEach((pair) => {
      const override = ownPair(pair.value, 'override')?.value
      const dialer = ownPair(override, 'dialer-proxy')?.value
      if ((dialer as { value?: unknown } | null)?.value !== from) return
      const range = rangeOf(dialer)
      if (range !== null) edits.push({ from: range.from, to: range.to, insert: scalar(to) })
    })
  }

  return edits
}

export function setRuleTarget(md: MihomoDoc, ruleIndex: number, target: string): TextEdit[] {
  const entry = rulesOf(md).find((r) => r.index === ruleIndex)
  if (entry?.rule === undefined || entry.rule === null) return []
  const insert = [
    entry.rule.type,
    ...(entry.rule.payload === undefined ? [] : [entry.rule.payload]),
    target,
    ...entry.rule.modifiers,
  ].join(',')
  return [{ from: entry.range.from, to: entry.range.to, insert }]
}

/** Удаление элемента списка забирает строку целиком — иначе останется «- » */
export function removeRule(md: MihomoDoc, ruleIndex: number): TextEdit[] {
  const entry = rulesOf(md).find((r) => r.index === ruleIndex)
  if (entry === undefined) return []
  const lineStart = md.text.lastIndexOf('\n', entry.range.from - 1) + 1
  const lineEnd = md.text.indexOf('\n', entry.range.to)
  return [{ from: lineStart, to: lineEnd === -1 ? md.text.length : lineEnd + 1, insert: '' }]
}

export function addRule(md: MihomoDoc, raw: string, at?: number): TextEdit[] {
  const rules = rulesOf(md)
  if (rules.length === 0) return []
  const anchor = at === undefined ? rules[rules.length - 1]! : rules.find((r) => r.index === at)
  if (anchor === undefined) return []
  const lineStart = md.text.lastIndexOf('\n', anchor.range.from - 1) + 1
  const indent = md.text.slice(lineStart, anchor.range.from).replace(/-\s*$/, '')
  const line = `${indent}- ${raw}\n`
  if (at === undefined) {
    const lineEnd = md.text.indexOf('\n', anchor.range.to)
    const insertAt = lineEnd === -1 ? md.text.length : lineEnd + 1
    return [{ from: insertAt, to: insertAt, insert: line }]
  }
  return [{ from: lineStart, to: lineStart, insert: line }]
}
```

Добавить в `index.ts`:

```ts
export * from './edits'
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Из каталога `frontend`: `npx vitest run test/mihomo-edits.test.ts`
Ожидается: PASS, 13 тестов.

- [ ] **Step 5: Проверить саботажем, что тест локальности не бутафорский**

Временно заменить в `renameGroup` возврат правок на перепечатку документа
(`[{ from: 0, to: md.text.length, insert: md.doc.toString() }]`) и убедиться, что падают
тесты «не трогает байты вне правки» и «маркеры, якоря и слияния переживают правку».
Вернуть код обратно.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/mihomo frontend/test/mihomo-edits.test.ts
git commit -m "feat(frontend): правки шаблона Mihomo сплайсами по диапазонам"
```

---

### Task 6: Граф

Осознанная граница: правило `SUB-RULE` рисуется обычным узлом с именем подсписка в данных, а сам
подсписок в графе не раскрывается. Раскрытие требует своего элемента управления и приедет вместе
с инспектором в плане 2; ссылку на несуществующий подсписок при этом уже ловит `validateMihomo`.

**Files:**
- Create: `frontend/src/entities/graph/mihomo/types.ts`
- Create: `frontend/src/entities/graph/mihomo/buildGraph.ts`
- Test: `frontend/test/mihomo-graph.test.ts`

**Interfaces:**
- Consumes: `MihomoDoc`, `groupsOf`, `providersOf`, `rulesOf`, `resolveTarget`, `groupGetsHosts`, `hasRootMarker`; `FlowNode`, `FlowEdge`, `IssueCount` из `frontend/src/entities/graph/types.ts`; `edgeId(source, target)` из `frontend/src/entities/graph/edgeIds.ts`.
- Produces: `buildMihomoGraph(md: MihomoDoc): { nodes: FlowNode[]; edges: FlowEdge[] }`; `groupDepths(groups: MihomoGroup[]): Map<string, number>`; `MIHOMO_COLUMN_W = 430`; данные узлов `MihomoRuleNodeData`, `MihomoGroupNodeData`, `MihomoProviderNodeData`, `MihomoHostsNodeData`, `MihomoBuiltinNodeData`.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/mihomo-graph.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildMihomoGraph, groupDepths } from '../src/entities/graph/mihomo/buildGraph'
import { groupsOf } from '../src/entities/mihomo/groups'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { mihomoFixture } from './helpers'

describe('граф Mihomo', () => {
  it('строит узлы правил, групп и подстановки', () => {
    const { nodes } = buildMihomoGraph(parseMihomo(mihomoFixture('default')))
    const ids = nodes.map((n) => n.id)
    expect(ids).toContain('rule:0')
    expect(ids).toContain('group:→ Remnawave')
    expect(ids).toContain('hosts:→ Remnawave')
    expect(ids).toContain('builtin:DIRECT')
  })

  it('ребро правила ведёт в группу по имени', () => {
    const { edges } = buildMihomoGraph(parseMihomo(mihomoFixture('default')))
    expect(edges.map((e) => e.id)).toContain('e:rule:2->group:→ Remnawave')
  })

  it('группа, ссылающаяся на группу, стоит колонкой правее', () => {
    const md = parseMihomo(
      'proxy-groups:\n  - name: VPN\n    proxies:\n      - Fast\n  - name: Fast\n    include-all: true\n',
    )
    const depths = groupDepths(groupsOf(md))
    expect(depths.get('VPN')).toBe(1)
    expect(depths.get('Fast')).toBe(0)
  })

  it('кольцо не вешает расчёт глубины', () => {
    const md = parseMihomo(
      'proxy-groups:\n  - name: a\n    proxies:\n      - b\n  - name: b\n    proxies:\n      - a\n',
    )
    const depths = groupDepths(groupsOf(md))
    expect(depths.size).toBe(2)
    expect(Number.isFinite(depths.get('a'))).toBe(true)
  })

  it('на большом шаблоне узлы не дублируются', () => {
    const { nodes } = buildMihomoGraph(parseMihomo(mihomoFixture('bundle')))
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length)
  })

  it('на большом шаблоне рёбра не дублируются', () => {
    const { edges } = buildMihomoGraph(parseMihomo(mihomoFixture('bundle')))
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/mihomo-graph.test.ts`
Ожидается: FAIL — модуль `buildGraph` не найден.

- [ ] **Step 3: Реализовать типы узлов**

`frontend/src/entities/graph/mihomo/types.ts`:

```ts
import type { IssueCount } from '../types'

export interface MihomoRuleNodeData extends Record<string, unknown> {
  kind: 'mihomo-rule'; index: number; type: string; payload?: string; modifiers: string[]
  issueCount?: IssueCount
}
export interface MihomoGroupNodeData extends Record<string, unknown> {
  kind: 'mihomo-group'; index: number; name: string; type?: string
  /** Сколько имён перечислено вручную */
  manual: number
  hidden: boolean
  /** Положит ли панель в группу хосты */
  getsHosts: boolean
  issueCount?: IssueCount
}
export interface MihomoProviderNodeData extends Record<string, unknown> {
  kind: 'mihomo-provider'; name: string; type?: string; dialerProxy?: string
  issueCount?: IssueCount
}
export interface MihomoHostsNodeData extends Record<string, unknown> {
  kind: 'mihomo-hosts'
  /** 'root' — корневой proxies, иначе имя группы */
  owner: string
  filter?: string
  excludeFilter?: string
  /** Как панель выберет хосты: все, один случайный, все вперемешку */
  pick: 'all' | 'random' | 'shuffled'
}
export interface MihomoBuiltinNodeData extends Record<string, unknown> {
  kind: 'mihomo-builtin'; name: string
}
```

- [ ] **Step 4: Реализовать граф**

`frontend/src/entities/graph/mihomo/buildGraph.ts`:

```ts
// Граф Mihomo: правила → группы → выходы. Группы ссылаются на группы, поэтому
// колонка групп не одна — глубина считается от выходов. Кольцо ссылок глубину
// не вешает: узел, уже находящийся в обходе, даёт нулевой вклад, а сама ошибка
// приходит диагностикой из validate.ts.

import { groupsOf, providersOf, type MihomoGroup } from '../../mihomo/groups'
import { groupGetsHosts, hasRootMarker } from '../../mihomo/inject'
import type { MihomoDoc } from '../../mihomo/parse'
import { resolveTarget } from '../../mihomo/resolve'
import { rulesOf } from '../../mihomo/rules'
import { edgeId } from '../edgeIds'
import type { FlowEdge, FlowNode } from '../types'

export const MIHOMO_COLUMN_W = 430
export const MIHOMO_ROW_H = 130

export function groupDepths(groups: MihomoGroup[]): Map<string, number> {
  const byName = new Map(groups.map((g) => [g.name, g]))
  const depths = new Map<string, number>()
  const visiting = new Set<string>()

  const depth = (name: string): number => {
    const known = depths.get(name)
    if (known !== undefined) return known
    const group = byName.get(name)
    if (group === undefined) return 0
    if (visiting.has(name)) return 0
    visiting.add(name)
    let max = 0
    for (const child of group.proxies) {
      if (!byName.has(child)) continue
      max = Math.max(max, depth(child) + 1)
    }
    visiting.delete(name)
    depths.set(name, max)
    return max
  }

  for (const group of groups) depth(group.name)
  return depths
}

function pickOf(group: MihomoGroup): 'all' | 'random' | 'shuffled' {
  if (group.remnawave.selectRandomProxy === true) return 'random'
  if (group.remnawave.shuffleProxiesOrder === true) return 'shuffled'
  return 'all'
}

export function buildMihomoGraph(md: MihomoDoc): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const groups = groupsOf(md)
  const providers = providersOf(md)
  const depths = groupDepths(groups)
  const maxDepth = Math.max(0, ...depths.values())
  const outputColumn = maxDepth + 2

  const pushEdge = (source: string, target: string) => {
    const id = edgeId(source, target)
    if (edges.some((e) => e.id === id)) return
    edges.push({ id, source, target })
  }

  const builtins = new Set<string>()
  const ensureBuiltin = (name: string) => {
    if (builtins.has(name)) return
    builtins.add(name)
    nodes.push({
      id: `builtin:${name}`,
      type: 'mihomoBuiltin',
      position: { x: outputColumn * MIHOMO_COLUMN_W, y: 0 },
      data: { kind: 'mihomo-builtin', name },
    })
  }

  groups.forEach((group) => {
    const column = maxDepth - (depths.get(group.name) ?? 0) + 1
    nodes.push({
      id: `group:${group.name}`,
      type: 'mihomoGroup',
      position: { x: column * MIHOMO_COLUMN_W, y: 0 },
      data: {
        kind: 'mihomo-group',
        index: group.index,
        name: group.name,
        type: group.type,
        manual: group.proxies.length,
        hidden: group.hidden,
        getsHosts: groupGetsHosts(group),
      },
    })

    if (groupGetsHosts(group) && group.use.length === 0) {
      const id = `hosts:${group.name}`
      nodes.push({
        id,
        type: 'mihomoHosts',
        position: { x: outputColumn * MIHOMO_COLUMN_W, y: 0 },
        data: {
          kind: 'mihomo-hosts',
          owner: group.name,
          filter: group.filter,
          excludeFilter: group.excludeFilter,
          pick: pickOf(group),
        },
      })
      pushEdge(`group:${group.name}`, id)
    }
  })

  if (hasRootMarker(md)) {
    nodes.push({
      id: 'hosts:root',
      type: 'mihomoHosts',
      position: { x: outputColumn * MIHOMO_COLUMN_W, y: 0 },
      data: { kind: 'mihomo-hosts', owner: 'root', pick: 'all' },
    })
  }

  providers.forEach((provider) => {
    nodes.push({
      id: `provider:${provider.name}`,
      type: 'mihomoProvider',
      position: { x: outputColumn * MIHOMO_COLUMN_W, y: 0 },
      data: {
        kind: 'mihomo-provider',
        name: provider.name,
        type: provider.type,
        dialerProxy: provider.dialerProxy,
      },
    })
  })

  groups.forEach((group) => {
    for (const name of group.proxies) {
      const kind = resolveTarget(md, name)
      if (kind === 'group') pushEdge(`group:${group.name}`, `group:${name}`)
      if (kind === 'provider') pushEdge(`group:${group.name}`, `provider:${name}`)
      if (kind === 'builtin') {
        ensureBuiltin(name)
        pushEdge(`group:${group.name}`, `builtin:${name}`)
      }
    }
    for (const name of group.use) pushEdge(`group:${group.name}`, `provider:${name}`)
  })

  rulesOf(md).forEach((entry) => {
    const id = `rule:${entry.index}`
    nodes.push({
      id,
      type: 'mihomoRule',
      position: { x: 0, y: entry.index * MIHOMO_ROW_H },
      data: {
        kind: 'mihomo-rule',
        index: entry.index,
        type: entry.rule?.type ?? '?',
        payload: entry.rule?.payload,
        modifiers: entry.rule?.modifiers ?? [],
      },
    })
    const target = entry.rule?.target
    if (target === undefined) return
    const kind = resolveTarget(md, target)
    if (kind === 'group') pushEdge(id, `group:${target}`)
    if (kind === 'provider') pushEdge(id, `provider:${target}`)
    if (kind === 'builtin') {
      ensureBuiltin(target)
      pushEdge(id, `builtin:${target}`)
    }
  })

  return { nodes, edges }
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Из каталога `frontend`: `npx vitest run test/mihomo-graph.test.ts`
Ожидается: PASS, 6 тестов.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/graph/mihomo frontend/test/mihomo-graph.test.ts
git commit -m "feat(frontend): граф шаблона Mihomo"
```

---

### Task 7: Коммутация графа

**Files:**
- Create: `frontend/src/entities/graph/mihomo/mutations.ts`
- Test: `frontend/test/mihomo-mutations.test.ts`

**Interfaces:**
- Consumes: `TextEdit`, `setRuleTarget`, `applyEdits`, `setGroupField` из `../../mihomo/edits`; `groupsOf`, `rulesOf`, `resolveTarget`; `edgeId`.
- Produces: `isValidMihomoConnection(source: string, target: string): boolean`; `connectMihomo(md: MihomoDoc, source: string, target: string): TextEdit[]`; `disconnectMihomo(md: MihomoDoc, edge: string): TextEdit[]`.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/mihomo-mutations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { connectMihomo, disconnectMihomo, isValidMihomoConnection } from '../src/entities/graph/mihomo/mutations'
import { applyEdits } from '../src/entities/mihomo/edits'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { rulesOf } from '../src/entities/mihomo/rules'
import { groupsOf } from '../src/entities/mihomo/groups'

const base =
  'proxy-groups:\n  - name: VPN\n    proxies:\n      - DIRECT\n  - name: Fast\n    include-all: true\n' +
  'rules:\n  - DOMAIN,a.com,DIRECT\n  - MATCH,VPN\n'

describe('допустимость соединений', () => {
  it('правило ведёт в группу, провайдера и встроенное имя', () => {
    expect(isValidMihomoConnection('rule:0', 'group:VPN')).toBe(true)
    expect(isValidMihomoConnection('rule:0', 'provider:ru')).toBe(true)
    expect(isValidMihomoConnection('rule:0', 'builtin:DIRECT')).toBe(true)
  })

  it('в правило и в узел подстановки кабель не входит', () => {
    expect(isValidMihomoConnection('group:VPN', 'rule:0')).toBe(false)
    expect(isValidMihomoConnection('hosts:VPN', 'group:VPN')).toBe(false)
    expect(isValidMihomoConnection('group:VPN', 'hosts:VPN')).toBe(false)
  })

  it('группа ведёт в группу', () => {
    expect(isValidMihomoConnection('group:VPN', 'group:Fast')).toBe(true)
  })
})

describe('соединение', () => {
  it('перенаправляет правило в группу', () => {
    const md = parseMihomo(base)
    const out = applyEdits(base, connectMihomo(md, 'rule:0', 'group:Fast'))
    expect(rulesOf(parseMihomo(out))[0]!.raw).toBe('DOMAIN,a.com,Fast')
  })

  it('добавляет группу в список другой группы', () => {
    const md = parseMihomo(base)
    const out = applyEdits(base, connectMihomo(md, 'group:VPN', 'group:Fast'))
    expect(groupsOf(parseMihomo(out))[0]!.proxies).toEqual(['DIRECT', 'Fast'])
  })

  it('повторное соединение ничего не меняет', () => {
    const md = parseMihomo(base)
    expect(connectMihomo(md, 'group:VPN', 'builtin:DIRECT')).toEqual([])
  })
})

describe('разрыв', () => {
  it('убирает имя из списка группы', () => {
    const md = parseMihomo(base)
    const out = applyEdits(base, disconnectMihomo(md, 'e:group:VPN->builtin:DIRECT'))
    expect(groupsOf(parseMihomo(out))[0]!.proxies).toEqual([])
  })

  it('разрыв ребра правила невозможен — у правила всегда есть цель', () => {
    const md = parseMihomo(base)
    expect(disconnectMihomo(md, 'e:rule:1->group:VPN')).toEqual([])
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/mihomo-mutations.test.ts`
Ожидается: FAIL — модуль `mutations` не найден.

- [ ] **Step 3: Реализовать**

`frontend/src/entities/graph/mihomo/mutations.ts`:

```ts
// Коммутация кабелем поверх сплайсов. Ни одна операция не печатает документ:
// все возвращают TextEdit[], которые накладывает вызывающий.

import { isMap, isSeq, stringify } from 'yaml'
import { groupsOf } from '../../mihomo/groups'
import { setRuleTarget, type TextEdit } from '../../mihomo/edits'
import { rangeOf, sectionNode, type MihomoDoc } from '../../mihomo/parse'
import { rulesOf } from '../../mihomo/rules'

type NodeKind = 'rule' | 'group' | 'provider' | 'builtin' | 'hosts'

function split(id: string): { kind: NodeKind; rest: string } | null {
  const at = id.indexOf(':')
  if (at === -1) return null
  const kind = id.slice(0, at) as NodeKind
  if (!['rule', 'group', 'provider', 'builtin', 'hosts'].includes(kind)) return null
  return { kind, rest: id.slice(at + 1) }
}

/**
 * Из узла подстановки кабель не выходит и в него не входит: его содержимое
 * создаёт панель, а ребро к нему рисует граф по факту наличия маркера.
 */
export function isValidMihomoConnection(source: string, target: string): boolean {
  const from = split(source)
  const to = split(target)
  if (from === null || to === null) return false
  if (from.kind === 'hosts' || to.kind === 'hosts') return false
  if (to.kind === 'rule') return false
  if (from.kind === 'rule' || from.kind === 'group') {
    return to.kind === 'group' || to.kind === 'provider' || to.kind === 'builtin'
  }
  return false
}

function nameOf(id: string): string {
  return split(id)?.rest ?? ''
}

export function connectMihomo(md: MihomoDoc, source: string, target: string): TextEdit[] {
  if (!isValidMihomoConnection(source, target)) return []
  const from = split(source)!
  const name = nameOf(target)

  if (from.kind === 'rule') {
    const index = Number(from.rest)
    const entry = rulesOf(md).find((r) => r.index === index)
    if (entry?.rule?.target === name) return []
    return setRuleTarget(md, index, name)
  }

  const group = groupsOf(md).find((g) => g.name === from.rest)
  if (group === undefined || group.proxies.includes(name)) return []

  const section = sectionNode(md, 'proxy-groups')
  const item = isSeq(section) ? section.items[group.index] : undefined
  const pair = isMap(item)
    ? item.items.find((p) => (p.key as { value?: unknown } | null)?.value === 'proxies')
    : undefined
  const list = pair?.value
  if (!isSeq(list) || list.items.length === 0) return []

  const last = list.items[list.items.length - 1]
  const range = rangeOf(last)
  if (range === null) return []
  const lineStart = md.text.lastIndexOf('\n', range.from - 1) + 1
  const indent = md.text.slice(lineStart, range.from).replace(/-\s*$/, '')
  const lineEnd = md.text.indexOf('\n', range.to)
  const insertAt = lineEnd === -1 ? md.text.length : lineEnd + 1
  return [{ from: insertAt, to: insertAt, insert: `${indent}- ${stringify(name).trimEnd()}\n` }]
}

export function disconnectMihomo(md: MihomoDoc, edge: string): TextEdit[] {
  const match = /^e:(.+)->(.+)$/.exec(edge)
  if (match === null) return []
  const from = split(match[1]!)
  const name = nameOf(match[2]!)
  // У правила цель обязательна: разрывать нечего, вызывающий предложит сменить её
  if (from === null || from.kind !== 'group') return []

  const group = groupsOf(md).find((g) => g.name === from.rest)
  if (group === undefined) return []
  const section = sectionNode(md, 'proxy-groups')
  const item = isSeq(section) ? section.items[group.index] : undefined
  const pair = isMap(item)
    ? item.items.find((p) => (p.key as { value?: unknown } | null)?.value === 'proxies')
    : undefined
  const list = pair?.value
  if (!isSeq(list)) return []

  const entry = list.items.find((i) => (i as { value?: unknown } | null)?.value === name)
  const range = rangeOf(entry)
  if (range === null) return []
  const lineStart = md.text.lastIndexOf('\n', range.from - 1) + 1
  const lineEnd = md.text.indexOf('\n', range.to)
  return [{ from: lineStart, to: lineEnd === -1 ? md.text.length : lineEnd + 1, insert: '' }]
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Из каталога `frontend`: `npx vitest run test/mihomo-mutations.test.ts`
Ожидается: PASS, 7 тестов.

- [ ] **Step 5: Прогнать весь фронтенд и типы**

```bash
npm test -w frontend
npm run typecheck -w frontend
```

Ожидается: всё зелёное, существующие тесты Xray не тронуты.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/graph/mihomo frontend/test/mihomo-mutations.test.ts
git commit -m "feat(frontend): коммутация графа Mihomo"
```

---

### Task 8: Сохранение YAML-шаблонов на бэкенде

**Files:**
- Modify: `backend/src/remnawave/types.ts` (интерфейс `updateTemplate`)
- Modify: `backend/src/remnawave/client.ts:244-255`
- Modify: `backend/src/templates/hash.ts`
- Create: `backend/src/templates/starterMihomo.ts`
- Modify: `backend/src/routes/templates.ts`
- Test: `backend/test/templates-yaml.test.ts`

**Interfaces:**
- Consumes: `SubscriptionTemplate`, `TemplateType` из `backend/src/remnawave/types.ts`; `hashTemplateJson` из `backend/src/templates/hash.ts`.
- Produces: `hashTemplateYaml(encoded: string | null): string`; `hashTemplate(template: SubscriptionTemplate): string`; `YAML_TEMPLATE_TYPES: readonly TemplateType[]`; `STARTER_MIHOMO_TEMPLATE: string`; `updateTemplate(input: { uuid; name?; templateJson?; encodedTemplateYaml? })`.

- [ ] **Step 1: Написать падающий тест**

`backend/test/templates-yaml.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { hashTemplate, hashTemplateYaml } from '../src/templates/hash.js'
import { STARTER_MIHOMO_TEMPLATE } from '../src/templates/starterMihomo.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeStubRemnawave, makeStubTemplate } from './stub-remnawave.js'

const encode = (text: string) => Buffer.from(text, 'utf8').toString('base64')

describe('хэш по виду содержимого', () => {
  it('YAML хэшируется по тексту после декода', () => {
    expect(hashTemplateYaml(encode('a: 1\n'))).toBe(hashTemplateYaml(encode('a: 1\n')))
    expect(hashTemplateYaml(encode('a: 1\n'))).not.toBe(hashTemplateYaml(encode('a: 2\n')))
  })

  it('перестановка ключей YAML меняет хэш — текст и есть содержимое', () => {
    expect(hashTemplateYaml(encode('a: 1\nb: 2\n'))).not.toBe(hashTemplateYaml(encode('b: 2\na: 1\n')))
  })

  it('хэш шаблона выбирает способ по типу', () => {
    const yaml = {
      uuid: 'u', viewPosition: 0, name: 'n', templateType: 'MIHOMO' as const,
      templateJson: null, encodedTemplateYaml: encode('a: 1\n'),
    }
    const json = {
      uuid: 'u', viewPosition: 0, name: 'n', templateType: 'XRAY_JSON' as const,
      templateJson: { a: 1 }, encodedTemplateYaml: null,
    }
    expect(hashTemplate(yaml)).toBe(hashTemplateYaml(encode('a: 1\n')))
    expect(hashTemplate(json)).not.toBe(hashTemplate(yaml))
  })
})

describe('каркас нового шаблона Mihomo', () => {
  it('содержит обе роли маркера подстановки', () => {
    expect(STARTER_MIHOMO_TEMPLATE).toContain('proxies: # LEAVE THIS LINE!')
    expect(STARTER_MIHOMO_TEMPLATE.match(/LEAVE THIS LINE!/g)).toHaveLength(2)
  })

  it('заканчивается правилом MATCH', () => {
    expect(STARTER_MIHOMO_TEMPLATE.trimEnd().endsWith('MATCH,→ Remnawave')).toBe(true)
  })
})

describe('PATCH YAML-шаблона', () => {
  const yamlTemplate = () =>
    makeStubTemplate({
      name: 'Mihomo',
      templateType: 'MIHOMO',
      templateJson: null,
      encodedTemplateYaml: encode('a: 1\n'),
    })

  async function makeApp(templates = [yamlTemplate()]) {
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave([], templates) })
    return { app, cookie: await loginCookie(app), template: templates[0]! }
  }

  it('сохраняет encodedTemplateYaml и возвращает новый хэш', async () => {
    const { app, cookie, template } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: {
        encodedTemplateYaml: encode('a: 2\n'),
        expectedHash: hashTemplateYaml(encode('a: 1\n')),
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().hash).toBe(hashTemplateYaml(encode('a: 2\n')))
    await app.close()
  })

  it('несовпадение хэша даёт 409 с текущим содержимым', async () => {
    const { app, cookie, template } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { encodedTemplateYaml: encode('a: 2\n'), expectedHash: 'чужой' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().current.uuid).toBe(template.uuid)
    await app.close()
  })

  it('JSON-поле в YAML-шаблон не принимается', async () => {
    const { app, cookie, template } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { templateJson: { a: 2 }, expectedHash: hashTemplateYaml(encode('a: 1\n')) },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('создание с типом MIHOMO заливает YAML-каркас', async () => {
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave() })
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { cookie },
      payload: { name: 'Novyy', templateType: 'MIHOMO' },
    })
    expect(res.statusCode).toBe(201)
    const created = res.json().template
    expect(created.templateType).toBe('MIHOMO')
    expect(Buffer.from(created.encodedTemplateYaml, 'base64').toString('utf8')).toContain(
      'LEAVE THIS LINE!',
    )
    await app.close()
  })
})
```

Имя шаблона в тесте создания — латиницей: `nameSchema` зеркалит ограничение панели
(`/^[A-Za-z0-9_\s-]+$/`), кириллица там не пройдёт.

Стаб панели обязан уметь отдавать `MIHOMO`: если `makeStubRemnawave` жёстко возвращает
`templateType: 'XRAY_JSON'` при создании, поправить его так, чтобы он сохранял переданный тип, —
это часть задачи.

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `backend`: `npx vitest run test/templates-yaml.test.ts`
Ожидается: FAIL — нет `hashTemplateYaml` и `starterMihomo`.

- [ ] **Step 3: Расширить хэш**

Дописать в `backend/src/templates/hash.ts`:

```ts
import type { SubscriptionTemplate, TemplateType } from '../remnawave/types.js'

/** Типы, чьё содержимое лежит в encodedTemplateYaml, а templateJson у них null */
export const YAML_TEMPLATE_TYPES: readonly TemplateType[] = ['MIHOMO', 'CLASH', 'STASH']

/**
 * У YAML-шаблона хэшируется сам текст: канонизировать нечего — текст и есть
 * содержимое. Любая нормализация сделала бы хэш слепым к правке, которую панель
 * сохранит: перестановка ключей в YAML меняет файл, а не только его смысл.
 */
export function hashTemplateYaml(encoded: string | null): string {
  const text = encoded === null ? '' : Buffer.from(encoded, 'base64').toString('utf8')
  return createHash('sha256').update(text).digest('hex')
}

export function hashTemplate(template: SubscriptionTemplate): string {
  return YAML_TEMPLATE_TYPES.includes(template.templateType)
    ? hashTemplateYaml(template.encodedTemplateYaml)
    : hashTemplateJson(template.templateJson)
}
```

- [ ] **Step 4: Добавить каркас**

`backend/src/templates/starterMihomo.ts`:

```ts
/**
 * Каркас нового MIHOMO-шаблона. Маркер подстановки нужен в обеих ролях: на
 * корневом `proxies` панель кладёт сами серверы, в группе — их имена. Без второго
 * подписка отдаст клиенту конфиг без единого выхода.
 */
export const STARTER_MIHOMO_TEMPLATE = `mode: rule
log-level: info
ipv6: false
unified-delay: true

dns:
  enable: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - 1.1.1.1
    - 8.8.8.8

proxies: # LEAVE THIS LINE!

proxy-groups:
  - name: → Remnawave
    type: select
    proxies: # LEAVE THIS LINE!

rules:
  - MATCH,→ Remnawave
`
```

- [ ] **Step 5: Пропустить YAML через порт и клиент**

В `backend/src/remnawave/types.ts` расширить сигнатуру:

```ts
  updateTemplate(input: {
    uuid: string
    name?: string
    templateJson?: unknown
    encodedTemplateYaml?: string
  }): Promise<SubscriptionTemplate>
```

В `backend/src/remnawave/client.ts` — то же самое в объявлении метода; тело не меняется, оно
пересылает `input` как есть.

- [ ] **Step 6: Развести роуты по типу**

В `backend/src/routes/templates.ts` заменить схемы и обработчики:

```ts
const createSchema = z.object({
  name: nameSchema,
  templateType: z.enum(['XRAY_JSON', 'MIHOMO']).default('XRAY_JSON'),
})

// Ровно одно из полей содержимого: applying JSON-патч к YAML-шаблону оставил бы
// в нём мусор, а панель приняла бы это молча
const updateSchema = z.object({
  name: nameSchema.optional(),
  templateJson: z.record(z.string(), z.unknown()).optional(),
  encodedTemplateYaml: z.string().optional(),
  expectedHash: z.string().min(1),
})
```

`GET /api/templates/:uuid` отдаёт `hash: hashTemplate(template)` вместо `hashTemplateJson(...)`.

`POST /api/templates`:

```ts
    const body = createSchema.parse(req.body)
    const created = await app.remnawave.createTemplate(body.name, body.templateType)
    const template = await app.remnawave.updateTemplate(
      body.templateType === 'MIHOMO'
        ? {
            uuid: created.uuid,
            encodedTemplateYaml: Buffer.from(STARTER_MIHOMO_TEMPLATE, 'utf8').toString('base64'),
          }
        : { uuid: created.uuid, templateJson: STARTER_XRAY_TEMPLATE },
    )
```

`PATCH /api/templates/:uuid` — вместо запрета на не-`XRAY_JSON`:

```ts
    const isYaml = YAML_TEMPLATE_TYPES.includes(current.templateType)
    if (isYaml && body.encodedTemplateYaml === undefined) {
      return reply.status(400).send({
        message: `Шаблон ${current.templateType} хранит содержимое в YAML — нужен encodedTemplateYaml`,
      })
    }
    if (!isYaml && body.templateJson === undefined) {
      return reply.status(400).send({
        message: `Шаблон ${current.templateType} хранит содержимое в JSON — нужен templateJson`,
      })
    }
    if (current.templateType === 'XRAY_BASE64' || current.templateType === 'SINGBOX') {
      return reply.status(400).send({
        message: `Редактор пока не умеет шаблоны ${current.templateType}`,
      })
    }
    if (hashTemplate(current) !== body.expectedHash) {
      return reply.status(409).send({
        message: 'Шаблон был изменён в панели после открытия',
        current,
        hash: hashTemplate(current),
      })
    }
    await app.backups.saveTemplateBackup(current)
    const template = await app.remnawave.updateTemplate({
      uuid,
      name: body.name,
      ...(isYaml
        ? { encodedTemplateYaml: body.encodedTemplateYaml }
        : { templateJson: body.templateJson }),
    })
    return { template, hash: hashTemplate(template) }
```

- [ ] **Step 7: Убедиться, что тесты проходят**

Из каталога `backend`: `npx vitest run test/templates-yaml.test.ts test/templates.test.ts`
Ожидается: PASS; старые тесты шаблонов не изменены.

- [ ] **Step 8: Коммит**

```bash
git add backend/src backend/test/templates-yaml.test.ts
git commit -m "feat(backend): сохранение YAML-шаблонов и хэш по виду содержимого"
```

---

### Task 9: Каталог шаблонов

**Files:**
- Create: `backend/src/catalog/service.ts`
- Create: `backend/src/routes/catalog.ts`
- Modify: `backend/src/server.ts` (декоратор и регистрация)
- Test: `backend/test/catalog.test.ts`

**Interfaces:**
- Consumes: `fetchExternal`, `FetchGuardOptions` из `backend/src/net/guard.ts`.
- Produces: `CatalogEntry = { name: string; type: string; author: string; url: string }`; `CatalogService` с `list(): Promise<CatalogEntry[]>` и `fetchTemplate(url: string): Promise<string>`; `catalogRoutes: FastifyPluginAsync`; `app.catalog: CatalogService`; `ServerDeps.catalog?: CatalogService`.

- [ ] **Step 1: Написать падающий тест**

`backend/test/catalog.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { CatalogService, CATALOG_URL } from '../src/catalog/service.js'

const index = JSON.stringify({
  templates: [
    { name: 'Default Mihomo', type: 'MIHOMO', author: 'remnawave', url: 'https://raw.githubusercontent.com/remnawave/templates/main/a.yaml' },
    { name: 'Legacy', type: 'SINGBOX_LEGACY', author: 'remnawave', url: 'https://raw.githubusercontent.com/remnawave/templates/main/b.json' },
  ],
})

function stub(responses: Record<string, string>) {
  return vi.fn(async (url: string) => {
    const body = responses[url]
    if (body === undefined) throw new Error(`неожиданный запрос: ${url}`)
    return new Response(body, { status: 200 })
  })
}

describe('каталог шаблонов', () => {
  it('читает индекс и отдаёт записи как есть, включая незнакомый тип', async () => {
    const fetchImpl = stub({ [CATALOG_URL]: index })
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never })
    const list = await catalog.list()
    expect(list).toHaveLength(2)
    expect(list[1]!.type).toBe('SINGBOX_LEGACY')
  })

  it('индекс кэшируется на час', async () => {
    const fetchImpl = stub({ [CATALOG_URL]: index })
    let now = 0
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never }, () => now)
    await catalog.list()
    await catalog.list()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    now = 3_600_001
    await catalog.list()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('содержимое отдаётся только по ссылке из индекса', async () => {
    const url = 'https://raw.githubusercontent.com/remnawave/templates/main/a.yaml'
    const fetchImpl = stub({ [CATALOG_URL]: index, [url]: 'proxies: # LEAVE THIS LINE!\n' })
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never })
    await expect(catalog.fetchTemplate(url)).resolves.toContain('LEAVE THIS LINE')
  })

  it('чужая ссылка отклоняется, даже если хост разрешён', async () => {
    const fetchImpl = stub({ [CATALOG_URL]: index })
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never })
    await expect(
      catalog.fetchTemplate('https://raw.githubusercontent.com/чужой/репозиторий/x.yaml'),
    ).rejects.toThrow(/каталог/i)
  })

  it('недоступность GitHub — понятная ошибка, а не падение', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }))
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never })
    await expect(catalog.list()).rejects.toThrow(/каталог шаблонов недоступен/i)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `backend`: `npx vitest run test/catalog.test.ts`
Ожидается: FAIL — модуля `catalog/service` нет.

- [ ] **Step 3: Реализовать сервис**

`backend/src/catalog/service.ts`:

```ts
// Каталог готовых шаблонов из официального репозитория remnawave/templates.
// Наружу ходим только через fetchExternal: приватные адреса и редиректы на чужие
// хосты guard отсекает сам.

import { fetchExternal, type FetchGuardOptions } from '../net/guard.js'

export const CATALOG_URL =
  'https://raw.githubusercontent.com/remnawave/templates/main/subscription-templates-list.json'

const ALLOWED_HOST = 'raw.githubusercontent.com'
const CACHE_TTL_MS = 3_600_000

export interface CatalogEntry {
  name: string
  /** Тип шаблона панели; каталог опережает контракт, незнакомые значения проходят как есть */
  type: string
  author: string
  url: string
}

export class CatalogService {
  private cache: { at: number; entries: CatalogEntry[] } | null = null

  constructor(
    private net: FetchGuardOptions = {},
    private now: () => number = () => Date.now(),
  ) {}

  async list(): Promise<CatalogEntry[]> {
    const cached = this.cache
    if (cached !== null && this.now() - cached.at < CACHE_TTL_MS) return cached.entries

    const res = await fetchExternal(CATALOG_URL, this.net)
    if (!res.ok) {
      throw new Error(`Каталог шаблонов недоступен: GitHub ответил ${res.status}`)
    }
    const parsed = JSON.parse(await res.text()) as { templates?: unknown }
    const entries = Array.isArray(parsed.templates)
      ? parsed.templates.filter(isEntry)
      : []
    this.cache = { at: this.now(), entries }
    return entries
  }

  /** Ссылку принимаем только из индекса: произвольный url от клиента — дыра в SSRF-защите */
  async fetchTemplate(url: string): Promise<string> {
    const entries = await this.list()
    if (!entries.some((e) => e.url === url)) {
      throw new Error('Эта ссылка не из каталога шаблонов')
    }
    if (new URL(url).hostname !== ALLOWED_HOST) {
      throw new Error('Эта ссылка не из каталога шаблонов')
    }
    const res = await fetchExternal(url, this.net)
    if (!res.ok) throw new Error(`Шаблон не скачался: GitHub ответил ${res.status}`)
    return res.text()
  }
}

function isEntry(value: unknown): value is CatalogEntry {
  const e = value as Partial<CatalogEntry> | null
  return (
    typeof e?.name === 'string' &&
    typeof e.type === 'string' &&
    typeof e.author === 'string' &&
    typeof e.url === 'string'
  )
}
```

- [ ] **Step 4: Добавить роуты и проводку**

`backend/src/routes/catalog.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const querySchema = z.object({ url: z.string().url() })

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/catalog/templates', async (_req, reply) => {
    try {
      return { templates: await app.catalog.list() }
    } catch (error) {
      // 502, а не 500: недоступен внешний источник, а не наш сервер
      return reply.status(502).send({ message: (error as Error).message })
    }
  })

  app.get('/api/catalog/template', async (req, reply) => {
    const { url } = querySchema.parse(req.query)
    try {
      return { content: await app.catalog.fetchTemplate(url) }
    } catch (error) {
      return reply.status(502).send({ message: (error as Error).message })
    }
  })
}
```

В `backend/src/server.ts`: добавить `catalog: CatalogService` в объявление `FastifyInstance`,
`catalog?: CatalogService` в `ServerDeps`, рядом с прочими декораторами —

```ts
  app.decorate(
    'catalog',
    deps.catalog ?? new CatalogService({ allowPrivate: config.geoAllowPrivateUrls }),
  )
```

и `await app.register(catalogRoutes)` рядом с `backupRoutes`.

- [ ] **Step 5: Убедиться, что тесты проходят**

Из каталога `backend`: `npx vitest run test/catalog.test.ts && npx vitest run`
Ожидается: PASS во всём бэкенде.

- [ ] **Step 6: Коммит**

```bash
git add backend/src backend/test/catalog.test.ts
git commit -m "feat(backend): каталог готовых шаблонов подписки"
```

---

### Task 10: Проверка шаблона ядром Mihomo

**Files:**
- Create: `backend/src/proc/spawn.ts`
- Modify: `backend/src/xray/service.ts` (импорт вместо своей копии `runProcess`)
- Create: `backend/src/mihomo/dummyProxies.ts`
- Create: `backend/src/mihomo/parseOutput.ts`
- Create: `backend/src/mihomo/service.ts`
- Modify: `backend/src/config.ts`, `backend/src/server.ts`, `backend/src/routes/tools.ts`
- Modify: `Dockerfile`, `.env.example`
- Test: `backend/test/mihomo-test.test.ts`
- Modify: `backend/package.json` (зависимость `yaml`)

**Interfaces:**
- Consumes: `SpawnRunner`, `SpawnOutcome` (переезжают в `proc/spawn.ts` с теми же полями: `SpawnOutcome = { code: number | null; output: string; error?: NodeJS.ErrnoException }`).
- Produces: `withDummyProxies(yamlText: string): string`; `MihomoTestResult = { available: boolean; ok: boolean; errors: string[] }`; `MihomoService` с `test(yamlText: string): Promise<MihomoTestResult>`; `app.mihomo: MihomoService`; `POST /api/tools/mihomo-test`; `AppConfig.mihomoBin`.

- [ ] **Step 1: Написать падающий тест**

`backend/test/mihomo-test.test.ts`:

```ts
import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'
import { withDummyProxies } from '../src/mihomo/dummyProxies.js'
import { MihomoService } from '../src/mihomo/service.js'
import type { SpawnRunner } from '../src/proc/spawn.js'

const TEMPLATE = `proxies: # LEAVE THIS LINE!

proxy-groups:
  - name: VPN
    type: select
    proxies: # LEAVE THIS LINE!

rules:
  - MATCH,VPN
`

describe('подстановка фиктивных прокси', () => {
  it('заполняет корневой список и группы с маркером', () => {
    const config = parse(withDummyProxies(TEMPLATE)) as {
      proxies: { name: string }[]
      'proxy-groups': { name: string; proxies: string[] }[]
    }
    expect(config.proxies.length).toBeGreaterThan(0)
    expect(config['proxy-groups'][0]!.proxies).toContain(config.proxies[0]!.name)
  })

  it('заполняет payload inline-провайдеров — пустой ядро не примет', () => {
    const text = 'proxy-providers:\n  ru:\n    type: inline\n    payload:\nrules:\n  - MATCH,DIRECT\n'
    const config = parse(withDummyProxies(text)) as {
      'proxy-providers': Record<string, { payload: unknown[] }>
    }
    expect(config['proxy-providers'].ru!.payload.length).toBeGreaterThan(0)
  })

  it('группу с include-proxies: false не трогает', () => {
    const text =
      'proxy-groups:\n  - name: a\n    remnawave:\n      include-proxies: false\n    proxies:\n      - DIRECT\nrules:\n  - MATCH,a\n'
    const config = parse(withDummyProxies(text)) as { 'proxy-groups': { proxies: string[] }[] }
    expect(config['proxy-groups'][0]!.proxies).toEqual(['DIRECT'])
  })

  it('ключи remnawave снимаются — ядро о них не знает', () => {
    const config = parse(withDummyProxies('remnawave:\n  includeHiddenHosts: false\nrules:\n  - MATCH,DIRECT\n')) as Record<string, unknown>
    expect(config.remnawave).toBeUndefined()
  })
})

describe('проверка ядром', () => {
  const run = (outcome: Awaited<ReturnType<SpawnRunner>>): SpawnRunner => vi.fn(async () => outcome)

  it('нет бинаря — инструмент недоступен, а не ошибка', async () => {
    const error = Object.assign(new Error('нет файла'), { code: 'ENOENT' })
    const service = new MihomoService('mihomo', '/tmp', run({ code: null, output: '', error }))
    const res = await service.test(TEMPLATE)
    expect(res).toEqual({ available: false, ok: false, errors: [] })
  })

  it('нулевой код возврата — конфиг принят', async () => {
    const service = new MihomoService('mihomo', '/tmp', run({ code: 0, output: 'test is successful' }))
    const res = await service.test(TEMPLATE)
    expect(res.ok).toBe(true)
    expect(res.available).toBe(true)
  })

  it('ненулевой код — строки вывода становятся ошибками', async () => {
    const service = new MihomoService(
      'mihomo', '/tmp',
      run({ code: 1, output: 'level=error msg="proxy 0: unsupport proxy type"\n' }),
    )
    const res = await service.test(TEMPLATE)
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toContain('unsupport proxy type')
  })

  it('ядро получает файл с подставленными прокси, а не исходный шаблон', async () => {
    const runner = vi.fn(async () => ({ code: 0, output: 'ok' }))
    const service = new MihomoService('mihomo', '/tmp', runner as unknown as SpawnRunner)
    await service.test(TEMPLATE)
    const args = runner.mock.calls[0]![1] as string[]
    expect(args).toContain('-t')
    expect(args).toContain('-f')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `backend`: `npx vitest run test/mihomo-test.test.ts`
Ожидается: FAIL — модулей нет.

- [ ] **Step 3: Вынести запуск процесса**

Создать `backend/src/proc/spawn.ts`, перенеся из `backend/src/xray/service.ts` без изменения
поведения интерфейсы `SpawnOutcome`, `SpawnRunner` и константу-реализацию `runProcess`
(строки с 25 по 52 исходного файла). В `xray/service.ts` заменить их на импорт:

```ts
import { runProcess, type SpawnRunner } from '../proc/spawn.js'
```

и оставить реэкспорт `export type { SpawnRunner, SpawnOutcome } from '../proc/spawn.js'`, чтобы
существующие тесты Xray продолжали импортировать типы оттуда же, откуда импортировали.

- [ ] **Step 4: Поставить зависимость и написать подстановку**

```bash
npm i yaml@^2.9.0 -w backend
```

`backend/src/mihomo/dummyProxies.ts`:

```ts
// Ядро отвергнет корректный шаблон: proxies пуст, а группы ссылаются на имена,
// которых ещё нет — их подставит панель. Перед проверкой кладём фиктивные
// серверы, как xray/dummyClient.ts кладёт фиктивного пользователя.
//
// ЕДИНСТВЕННОЕ место во всём проекте, где YAML печатается из модели: результат
// уходит во временный файл для ядра и тут же удаляется, пользовательский
// документ он не заменяет.

import { parse, stringify } from 'yaml'

const MARKER = 'LEAVE THIS LINE!'

/** Фиксированные значения: вердикт проверки не должен зависеть от случайности */
const DUMMY = [
  { name: 'mihomo-dummy-1', type: 'socks5', server: '127.0.0.1', port: 1080 },
  { name: 'mihomo-dummy-2', type: 'socks5', server: '127.0.0.1', port: 1081 },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function withDummyProxies(yamlText: string): string {
  const marked = yamlText.includes(MARKER)
  const config = parse(yamlText) as unknown
  if (!isRecord(config)) return yamlText

  delete config.remnawave
  config.proxies = [...DUMMY]
  const names = DUMMY.map((p) => p.name)

  const groups = config['proxy-groups']
  if (Array.isArray(groups)) {
    for (const group of groups) {
      if (!isRecord(group)) continue
      const remnawave = isRecord(group.remnawave) ? group.remnawave : undefined
      delete group.remnawave
      if (remnawave?.['include-proxies'] === false) continue
      const proxies = Array.isArray(group.proxies) ? group.proxies : []
      // Пустая группа ядру не нравится, поэтому имена добавляем и тем, у кого
      // маркер стоял, и тем, кто остался бы вовсе без кандидатов
      if (marked || proxies.length === 0) group.proxies = [...proxies, ...names]
    }
  }

  const providers = config['proxy-providers']
  if (isRecord(providers)) {
    for (const provider of Object.values(providers)) {
      if (!isRecord(provider)) continue
      delete provider.remnawave
      if (provider.type !== 'inline') continue
      const payload = Array.isArray(provider.payload) ? provider.payload : []
      if (payload.length === 0) provider.payload = [...DUMMY]
    }
  }

  return stringify(config)
}
```

- [ ] **Step 5: Написать разбор вывода и сервис**

`backend/src/mihomo/parseOutput.ts`:

```ts
/**
 * Формат вывода `mihomo -t` версии не фиксирован, поэтому вердикт берём по коду
 * возврата, а из текста достаём только содержательные строки. Выдумывать разбор
 * по конкретным фразам ядра нельзя: обновление ядра сделало бы проверку слепой.
 */
export function parseMihomoOutput(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.replace(/^time="[^"]*"\s*/, ''))
}
```

`backend/src/mihomo/service.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess, type SpawnRunner } from '../proc/spawn.js'
import { withDummyProxies } from './dummyProxies.js'
import { parseMihomoOutput } from './parseOutput.js'

export interface MihomoTestResult {
  /** false — бинаря нет; UI показывает «инструмент недоступен», а не ошибку */
  available: boolean
  ok: boolean
  errors: string[]
}

const TIMEOUT_MS = 10_000

export class MihomoService {
  constructor(
    private bin: string,
    private dataDir: string,
    private run: SpawnRunner = runProcess,
  ) {}

  async test(yamlText: string): Promise<MihomoTestResult> {
    const dir = join(this.dataDir, 'tmp')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `mihomo-test-${randomUUID()}.yaml`)
    await writeFile(file, withDummyProxies(yamlText), 'utf8')

    try {
      const res = await this.run(this.bin, ['-t', '-f', file], {
        env: process.env as Record<string, string>,
        timeoutMs: TIMEOUT_MS,
      })
      if (res.error?.code === 'ENOENT') return { available: false, ok: false, errors: [] }
      if (res.error) return { available: true, ok: false, errors: [res.error.message] }
      if (res.code === 0) return { available: true, ok: true, errors: [] }
      const errors = parseMihomoOutput(res.output)
      return {
        available: true,
        ok: false,
        errors: errors.length > 0 ? errors : ['Ядро отклонило шаблон без объяснения'],
      }
    } finally {
      await rm(file, { force: true })
    }
  }
}
```

- [ ] **Step 6: Проводка, окружение и образ**

В `backend/src/config.ts`: в `envSchema` добавить

```ts
  // Путь к ядру Mihomo для проверки шаблона подписки. Не найдено — проверка
  // отдаёт available: false, редактор продолжает работать.
  MIHOMO_BIN: z.string().min(1).default('mihomo'),
```

в `AppConfig` — `mihomoBin: string`, в возврате `loadConfig` — `mihomoBin: e.MIHOMO_BIN`.

В `backend/src/server.ts` — `mihomo: MihomoService` в объявлении `FastifyInstance`,
`mihomo?: MihomoService` в `ServerDeps` и

```ts
  app.decorate('mihomo', deps.mihomo ?? new MihomoService(config.mihomoBin, config.dataDir))
```

В `backend/src/routes/tools.ts` рядом с `/api/tools/xray-test`:

```ts
  const mihomoSchema = z.object({ encodedTemplateYaml: z.string() })

  app.post('/api/tools/mihomo-test', async (req) => {
    const { encodedTemplateYaml } = mihomoSchema.parse(req.body)
    return app.mihomo.test(Buffer.from(encodedTemplateYaml, 'base64').toString('utf8'))
  })
```

В `.env.example` после строки `XRAY_BIN=xray`:

```
# Ядро Mihomo для проверки шаблонов подписки. Нет бинаря — проверка недоступна,
# остальной редактор работает.
MIHOMO_BIN=mihomo
```

В `Dockerfile` — стадия рядом с существующей `FROM alpine:3.24 AS xray`, тем же приёмом
(закреплённая версия, проверка sha256, распаковка в `/usr/local/bin`):

```dockerfile
# Ядро Mihomo для проверки шаблонов подписки (`mihomo -t -f`). Приём тот же, что
# у стадии xray: закреплённая версия и контрольная сумма, архитектура — от buildx.
FROM alpine:3.24 AS mihomo
ARG TARGETARCH
ARG MIHOMO_VERSION=v1.19.30
ARG MIHOMO_SHA256_AMD64=cf06ce2c7d1421bdbda14ee4a5b6046672dc35ebf8eecd8e77504ec3c0ed9a84
ARG MIHOMO_SHA256_ARM64=58896873736d28628f66de3677c8654fa0f180662523148e136cff4f6e890069
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) asset="mihomo-linux-amd64-${MIHOMO_VERSION}.gz"; sha="$MIHOMO_SHA256_AMD64" ;; \
      arm64) asset="mihomo-linux-arm64-${MIHOMO_VERSION}.gz"; sha="$MIHOMO_SHA256_ARM64" ;; \
      *) echo "неподдерживаемая архитектура: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    apk add --no-cache curl; \
    curl -fsSL -o /tmp/mihomo.gz \
      "https://github.com/MetaCubeX/mihomo/releases/download/${MIHOMO_VERSION}/${asset}"; \
    echo "${sha}  /tmp/mihomo.gz" | sha256sum -c -; \
    gunzip -c /tmp/mihomo.gz > /usr/local/bin/mihomo; \
    chmod +x /usr/local/bin/mihomo; \
    rm /tmp/mihomo.gz
```

и в финальной стадии, рядом со строками про `xray`:

```dockerfile
ENV MIHOMO_BIN=/usr/local/bin/mihomo
COPY --from=mihomo /usr/local/bin/mihomo /usr/local/bin/mihomo
```

Суммы посчитаны по релизу `v1.19.30` от файлов `mihomo-linux-amd64-v1.19.30.gz` и
`mihomo-linux-arm64-v1.19.30.gz`. При смене версии двигать все три `ARG` вместе: рассинхрон
версии и суммы валит сборку на `sha256sum -c` — это и есть цель проверки.

- [ ] **Step 7: Убедиться, что тесты проходят**

Из каталога `backend`: `npx vitest run test/mihomo-test.test.ts && npx vitest run`
Ожидается: PASS, существующие тесты Xray и конфигурации не тронуты.

- [ ] **Step 8: Проверить сборку образа**

```bash
docker compose -f docker-compose.build.yml build
```

Ожидается: сборка проходит, стадия `mihomo` не падает на `sha256sum -c`.

- [ ] **Step 9: Коммит**

```bash
git add backend/src backend/package.json package-lock.json backend/test/mihomo-test.test.ts Dockerfile .env.example
git commit -m "feat(backend): проверка шаблона Mihomo ядром"
```

---

### Task 11: Документация и полный прогон

**Files:**
- Modify: `CLAUDE.md`
- Test: полный прогон обоих workspace

- [ ] **Step 1: Дописать раздел в CLAUDE.md**

В раздел «Особенности домена» добавить:

```markdown
- **Шаблоны Mihomo** (`templateType: MIHOMO`, содержимое в `encodedTemplateYaml`) устроены иначе,
  чем `XRAY_JSON`: источником истины является ТЕКСТ YAML, а модель (`entities/mihomo`) — производная
  и обратно не печатается. Причина не в чистоплюйстве: место подстановки хостов панель ищет по
  КОММЕНТАРИЮ `# LEAVE THIS LINE!`, а живые шаблоны построены на якорях и `<<:`-слияниях — круг
  через объект стирает маркеры (подписка перестаёт отдавать серверы) и раздувает файл втрое.
  Поэтому правки идут сплайсами по `node.range` (`entities/mihomo/edits.ts`), а `doc.toString()`
  во фронтенде запрещён. Единственное исключение — `backend/src/mihomo/dummyProxies.ts`: его
  результат уходит во временный файл для `mihomo -t` и удаляется.
- Имена подставленных панелью хостов у Mihomo НЕ предсказуемы вообще (у Xray была схема
  `tagPrefix`): их даёт панель из примечаний хоста. Поэтому «ссылка на неизвестное имя» —
  предупреждение, а не ошибка, а отсутствие корневого маркера `proxies:` не считается ошибкой
  вовсе: в `by-legiz/mihomo-simple-without-ru.yaml` из официального репозитория его нет.
```

В раздел «Backend» добавить строку про каталог:

```markdown
- `catalog/service.ts` — каталог готовых шаблонов из `remnawave/templates`. Ссылку на содержимое
  принимаем только ту, что пришла в индексе: произвольный `url` от клиента — дыра в SSRF-защите,
  которую `net/guard.ts` уже закрывает по хостам, но не по назначению.
```

- [ ] **Step 2: Полный прогон**

```bash
npm test
npm run typecheck -w backend
npm run typecheck -w frontend
npm run e2e -w frontend
```

Ожидается: всё зелёное. Тесты редакторов Xray не изменены ни в одной строке.

- [ ] **Step 3: Коммит**

```bash
git add CLAUDE.md
git commit -m "docs: текст как источник истины у шаблонов Mihomo"
```
