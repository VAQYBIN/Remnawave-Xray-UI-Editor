# План 4 «Протоколы + DNS + валидация»: полнота inbound/outbound-форм, hysteria2, DnsForm, расширенный analyzeIntegrity, e2e

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть оставшееся из спеки «полное UI-покрытие Xray»: протоколы inbound целиком (vless `fallbacks`+`decryption`, trojan `fallbacks`, shadowsocks `network`, новый hysteria2, полный sniffing), протоколы outbound целиком (vless `vnext`, socks/http `servers`, freedom `redirect`+`fragment`, blackhole `response`, wireguard с несколькими peers/`reserved`/`preSharedKey`/`keepAlive`/`domainStrategy`, `mux`+`sendThrough`), форма DNS для dns-узла графа, расширенный `analyzeIntegrity` (матрица security×network, flow×network, hysteria-сертификаты, висячие `dialerProxy`/`balancerTag`, домены-keyword, битые порты правил) и сводные Playwright e2e-сценарии.

**Architecture:** Четыре слоя работ. (1) `entities/xray/rules.ts` — новый чистый модуль: `DOMAIN_PREFIXES`/`keywordEntries`/`portSpecError` ПЕРЕЕЗЖАЮТ сюда из `features/inspector/RuleForm.tsx` (реэкспорт из RuleForm сохраняет старые импорты) — это обязательный первый шаг, иначе `analyzeIntegrity` в entities импортировал бы из features (слоевое нарушение). (2) `entities/xray/config.ts` — `analyzeIntegrity` расширяется, переиспользуя готовые чистые функции: `securityNetworkIssue`/`flowNetworkIssue`/`hysteriaCertificateIssue` из `compat.ts` (план 3) и `portSpecError`/`keywordEntries` из нового `rules.ts` (план 2); вывод попадает в существующий `IssueList` автоматически — `EditorPage` уже рендерит `validateXrayConfig(text).issues`, дополнительной проводки не нужно. (3) `features/inspector` — InboundForm/OutboundForm расширяются по текущим паттернам (patch через `structuredClone`, `ListEditor` для повторяемых карточек, `CollapsibleSection` для «Продвинутых»); заглушки «редактируется в JSON» у socks/http/vless заменяются формами; новый `DnsForm` подключается в `NodeInspector` через новый kind `dns` (dns-узел адресуется в mutations по nodeId `'dns'`: `getNodeJson` возвращает `config.dns` целиком, `applyNodeJson` кладёт объект обратно — форма получает и пишет весь объект dns, менять mutations/buildGraph не нужно). (4) `frontend/e2e/forms.spec.ts` — 4 сводных сценария в стиле существующих e2e (мок API через `e2e/mocks.ts`, dev-сервер 127.0.0.1:4173).

**Tech Stack:** React 19, vitest (jsdom) + @testing-library/react + userEvent, Playwright, zod v3. Схемы плана 1 уже полные и НЕ меняются: `FallbackSchema`, `HysteriaInboundSettingsSchema`, `ShadowsocksInboundSettingsSchema.network`, `SniffingSchema`, `VlessVnextSchema`/`VlessOutboundUserSchema`, `ProxyServerSchema`, `FreedomFragmentSchema`, `BlackholeOutboundSettingsSchema.response`, `WireguardPeerSchema`/`reserved`, `MuxSchema`/`sendThrough`, `DnsServerObjectSchema`/`DnsSchema`, `RoutingRuleSchema.balancerTag`. Примитивы: `TextField`, `PortField`, `NumberField`, `SelectField`, `StringListField`, `TagListField`, `CheckboxField`, `MultiSelectField` (`fields.tsx`), `KeyValueField`, `ListEditor` (`collections.tsx`), `CollapsibleSection` (`shared/ui`). Новых примитивов и npm-зависимостей нет.

**Спека:** `docs/superpowers/specs/2026-07-22-full-xray-ui-coverage-design.md` — секции 5 (протоколы), 6 (DNS), 7 (валидация), 8 (тестирование).

## Global Constraints

- Язык UI-текстов и подсказок — русский; коммиты — английский conventional style с трейлером `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Слоевая чистота:** `entities` НЕ импортирует из `features`. Перенос `portSpecError`/`keywordEntries`/`DOMAIN_PREFIXES` в `entities/xray/rules.ts` — Task 1, ДО расширения `analyzeIntegrity`. RuleForm реэкспортирует их из entities — существующие импорты (`test/rule-form.test.tsx`) остаются зелёными без правок.
- **Схемы `entities/xray` НЕ меняются** — все поля уже добавлены планом 1. Новый файл в entities только один: `rules.ts` (+ строка реэкспорта в `index.ts`).
- **Уровни новых integrity-проверок (решение зафиксировано):** матрица security×network, flow×network, hysteria-без-сертификата, битый формат порта правила — `error` (такой конфиг ядро Xray не запустит, `error` сознательно блокирует кнопку «Сохранить в панель» через существующий `hasErrors`); висячие `dialerProxy`/`balancerTag` — `warning` (сознательное отклонение от спеки: ВСЕ висячие ссылки в проекте — warnings, диалог удаления узла обещает «ссылки будут подсвечены как предупреждения», и удаление outbound не должно блокировать сохранение); домены-keyword — `warning` (по спеке).
- patch-паттерн всех форм: `structuredClone(value)` + точечная мутация; `undefined` → `delete` ключа; опустевшая вложенная секция (`fragment`, `mux`, `sniffing`-поля не в счёт — `sniffing` хранит `enabled: false` явно) удаляется целиком; boolean `false` → `undefined` (зашито в `CheckboxField`); пустые списки → `undefined` (зашито в `StringListField`/`MultiSelectField`/`KeyValueField`/`ListEditor`).
- Mount-only поля (`StringListField`, `PortField`, `KeyValueField`) внутри карточек `ListEditor` требуют `key`, включающий индекс И длину списка (`key={\`x:${i}:${total}\`}`) — удаление карточки сдвигает индексы, remount перечитывает буферы (паттерн certificates из плана 3). Для wireguard `AllowedIPs` в key дополнительно входит `warpFillCount` (заливка WARP-шаблона).
- Смена протокола чистит `settings` шаблоном (существующее поведение InboundForm/OutboundForm — сохранить). hysteria2 inbound: шаблон `{ version: 2 }`, поле version в форме НЕ редактируется; клиентов инжектит панель (формы клиентов нет, как у trojan). vless outbound `vnext`: UUID может инжектить панель — поле id опционально с подсказкой, форму не форсировать.
- `NumberField` и `TagListField` не имеют пропа `hint` — подсказки к ним не добавлять (описательный label или `<p className="muted">`).
- CSS: только существующие токены/классы (`field-hint`/`field-warning`/`field-error`/`multi-chip`/`list-editor`/`kv-row`/`collapsible`, токены `--bg/--surface/--border/--muted/--in/--out/--danger/--ok`). `--accent` не существует. Новых классов не требуется.
- Юнит-тесты — vitest (jsdom), запуск из каталога `frontend`: `npx vitest run test/<файл>`. Тесты компонентов со StreamForm внутри (InboundForm/OutboundForm/NodeInspector) уже обёрнуты в `QueryClientProvider` (`wrap(...)`) — план 3; `DnsForm` react-query не использует, обёртка не нужна.
- e2e (`frontend/e2e/*.spec.ts`) не входит в tsconfig фронтенда — `tsc --noEmit` их не проверяет. Запуск: `npm run e2e -w frontend` (перед первым запуском: `cd frontend && npx playwright install chromium`). Прогон e2e — отдельный опциональный шаг финальной задачи.
- Два существующих теста меняются ОСОЗНАННО (семантика меняется по спеке): `node-inspector.test.tsx` «для dns узла вкладок нет — сразу JSON» (dns получает форму) и `outbound-form.test.tsx` «для socks показывает подсказку про JSON» (заглушка заменяется формой). Остальные существующие тесты не переписываются — только дополняются, `StatefulOutboundForm` получает опциональный проп `onChange` (аддитивно).

---

### Task 1: Перенос `portSpecError`/`keywordEntries` в `entities/xray/rules.ts`

**Files:**
- Create: `frontend/src/entities/xray/rules.ts`
- Modify: `frontend/src/entities/xray/index.ts`
- Modify: `frontend/src/features/inspector/RuleForm.tsx`
- Test: `frontend/test/xray-rules.test.ts` (создать)
- Regress: `frontend/test/rule-form.test.tsx` (НЕ менять — должен остаться зелёным)

**Interfaces:**
- Produces (реэкспорт через `entities/xray/index.ts`): `DOMAIN_PREFIXES: string[]`, `keywordEntries(items: string[] | undefined): string[]`, `portSpecError(value: string | number | undefined): string | null` — код переносится ДОСЛОВНО из RuleForm.tsx (строки с `DOMAIN_PREFIXES` по конец `portSpecError`).
- RuleForm импортирует их из `../../entities/xray` и реэкспортирует под старыми именами — `test/rule-form.test.tsx` (импортирует из RuleForm) остаётся зелёным без правок.
- Task 2 подключает их к `analyzeIntegrity`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/xray-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DOMAIN_PREFIXES, keywordEntries, portSpecError } from '../src/entities/xray'

describe('entities/xray/rules — portSpecError', () => {
  it('валидные форматы — null', () => {
    expect(portSpecError(undefined)).toBeNull()
    expect(portSpecError(443)).toBeNull()
    expect(portSpecError('1000-2000')).toBeNull()
    expect(portSpecError('443,1000-2000,8443')).toBeNull()
  })

  it('битые форматы — русское сообщение', () => {
    expect(portSpecError('70000')).toMatch(/вне диапазона/)
    expect(portSpecError('2000-1000')).toMatch(/больше конца/)
    expect(portSpecError('abc')).toMatch(/Некорректный формат/)
    expect(portSpecError('443,,80')).toMatch(/Пустой элемент/)
  })
})

describe('entities/xray/rules — keywordEntries', () => {
  it('возвращает только записи без известных префиксов', () => {
    expect(keywordEntries(['geosite:openai', 'domain:a.com', 'example', 'full:b.com'])).toEqual(['example'])
    expect(keywordEntries(undefined)).toEqual([])
  })

  it('DOMAIN_PREFIXES содержит основные префиксы матчеров', () => {
    expect(DOMAIN_PREFIXES).toContain('geosite:')
    expect(DOMAIN_PREFIXES).toContain('regexp:')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/xray-rules.test.ts`
Ожидание: FAIL — имена не экспортируются из `../src/entities/xray`.

- [ ] **Step 3: Реализация**

Создать `frontend/src/entities/xray/rules.ts` (код перенесён дословно из RuleForm.tsx):

```ts
// Чистая логика правил маршрутизации. Живёт в entities (не в RuleForm),
// чтобы analyzeIntegrity мог переиспользовать её без слоевого нарушения:
// entities не импортирует из features.

// Известные префиксы доменных матчеров Xray; строка без префикса матчится как keyword-подстрока
export const DOMAIN_PREFIXES = ['domain:', 'full:', 'regexp:', 'geosite:', 'keyword:', 'ext:']

export function keywordEntries(items: string[] | undefined): string[] {
  return (items ?? []).filter((s) => !DOMAIN_PREFIXES.some((p) => s.startsWith(p)))
}

// Формат port/sourcePort правила: «443», «1000-2000» или их список через запятую
export function portSpecError(value: string | number | undefined): string | null {
  if (value === undefined) return null
  for (const part of String(value).split(',').map((s) => s.trim())) {
    if (part === '') return 'Пустой элемент в списке портов'
    const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(part)
    if (!m) return `Некорректный формат «${part}» — ожидается 443, 1000-2000 или их список через запятую`
    const lo = Number(m[1])
    const hi = m[2] === undefined ? lo : Number(m[2])
    if (lo < 1 || hi > 65535) return `Порт вне диапазона 1–65535: «${part}»`
    if (lo > hi) return `Начало диапазона больше конца: «${part}»`
  }
  return null
}
```

В `frontend/src/entities/xray/index.ts` добавить после строки `export * from './compat'`:

```ts
export * from './rules'
```

В `frontend/src/features/inspector/RuleForm.tsx`:

1. Добавить в импорты (первой строкой файла, перед импортом `CollapsibleSection`):

```tsx
import { keywordEntries, portSpecError } from '../../entities/xray'
```

2. Заменить блок от комментария `// Известные префиксы доменных матчеров Xray...` до конца функции `portSpecError` (строки с `export const DOMAIN_PREFIXES = ...` по закрывающую `}` c `return null` включительно) на:

```tsx
// Чистая логика (DOMAIN_PREFIXES/keywordEntries/portSpecError) переехала в
// entities/xray/rules.ts — её переиспользует analyzeIntegrity (Task 2 плана 4).
// Реэкспорт сохраняет прежние импорты потребителей (тесты плана 2).
export { DOMAIN_PREFIXES, keywordEntries, portSpecError } from '../../entities/xray'
```

Тело компонента не меняется — `keywordEntries`/`portSpecError` теперь берутся из импорта.

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/xray-rules.test.ts test/rule-form.test.tsx` — PASS (rule-form.test.tsx работает через реэкспорт, без правок).

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/rules.ts frontend/src/entities/xray/index.ts frontend/src/features/inspector/RuleForm.tsx frontend/test/xray-rules.test.ts
git commit -m "refactor(frontend): move rule domain and port helpers to xray entities" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Расширение `analyzeIntegrity` (матрица, flow, hysteria, ссылки, домены, порты)

**Files:**
- Modify: `frontend/src/entities/xray/config.ts`
- Test: `frontend/test/xray-config.test.ts` (дополнить; существующие тесты не менять)

**Interfaces:**
- Consumes: `securityNetworkIssue`/`flowNetworkIssue`/`hysteriaCertificateIssue` из `./compat` (план 3), `keywordEntries`/`portSpecError` из `./rules` (Task 1). Импорты — относительные внутри entities (не через index, чтобы не создавать цикл: index импортирует config).
- Produces: `analyzeIntegrity` дополнительно к существующим проверкам (дубликаты тегов/портов, висячие ссылки правил — НЕ трогать) отдаёт:
  - `error` `inbounds.N.streamSettings` / `outbounds.N.streamSettings` — несовместимые security×network (и hysteria без tls);
  - `error` `inbounds.N.streamSettings` — hysteria + tls без certificates;
  - `error` `inbounds.N.settings.flow` — vision-flow у vless поверх не-raw; `error` `outbounds.N.settings.vnext.S.users.U.flow` — то же у outbound vless;
  - `warning` `outbounds.N.streamSettings.sockopt.dialerProxy` — тег отсутствует среди outbounds;
  - `warning` `routing.rules.N.balancerTag` — тег отсутствует среди `routing.balancers[].tag`;
  - `warning` `routing.rules.N.domain` — записи без префикса (keyword-матчинг), с перечислением;
  - `error` `routing.rules.N.port` / `.sourcePort` — битый формат по `portSpecError`.
- Вывод виден автоматически: `EditorPage` рендерит `IssueList` из `validateXrayConfig(text).issues`, `JsonView` подсвечивает gutter — проводка не нужна. `error` блокирует «Сохранить в панель» (существующий `hasErrors`) — сознательно, см. Global Constraints.

- [ ] **Step 1: Написать падающий тест**

Дополнить `frontend/test/xray-config.test.ts` в конец файла:

```ts
describe('analyzeIntegrity — матрица совместимости (план 4)', () => {
  it('reality поверх ws у inbound — ошибка', () => {
    const cfg = {
      inbounds: [
        { tag: 'a', port: 443, protocol: 'vless', streamSettings: { network: 'ws', security: 'reality' } },
      ],
      outbounds: [],
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(
      res.issues.some(
        (i) => i.level === 'error' && i.path === 'inbounds.0.streamSettings' && i.message.includes('Reality несовместим'),
      ),
    ).toBe(true)
  })

  it('reality поверх ws у outbound — ошибка', () => {
    const cfg = {
      inbounds: [],
      outbounds: [
        { tag: 'chain', protocol: 'vless', streamSettings: { network: 'ws', security: 'reality' } },
      ],
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(res.issues.some((i) => i.level === 'error' && i.path === 'outbounds.0.streamSettings')).toBe(true)
  })

  it('flow vision поверх ws (settings.flow) — ошибка', () => {
    const cfg = {
      inbounds: [
        {
          tag: 'a',
          port: 443,
          protocol: 'vless',
          settings: { clients: [], decryption: 'none', flow: 'xtls-rprx-vision' },
          streamSettings: { network: 'ws', security: 'tls' },
        },
      ],
      outbounds: [],
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(res.issues.some((i) => i.level === 'error' && i.path === 'inbounds.0.settings.flow')).toBe(true)
  })

  it('flow у outbound vless (vnext) поверх grpc — ошибка', () => {
    const cfg = {
      inbounds: [],
      outbounds: [
        {
          tag: 'chain',
          protocol: 'vless',
          settings: { vnext: [{ address: 'a', port: 443, users: [{ id: 'u', flow: 'xtls-rprx-vision' }] }] },
          streamSettings: { network: 'grpc', security: 'reality' },
        },
      ],
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(
      res.issues.some((i) => i.level === 'error' && i.path === 'outbounds.0.settings.vnext.0.users.0.flow'),
    ).toBe(true)
  })

  it('hysteria с tls без сертификатов — ошибка; с сертификатом — нет', () => {
    const mk = (tlsSettings: unknown) => ({
      inbounds: [
        { tag: 'h', port: 443, protocol: 'hysteria', streamSettings: { network: 'hysteria', security: 'tls', tlsSettings } },
      ],
      outbounds: [],
    })
    const bad = validateXrayConfig(JSON.stringify(mk({})))
    expect(bad.issues.some((i) => i.level === 'error' && i.message.includes('сертификат'))).toBe(true)
    const good = validateXrayConfig(JSON.stringify(mk({ certificates: [{ certificateFile: '/c', keyFile: '/k' }] })))
    expect(good.issues.filter((i) => i.level === 'error')).toHaveLength(0)
  })

  it('совместимые комбинации не дают ошибок (reality+grpc, vision+tcp)', () => {
    const cfg = {
      inbounds: [
        {
          tag: 'a',
          port: 443,
          protocol: 'vless',
          settings: { clients: [], decryption: 'none', flow: 'xtls-rprx-vision' },
          streamSettings: { network: 'tcp', security: 'reality', realitySettings: {} },
        },
        { tag: 'b', port: 444, protocol: 'trojan', streamSettings: { network: 'grpc', security: 'reality' } },
      ],
      outbounds: [],
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(res.issues.filter((i) => i.level === 'error')).toHaveLength(0)
  })
})

describe('analyzeIntegrity — ссылки и правила (план 4)', () => {
  it('dialerProxy на несуществующий тег — предупреждение; на существующий — нет', () => {
    const mk = (dialerProxy: string) => ({
      inbounds: [],
      outbounds: [
        { tag: 'proxy', protocol: 'vless', streamSettings: { network: 'tcp', sockopt: { dialerProxy } } },
        { tag: 'warp', protocol: 'wireguard' },
      ],
    })
    const bad = validateXrayConfig(JSON.stringify(mk('ghost')))
    expect(
      bad.issues.some(
        (i) =>
          i.level === 'warning' &&
          i.path === 'outbounds.0.streamSettings.sockopt.dialerProxy' &&
          i.message.includes('ghost'),
      ),
    ).toBe(true)
    const good = validateXrayConfig(JSON.stringify(mk('warp')))
    expect(good.issues).toHaveLength(0)
  })

  it('balancerTag: на несуществующий — предупреждение, на существующий — нет', () => {
    const mk = (balancers: unknown[]) => ({
      inbounds: [],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { balancers, rules: [{ type: 'field', balancerTag: 'lb' }] },
    })
    const bad = validateXrayConfig(JSON.stringify(mk([])))
    expect(bad.issues.some((i) => i.level === 'warning' && i.path === 'routing.rules.0.balancerTag')).toBe(true)
    const good = validateXrayConfig(JSON.stringify(mk([{ tag: 'lb', selector: ['direct'] }])))
    expect(good.issues).toHaveLength(0)
  })

  it('домен без префикса — предупреждение с перечислением', () => {
    const cfg = {
      inbounds: [],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{ type: 'field', domain: ['geosite:openai', 'example', 'raw-sub'], outboundTag: 'direct' }] },
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    const w = res.issues.find((i) => i.path === 'routing.rules.0.domain')
    expect(w?.level).toBe('warning')
    expect(w?.message).toContain('example')
    expect(w?.message).toContain('raw-sub')
    expect(w?.message).not.toContain('geosite:openai')
  })

  it('битый порт правила — ошибка; корректный список — нет', () => {
    const mk = (port: string) => ({
      inbounds: [],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{ type: 'field', port, outboundTag: 'direct' }] },
    })
    const bad = validateXrayConfig(JSON.stringify(mk('70000')))
    expect(bad.issues.some((i) => i.level === 'error' && i.path === 'routing.rules.0.port')).toBe(true)
    const src = validateXrayConfig(
      JSON.stringify({
        inbounds: [],
        outbounds: [{ tag: 'direct', protocol: 'freedom' }],
        routing: { rules: [{ type: 'field', sourcePort: 'abc', outboundTag: 'direct' }] },
      }),
    )
    expect(src.issues.some((i) => i.level === 'error' && i.path === 'routing.rules.0.sourcePort')).toBe(true)
    const good = validateXrayConfig(JSON.stringify(mk('443,1000-2000')))
    expect(good.issues.filter((i) => i.level === 'error')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/xray-config.test.ts`
Ожидание: FAIL — новые describe падают (issues пустые), существующие тесты зелёные.

- [ ] **Step 3: Реализация**

В `frontend/src/entities/xray/config.ts`:

1. Добавить импорты после существующих (`import { RoutingSchema } from './routing'`):

```ts
import { flowNetworkIssue, hysteriaCertificateIssue, securityNetworkIssue } from './compat'
import { keywordEntries, portSpecError } from './rules'
```

2. Добавить перед `export function analyzeIntegrity`:

```ts
// Поднабор streamSettings, который читают проверки матрицы (схема — passthrough,
// поэтому типизируем только нужные ключи)
interface StreamSubset {
  network?: string
  security?: string
  tlsSettings?: { certificates?: unknown[] }
  sockopt?: { dialerProxy?: string }
}
```

3. В `analyzeIntegrity` заменить существующий цикл `rules.forEach((rule, i) => { ... })` (проверки `outboundTag`/`inboundTag`) на расширенный:

```ts
  const balancerTags = new Set(
    (config.routing?.balancers ?? [])
      .map((b) => (b as { tag?: unknown }).tag)
      .filter((t): t is string => typeof t === 'string'),
  )
  rules.forEach((rule, i) => {
    if (rule.outboundTag && !outboundTags.has(rule.outboundTag)) {
      issues.push({
        path: `routing.rules.${i}.outboundTag`,
        message: `Правило ссылается на несуществующий outbound «${rule.outboundTag}»`,
        level: 'warning',
      })
    }
    for (const tag of rule.inboundTag ?? []) {
      if (!inboundTags.has(tag)) {
        issues.push({
          path: `routing.rules.${i}.inboundTag`,
          message: `Правило ссылается на несуществующий inbound «${tag}»`,
          level: 'warning',
        })
      }
    }
    // Балансеры редактируются только в JSON, но висячая ссылка должна быть видна
    if (rule.balancerTag && !balancerTags.has(rule.balancerTag)) {
      issues.push({
        path: `routing.rules.${i}.balancerTag`,
        message: `Правило ссылается на несуществующий балансер «${rule.balancerTag}»`,
        level: 'warning',
      })
    }
    const keywords = keywordEntries(rule.domain)
    if (keywords.length > 0) {
      issues.push({
        path: `routing.rules.${i}.domain`,
        message: `Домены без префикса матчатся как подстрока (keyword): ${keywords.join(', ')}`,
        level: 'warning',
      })
    }
    const portErr = portSpecError(rule.port)
    if (portErr) issues.push({ path: `routing.rules.${i}.port`, message: portErr, level: 'error' })
    const sourcePortErr = portSpecError(rule.sourcePort)
    if (sourcePortErr) {
      issues.push({ path: `routing.rules.${i}.sourcePort`, message: sourcePortErr, level: 'error' })
    }
  })
```

4. После этого цикла (перед `return issues`) добавить:

```ts
  // Матрица совместимости streamSettings: такие конфиги ядро Xray не запустит,
  // поэтому level 'error' — сознательно блокирует «Сохранить в панель»
  inbounds.forEach((inb, i) => {
    const stream = inb.streamSettings as StreamSubset | undefined
    if (stream) {
      const secNet = securityNetworkIssue(stream.security, stream.network)
      if (secNet) issues.push({ path: `inbounds.${i}.streamSettings`, message: secNet, level: 'error' })
      const cert = hysteriaCertificateIssue(stream.network, stream.security, stream.tlsSettings)
      if (cert) issues.push({ path: `inbounds.${i}.streamSettings`, message: cert, level: 'error' })
    }
    if (inb.protocol === 'vless') {
      // Панель Remnawave применяет flow из settings ко всем пользователям inbound'а
      const flow = (inb.settings as { flow?: string } | undefined)?.flow
      const flowIssue = flowNetworkIssue(flow, stream?.network)
      if (flowIssue) issues.push({ path: `inbounds.${i}.settings.flow`, message: flowIssue, level: 'error' })
    }
  })

  outbounds.forEach((out, i) => {
    const stream = out.streamSettings as StreamSubset | undefined
    if (stream) {
      const secNet = securityNetworkIssue(stream.security, stream.network)
      if (secNet) issues.push({ path: `outbounds.${i}.streamSettings`, message: secNet, level: 'error' })
      const dialer = stream.sockopt?.dialerProxy
      if (dialer !== undefined && dialer !== '' && !outboundTags.has(dialer)) {
        issues.push({
          path: `outbounds.${i}.streamSettings.sockopt.dialerProxy`,
          message: `dialerProxy ссылается на несуществующий outbound «${dialer}»`,
          level: 'warning',
        })
      }
    }
    if (out.protocol === 'vless') {
      const vnext = (out.settings as { vnext?: { users?: { flow?: string }[] }[] } | undefined)?.vnext ?? []
      vnext.forEach((server, si) => {
        for (const [ui, user] of (server.users ?? []).entries()) {
          const flowIssue = flowNetworkIssue(user.flow, stream?.network)
          if (flowIssue) {
            issues.push({
              path: `outbounds.${i}.settings.vnext.${si}.users.${ui}.flow`,
              message: flowIssue,
              level: 'error',
            })
          }
        }
      })
    }
  })
```

Существующие блоки (дубликаты тегов, дубликаты портов) не трогать.

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/xray-config.test.ts test/xray-compat.test.ts test/xray-rules.test.ts` — PASS. Важно: существующий тест «валидный конфиг — ok без ошибок» (`fullConfig`: reality+tcp, домены с `geosite:`) не должен получить новых ошибок.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/config.ts frontend/test/xray-config.test.ts
git commit -m "feat(frontend): integrity checks for compat matrix, refs and rule format" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: InboundForm — fallbacks (vless/trojan) + decryption

**Files:**
- Modify: `frontend/src/features/inspector/InboundForm.tsx` (полная перезапись)
- Test: `frontend/test/inbound-form.test.tsx` (дополнить; существующие тесты не менять)

**Interfaces:**
- Consumes: `ListEditor` из `./collections`, `CollapsibleSection` из `shared/ui`, `NumberField`/`PortField` из `./fields`, `FallbackSchema` (план 1 — поля `dest`/`path`/`alpn`/`name`/`xver`, схему не менять).
- Produces: общий рендер `renderFallbacks()` для vless и trojan (поля идентичны); у vless — `CollapsibleSection` «Продвинутые (VLESS)» с `decryption` (TextField). `dest` — через `PortField` (union number|string: порт числом, unix-сокет строкой), mount-only → key с индексом и длиной списка. Остальное поведение формы (шаблоны settings, flow, StreamForm, sniffing-чекбокс) сохраняется без изменений — Task 4 доводит sniffing.

- [ ] **Step 1: Написать падающий тест**

В `frontend/test/inbound-form.test.tsx`:

1. Дополнить импорты: после `import userEvent from '@testing-library/user-event'` добавить `import { useState } from 'react'`.

2. После функции `wrap` добавить stateful-обёртку (нужна для многосимвольного ввода — controlled-форма без эха откатывает каждый keystroke):

```tsx
// Обёртка-родитель как в реальном приложении: эхо-ит onChange обратно в value через useState
function StatefulInboundForm({
  initial,
  onChange,
}: {
  initial: Record<string, unknown>
  onChange?: (next: Record<string, unknown>) => void
}) {
  const [value, setValue] = useState(initial)
  const handle = (next: Record<string, unknown>) => {
    setValue(next)
    onChange?.(next)
  }
  return <InboundForm value={value} onChange={handle} />
}
```

3. Добавить в конец файла:

```tsx
describe('InboundForm — fallbacks и decryption', () => {
  it('vless: добавленный fallback пишет dest числом и path', async () => {
    const onChange = vi.fn()
    wrap(<StatefulInboundForm initial={VLESS} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Fallback'))
    await userEvent.type(screen.getByLabelText('Куда (dest)'), '8080')
    await userEvent.type(screen.getByLabelText('Путь (path)'), '/web')
    const next = onChange.mock.lastCall![0] as { settings: { fallbacks: Record<string, unknown>[] } }
    expect(next.settings.fallbacks).toHaveLength(1)
    expect(next.settings.fallbacks[0]!.dest).toBe(8080)
    expect(next.settings.fallbacks[0]!.path).toBe('/web')
  })

  it('удаление последнего fallback удаляет ключ из settings', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulInboundForm
        initial={{ ...VLESS, settings: { ...VLESS.settings, fallbacks: [{ dest: 80 }] } }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByLabelText('Удалить элемент 1'))
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings.fallbacks).toBeUndefined()
  })

  it('trojan: fallbacks тоже доступны', () => {
    wrap(<StatefulInboundForm initial={{ tag: 't', protocol: 'trojan', settings: { clients: [] } }} />)
    expect(screen.getByText('+ Fallback')).toBeInTheDocument()
  })

  it('vless: decryption в «Продвинутых (VLESS)»', async () => {
    const onChange = vi.fn()
    wrap(<StatefulInboundForm initial={VLESS} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(VLESS\)/ }))
    const field = screen.getByLabelText('Decryption')
    expect(field).toHaveValue('none')
    await userEvent.type(field, '1')
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings.decryption).toBe('none1')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/inbound-form.test.tsx`
Ожидание: FAIL — кнопки «+ Fallback» и секции «Продвинутые (VLESS)» нет в разметке; существующие тесты зелёные.

- [ ] **Step 3: Реализация**

Заменить содержимое `frontend/src/features/inspector/InboundForm.tsx` целиком на:

```tsx
import { Button, Checkbox, CollapsibleSection } from '../../shared/ui'
import { ssPassword } from '../../entities/xray/generate'
import { StreamForm } from './StreamForm'
import { ListEditor } from './collections'
import { NumberField, PortField, SelectField, TextField, type Option } from './fields'

type Obj = Record<string, unknown>

const PROTOCOLS: Option[] = [
  { value: 'vless', label: 'VLESS' },
  { value: 'trojan', label: 'Trojan' },
  { value: 'shadowsocks', label: 'Shadowsocks' },
]

const SS_METHODS: Option[] = [
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
].map((v) => ({ value: v, label: v }))

// Flow применяется панелью Remnawave ко всем пользователям inbound'а (settings.flow)
const FLOWS: Option[] = [
  { value: '', label: 'нет' },
  { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
]

// settings протоколо-специфичны: при смене протокола заменяются чистым шаблоном,
// иначе в JSON остаются висеть поля прежнего протокола (например method от Shadowsocks)
const SETTINGS_TEMPLATES: Record<string, Obj> = {
  vless: { clients: [], decryption: 'none' },
  trojan: { clients: [] },
  shadowsocks: {},
}

interface Props {
  value: Obj // inbound целиком
  onChange: (next: Obj) => void
}

export function InboundForm({ value, onChange }: Props) {
  const protocol = (value.protocol as string) ?? 'vless'
  const settings = (value.settings as Obj) ?? {}
  const sniffing = (value.sniffing as Obj) ?? {}
  const fallbacks = settings.fallbacks as Obj[] | undefined

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  function patchSettings(mut: (s: Obj) => void) {
    patch((next) => {
      const s = (next.settings as Obj) ?? {}
      mut(s)
      next.settings = s
    })
  }

  // Fallbacks одинаковы у vless и trojan — общий рендер
  function renderFallbacks() {
    return (
      <ListEditor<Obj>
        label="Fallbacks"
        hint="Не-протокольный трафик уходит сюда (маскировка под сайт); dest — порт, адрес или unix-сокет"
        value={fallbacks}
        onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.fallbacks; else s.fallbacks = v })}
        createItem={() => ({})}
        addLabel="+ Fallback"
        renderItem={(item, update, i) => {
          const total = fallbacks?.length ?? 0
          return (
            <>
              {/* Mount-only буфер PortField: смена числа карточек сдвигает индексы — remount по key */}
              <PortField
                key={`fb-dest:${i}:${total}`}
                label="Куда (dest)"
                value={item.dest as number | string | undefined}
                onChange={(v) => update({ dest: v })}
              />
              <TextField
                label="Путь (path)"
                mono
                placeholder="/web"
                value={item.path as string | undefined}
                onChange={(v) => update({ path: v })}
              />
              <TextField
                label="ALPN (alpn)"
                mono
                placeholder="h2"
                hint="Fallback сработает только при совпадении ALPN хендшейка"
                value={item.alpn as string | undefined}
                onChange={(v) => update({ alpn: v })}
              />
              <TextField
                label="SNI (name)"
                mono
                placeholder="example.com"
                value={item.name as string | undefined}
                onChange={(v) => update({ name: v })}
              />
              <NumberField
                label="PROXY protocol (xver)"
                placeholder="0"
                value={item.xver as number | undefined}
                onChange={(v) => update({ xver: v })}
              />
            </>
          )
        }}
      />
    )
  }

  return (
    <>
      <TextField label="Тег" mono value={value.tag as string | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.tag; else n.tag = v })} />
      <PortField label="Порт" value={value.port as number | string | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.port; else n.port = v })} />
      <TextField label="Listen (адрес)" mono placeholder="0.0.0.0" value={value.listen as string | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.listen; else n.listen = v })} />
      <SelectField label="Протокол" value={protocol} options={PROTOCOLS}
        onChange={(v) =>
          patch((n) => {
            if (n.protocol === v) return
            n.protocol = v
            n.settings = structuredClone(SETTINGS_TEMPLATES[v] ?? {})
          })
        }
      />

      {protocol === 'vless' && (
        <>
          <SelectField label="Flow" value={(settings.flow as string) ?? ''} options={FLOWS}
            onChange={(v) => patchSettings((s) => { if (v === '') delete s.flow; else s.flow = v })} />
          <p className="muted" style={{ margin: 0 }}>
            Пользователи добавляются панелью Remnawave автоматически; flow применяется ко всем пользователям
            этого inbound'а.
          </p>
          {renderFallbacks()}
          <CollapsibleSection title="Продвинутые (VLESS)">
            <TextField
              label="Decryption"
              mono
              hint="VLESS Encryption: «none» или ключ формата mlkem768x25519plus… (генерирует xray vlessenc)"
              value={settings.decryption as string | undefined}
              onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.decryption; else s.decryption = v })}
            />
          </CollapsibleSection>
        </>
      )}

      {protocol === 'trojan' && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Пользователи добавляются панелью Remnawave автоматически — клиентов настраивать не нужно.
          </p>
          {renderFallbacks()}
        </>
      )}

      {protocol === 'shadowsocks' && (
        <>
          <SelectField label="Метод шифрования" value={(settings.method as string) ?? '2022-blake3-aes-128-gcm'}
            options={SS_METHODS}
            onChange={(v) => patchSettings((s) => { s.method = v })} />
          <TextField label="Пароль" mono value={settings.password as string | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.password; else s.password = v })} />
          <Button variant="ghost"
            onClick={() => patchSettings((s) => { s.password = ssPassword((s.method as string) ?? '2022-blake3-aes-128-gcm') })}>
            Сгенерировать пароль
          </Button>
        </>
      )}

      <StreamForm value={(value.streamSettings as Obj) ?? {}}
        onChange={(stream) => patch((n) => { n.streamSettings = stream })}
        flow={settings.flow as string | undefined} />

      <Checkbox label="Sniffing включён" checked={Boolean(sniffing.enabled)}
        onChange={(checked) =>
          patch((n) => {
            n.sniffing = { ...((n.sniffing as Obj) ?? { destOverride: ['http', 'tls', 'quic'] }), enabled: checked }
          })
        }
      />
    </>
  )
}
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/inbound-form.test.tsx test/node-inspector.test.tsx` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/InboundForm.tsx frontend/test/inbound-form.test.tsx
git commit -m "feat(frontend): inbound fallbacks editor and vless decryption" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: InboundForm — hysteria2, shadowsocks network, полный sniffing

**Files:**
- Modify: `frontend/src/features/inspector/InboundForm.tsx`
- Test: `frontend/test/inbound-form.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `CheckboxField`/`MultiSelectField` из `./fields`, `HysteriaInboundSettingsSchema`/`ShadowsocksInboundSettingsSchema`/`SniffingSchema` (план 1, не менять).
- Produces: протокол `hysteria` в селекте (шаблон settings `{ version: 2 }`, version в форме не редактируется; подсказка про настоящий TLS-сертификат и переключение транспорта на «Hysteria 2 (QUIC)»; клиентов инжектит панель — формы клиентов нет); у shadowsocks — `network` (select tcp/udp/tcp,udp); sniffing — при включённом чекбоксе появляются `destOverride` (MultiSelect http/tls/quic/fakedns), `routeOnly`, `metadataOnly` (CheckboxField, false → undefined).

- [ ] **Step 1: Написать падающий тест**

Добавить в конец `frontend/test/inbound-form.test.tsx`:

```tsx
describe('InboundForm — hysteria2, shadowsocks network, sniffing', () => {
  it('переключение на hysteria: settings = { version: 2 }, подсказка про TLS, клиентов нет', async () => {
    const onChange = vi.fn()
    wrap(<StatefulInboundForm initial={VLESS} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Протокол'), 'hysteria')
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings).toEqual({ version: 2 })
    expect(screen.getByText(/настоящий TLS-сертификат/)).toBeInTheDocument()
    expect(screen.queryByText('+ Клиент')).not.toBeInTheDocument()
  })

  it('shadowsocks: network пишется и удаляется', async () => {
    const onChange = vi.fn()
    wrap(<StatefulInboundForm initial={{ tag: 's', protocol: 'shadowsocks', settings: {} }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Сеть (network)'), 'tcp,udp')
    expect((onChange.mock.lastCall![0] as { settings: Record<string, unknown> }).settings.network).toBe('tcp,udp')
    await userEvent.selectOptions(screen.getByLabelText('Сеть (network)'), '')
    expect('network' in (onChange.mock.lastCall![0] as { settings: Record<string, unknown> }).settings).toBe(false)
  })

  it('sniffing: destOverride чипами, routeOnly чекбоксом', async () => {
    const onChange = vi.fn()
    wrap(<StatefulInboundForm initial={VLESS} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'fakedns' }))
    await userEvent.click(screen.getByLabelText('Только для маршрутизации (routeOnly)'))
    const next = onChange.mock.lastCall![0] as { sniffing: Record<string, unknown> }
    expect(next.sniffing.destOverride).toEqual(['http', 'fakedns'])
    expect(next.sniffing.routeOnly).toBe(true)
  })

  it('при выключенном sniffing доп-поля скрыты', () => {
    wrap(<InboundForm value={{ ...VLESS, sniffing: { enabled: false } }} onChange={vi.fn()} />)
    expect(screen.queryByLabelText('Только для маршрутизации (routeOnly)')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'fakedns' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/inbound-form.test.tsx`
Ожидание: FAIL — опции `hysteria` нет в селекте протокола, полей «Сеть (network)» и sniffing-чипов нет.

- [ ] **Step 3: Реализация**

В `frontend/src/features/inspector/InboundForm.tsx` (поверх результата Task 3):

1. Расширить импорт из `./fields`:

```tsx
import { CheckboxField, MultiSelectField, NumberField, PortField, SelectField, TextField, type Option } from './fields'
```

2. В `PROTOCOLS` добавить последним элементом:

```tsx
  { value: 'hysteria', label: 'Hysteria 2' },
```

3. После `FLOWS` добавить константы:

```tsx
const SS_NETWORKS: Option[] = [
  { value: '', label: 'tcp (по умолчанию)' },
  { value: 'tcp', label: 'tcp' },
  { value: 'udp', label: 'udp' },
  { value: 'tcp,udp', label: 'tcp,udp' },
]

// Протоколы, которые sniffing умеет определять и подменять адрес назначения
const DEST_OVERRIDES: Option[] = ['http', 'tls', 'quic', 'fakedns'].map((v) => ({ value: v, label: v }))
```

4. В `SETTINGS_TEMPLATES` добавить:

```tsx
  // version: 2 фиксирован — Hysteria 2 в Xray-core иначе не стартует
  hysteria: { version: 2 },
```

5. После помощника `patchSettings` добавить:

```tsx
  function patchSniffing(mut: (s: Obj) => void) {
    patch((next) => {
      const s = (next.sniffing as Obj) ?? {}
      mut(s)
      next.sniffing = s
    })
  }
```

6. После блока `{protocol === 'trojan' && ( ... )}` добавить:

```tsx
      {protocol === 'hysteria' && (
        <p className="muted" style={{ margin: 0 }}>
          Hysteria 2 (settings.version = 2 фиксирован): нужен настоящий TLS-сертификат, Reality не используется.
          Ниже переключите транспорт на «Hysteria 2 (QUIC)». Пользователей добавляет панель Remnawave.
        </p>
      )}
```

7. В блоке `{protocol === 'shadowsocks' && ( ... )}` после кнопки «Сгенерировать пароль» добавить:

```tsx
          <SelectField
            label="Сеть (network)"
            hint="Какие соединения принимает inbound"
            value={(settings.network as string) ?? ''}
            options={SS_NETWORKS}
            onChange={(v) => patchSettings((s) => { if (v === '') delete s.network; else s.network = v })}
          />
```

8. Заменить блок `<Checkbox label="Sniffing включён" ... />` (весь JSX-элемент) на:

```tsx
      <Checkbox label="Sniffing включён" checked={Boolean(sniffing.enabled)}
        onChange={(checked) =>
          patch((n) => {
            n.sniffing = { ...((n.sniffing as Obj) ?? { destOverride: ['http', 'tls', 'quic'] }), enabled: checked }
          })
        }
      />
      {Boolean(sniffing.enabled) && (
        <>
          <MultiSelectField
            label="Определяемые протоколы (destOverride)"
            hint="Адрес назначения подменяется доменом из перехваченного запроса"
            options={DEST_OVERRIDES}
            value={sniffing.destOverride as string[] | undefined}
            onChange={(v) => patchSniffing((s) => { if (v === undefined) delete s.destOverride; else s.destOverride = v })}
          />
          <CheckboxField
            label="Только для маршрутизации (routeOnly)"
            hint="Домен используется в правилах, но адрес назначения не подменяется"
            value={sniffing.routeOnly as boolean | undefined}
            onChange={(v) => patchSniffing((s) => { if (v === undefined) delete s.routeOnly; else s.routeOnly = v })}
          />
          <CheckboxField
            label="Только метаданные (metadataOnly)"
            hint="Сниффинг без чтения содержимого соединения"
            value={sniffing.metadataOnly as boolean | undefined}
            onChange={(v) => patchSniffing((s) => { if (v === undefined) delete s.metadataOnly; else s.metadataOnly = v })}
          />
        </>
      )}
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/inbound-form.test.tsx test/node-inspector.test.tsx` — PASS. Существующий тест «sniffing переключается чекбоксом» не задет: чекбокс и его patch-логика не изменились.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/InboundForm.tsx frontend/test/inbound-form.test.tsx
git commit -m "feat(frontend): hysteria2 inbound, shadowsocks network, full sniffing form" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: OutboundForm — vless `vnext`

**Files:**
- Modify: `frontend/src/features/inspector/OutboundForm.tsx`
- Test: `frontend/test/outbound-form.test.tsx` (дополнить; `StatefulOutboundForm` получает опциональный `onChange` — аддитивно)

**Interfaces:**
- Consumes: `ListEditor` из `./collections`, `VlessVnextSchema`/`VlessOutboundUserSchema` (план 1, не менять).
- Produces: для `protocol === 'vless'` вместо заглушки «редактируется в JSON» — `ListEditor` по `settings.vnext`: карточка с `address`/`port` + поля первого пользователя (`users[0]`): `id` (UUID, пусто — инжектит панель), `flow` (select), `encryption` (текст, обычно `none`). `createItem` даёт `{ users: [{ encryption: 'none' }] }` — классический VLESS требует `encryption: "none"`. Хелпер `patchFirstUser` (модульный): правит `users[0]`, единственный опустевший пользователь удаляется целиком. Заглушка остаётся только для socks/http (Task 6 уберёт).

- [ ] **Step 1: Написать падающий тест**

В `frontend/test/outbound-form.test.tsx`:

1. Заменить `StatefulOutboundForm` на вариант с опциональным `onChange` (существующие использования не задеты):

```tsx
// Обёртка-родитель как в реальном приложении: эхо-ит onChange обратно в value через useState
function StatefulOutboundForm({
  initial,
  outboundTags,
  onChange,
}: {
  initial: Record<string, unknown>
  outboundTags?: string[]
  onChange?: (next: Record<string, unknown>) => void
}) {
  const [value, setValue] = useState(initial)
  const handle = (next: Record<string, unknown>) => {
    setValue(next)
    onChange?.(next)
  }
  return <OutboundForm value={value} onChange={handle} outboundTags={outboundTags} />
}
```

2. Добавить в конец файла:

```tsx
describe('OutboundForm — vless vnext', () => {
  it('добавление сервера: encryption none по умолчанию, адрес и порт пишутся', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 'chain', protocol: 'vless', settings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Сервер'))
    await userEvent.type(screen.getByLabelText('Адрес'), 'node2.example.com')
    await userEvent.type(screen.getByLabelText('Порт'), '443')
    const next = onChange.mock.lastCall![0] as { settings: { vnext: Record<string, unknown>[] } }
    expect(next.settings.vnext).toHaveLength(1)
    expect(next.settings.vnext[0]!.address).toBe('node2.example.com')
    expect(next.settings.vnext[0]!.port).toBe(443)
    expect(next.settings.vnext[0]!.users).toEqual([{ encryption: 'none' }])
  })

  it('uuid и flow пишутся в users[0]; очистка uuid оставляет encryption', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulOutboundForm
        initial={{
          tag: 'chain',
          protocol: 'vless',
          settings: { vnext: [{ address: 'a', users: [{ encryption: 'none' }] }] },
        }}
        onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('UUID (users[0].id)'), 'uuid-1')
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'xtls-rprx-vision')
    let next = onChange.mock.lastCall![0] as { settings: { vnext: { users: Record<string, unknown>[] }[] } }
    expect(next.settings.vnext[0]!.users[0]).toEqual({ encryption: 'none', id: 'uuid-1', flow: 'xtls-rprx-vision' })

    await userEvent.clear(screen.getByLabelText('UUID (users[0].id)'))
    next = onChange.mock.lastCall![0] as { settings: { vnext: { users: Record<string, unknown>[] }[] } }
    expect(next.settings.vnext[0]!.users[0]).toEqual({ encryption: 'none', flow: 'xtls-rprx-vision' })
  })

  it('подсказки «редактируются на вкладке JSON» для vless больше нет', () => {
    wrap(<OutboundForm value={{ tag: 'c', protocol: 'vless' }} onChange={vi.fn()} />)
    expect(screen.queryByText(/редактируются на вкладке JSON/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/outbound-form.test.tsx`
Ожидание: FAIL — кнопки «+ Сервер» нет, заглушка про JSON всё ещё рендерится для vless.

- [ ] **Step 3: Реализация**

В `frontend/src/features/inspector/OutboundForm.tsx`:

1. Добавить импорт после импорта `StreamForm`:

```tsx
import { ListEditor } from './collections'
```

2. После `DOMAIN_STRATEGIES` добавить:

```tsx
const OUTBOUND_FLOWS: Option[] = [
  { value: '', label: 'нет' },
  { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
]
```

3. После `WARP_TEMPLATE` (перед `interface Props`) добавить модульный хелпер:

```tsx
// Правка первого пользователя карточки (vnext/servers): единственный опустевший
// пользователь удаляется целиком — UUID может инжектить панель Remnawave
function patchFirstUser(item: Obj, update: (patch: Partial<Obj>) => void, mut: (u: Obj) => void) {
  const users = ((item.users as Obj[]) ?? []).map((u) => ({ ...u }))
  if (users.length === 0) users.push({})
  mut(users[0]!)
  if (users.length === 1 && Object.keys(users[0]!).length === 0) update({ users: undefined })
  else update({ users })
}
```

4. В теле компонента после `const peer = ...` добавить:

```tsx
  const vnext = settings.vnext as Obj[] | undefined
```

5. Заменить блок заглушки

```tsx
      {(protocol === 'socks' || protocol === 'http' || protocol === 'vless') && (
        <p className="muted" style={{ margin: 0 }}>
          Настройки протокола «{protocol}» редактируются на вкладке JSON узла.
        </p>
      )}
```

на:

```tsx
      {(protocol === 'socks' || protocol === 'http') && (
        <p className="muted" style={{ margin: 0 }}>
          Настройки протокола «{protocol}» редактируются на вкладке JSON узла.
        </p>
      )}

      {protocol === 'vless' && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Цепочка нод: трафик уходит на следующий VLESS-сервер. UUID может инжектить панель — тогда
            оставьте поле пустым.
          </p>
          <ListEditor<Obj>
            label="Серверы (vnext)"
            value={vnext}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.vnext; else s.vnext = v })}
            createItem={() => ({ users: [{ encryption: 'none' }] })}
            addLabel="+ Сервер"
            renderItem={(item, update) => {
              const user = ((item.users as Obj[]) ?? [])[0] ?? {}
              return (
                <>
                  <TextField label="Адрес" mono placeholder="node2.example.com"
                    value={item.address as string | undefined}
                    onChange={(v) => update({ address: v })} />
                  <NumberField label="Порт" placeholder="443"
                    value={item.port as number | undefined}
                    onChange={(v) => update({ port: v })} />
                  <TextField label="UUID (users[0].id)" mono hint="Пусто — пользователя инжектит панель"
                    value={user.id as string | undefined}
                    onChange={(v) => patchFirstUser(item, update, (u) => { if (v === undefined) delete u.id; else u.id = v })} />
                  <SelectField label="Flow" value={(user.flow as string) ?? ''} options={OUTBOUND_FLOWS}
                    onChange={(v) => patchFirstUser(item, update, (u) => { if (v === '') delete u.flow; else u.flow = v })} />
                  <TextField label="Encryption" mono placeholder="none" hint="Для классического VLESS — «none»"
                    value={user.encryption as string | undefined}
                    onChange={(v) =>
                      patchFirstUser(item, update, (u) => { if (v === undefined) delete u.encryption; else u.encryption = v })
                    } />
                </>
              )
            }}
          />
        </>
      )}
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/outbound-form.test.tsx test/node-inspector.test.tsx` — PASS (тест «для socks показывает подсказку про JSON» ещё зелёный — заглушка для socks/http осталась до Task 6).

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/OutboundForm.tsx frontend/test/outbound-form.test.tsx
git commit -m "feat(frontend): vless outbound vnext form" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: OutboundForm — socks/http `servers`

**Files:**
- Modify: `frontend/src/features/inspector/OutboundForm.tsx`
- Test: `frontend/test/outbound-form.test.tsx` (один существующий тест заменяется осознанно + дополнения)

**Interfaces:**
- Consumes: `ListEditor`, `patchFirstUser` (Task 5), `ProxyServerSchema`/`ProxyServerUserSchema` (план 1, не менять).
- Produces: для socks/http вместо заглушки — `ListEditor` по `settings.servers`: карточка `address`/`port` + `users[0].user`/`users[0].pass`. Заглушек «редактируется в JSON» в OutboundForm больше не остаётся.

- [ ] **Step 1: Написать падающий тест**

В `frontend/test/outbound-form.test.tsx`:

1. Заменить существующий тест `it('для socks показывает подсказку про JSON', ...)` целиком на:

```tsx
  it('socks: серверы редактируются формой, подсказки про JSON нет', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 's', protocol: 'socks', settings: {} }} onChange={onChange} />)
    expect(screen.queryByText(/редактируются на вкладке JSON/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('+ Сервер'))
    await userEvent.type(screen.getByLabelText('Адрес'), '10.0.0.1')
    await userEvent.type(screen.getByLabelText('Порт'), '1080')
    await userEvent.type(screen.getByLabelText('Логин (users[0].user)'), 'admin')
    await userEvent.type(screen.getByLabelText('Пароль (users[0].pass)'), 'pw')
    const next = onChange.mock.lastCall![0] as { settings: { servers: Record<string, unknown>[] } }
    expect(next.settings.servers[0]).toEqual({ address: '10.0.0.1', port: 1080, users: [{ user: 'admin', pass: 'pw' }] })
  })
```

2. Добавить в конец файла:

```tsx
describe('OutboundForm — http servers', () => {
  it('http: очистка логина и пароля удаляет users целиком', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulOutboundForm
        initial={{ tag: 'h', protocol: 'http', settings: { servers: [{ address: 'p', port: 3128, users: [{ user: 'a' }] }] } }}
        onChange={onChange}
      />,
    )
    await userEvent.clear(screen.getByLabelText('Логин (users[0].user)'))
    const next = onChange.mock.lastCall![0] as { settings: { servers: Record<string, unknown>[] } }
    expect(next.settings.servers[0]).toEqual({ address: 'p', port: 3128 })
  })
})
```

Примечание: `patchFirstUser` эмитит `{ users: undefined }` — ключ с `undefined` пропадает при JSON-сериализации, а `toEqual` в vitest игнорирует undefined-свойства, поэтому сравнение с `{ address: 'p', port: 3128 }` проходит.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/outbound-form.test.tsx`
Ожидание: FAIL — для socks всё ещё рендерится заглушка, полей серверов нет.

- [ ] **Step 3: Реализация**

В `frontend/src/features/inspector/OutboundForm.tsx`:

1. В теле компонента после `const vnext = ...` добавить:

```tsx
  const servers = settings.servers as Obj[] | undefined
```

2. Заменить оставшуюся заглушку

```tsx
      {(protocol === 'socks' || protocol === 'http') && (
        <p className="muted" style={{ margin: 0 }}>
          Настройки протокола «{protocol}» редактируются на вкладке JSON узла.
        </p>
      )}
```

на:

```tsx
      {(protocol === 'socks' || protocol === 'http') && (
        <ListEditor<Obj>
          label="Серверы"
          hint="Внешний прокси-сервер, на который уходит трафик"
          value={servers}
          onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.servers; else s.servers = v })}
          createItem={() => ({})}
          addLabel="+ Сервер"
          renderItem={(item, update) => {
            const user = ((item.users as Obj[]) ?? [])[0] ?? {}
            return (
              <>
                <TextField label="Адрес" mono placeholder="10.0.0.1"
                  value={item.address as string | undefined}
                  onChange={(v) => update({ address: v })} />
                <NumberField label="Порт" placeholder={protocol === 'socks' ? '1080' : '3128'}
                  value={item.port as number | undefined}
                  onChange={(v) => update({ port: v })} />
                <TextField label="Логин (users[0].user)" mono hint="Пусто — прокси без авторизации"
                  value={user.user as string | undefined}
                  onChange={(v) => patchFirstUser(item, update, (u) => { if (v === undefined) delete u.user; else u.user = v })} />
                <TextField label="Пароль (users[0].pass)" mono
                  value={user.pass as string | undefined}
                  onChange={(v) => patchFirstUser(item, update, (u) => { if (v === undefined) delete u.pass; else u.pass = v })} />
              </>
            )
          }}
        />
      )}
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/outbound-form.test.tsx` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/OutboundForm.tsx frontend/test/outbound-form.test.tsx
git commit -m "feat(frontend): socks and http outbound servers form" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: OutboundForm — freedom `redirect`+`fragment`, blackhole `response`, wireguard полный

**Files:**
- Modify: `frontend/src/features/inspector/OutboundForm.tsx`
- Test: `frontend/test/outbound-form.test.tsx` (дополнить; существующие wireguard-тесты остаются зелёными — лейблы полей пира сохраняются)

**Interfaces:**
- Consumes: `CollapsibleSection` из `shared/ui`, `FreedomFragmentSchema`/`BlackholeOutboundSettingsSchema`/`WireguardPeerSchema` (план 1, не менять).
- Produces: freedom — `redirect` (TextField) и CollapsibleSection «Fragment (анти-DPI)» с кнопкой «Пресет tlshello» (`{ packets: 'tlshello', length: '100-200', interval: '10-20' }`) и полями `packets`/`length`/`interval` (опустевший `fragment` удаляется — хелпер `patchFragment`); blackhole — `response.type` (select none/http, пустой ответ удаляет `response`); wireguard — peers через `ListEditor` (лейблы «Публичный ключ пира»/«Endpoint пира»/«AllowedIPs пира» сохранены — существующие тесты не задеты; добавлены `preSharedKey`, `keepAlive`), `reserved` (StringListField по числу на строку → number[]), `domainStrategy` (ForceIP-семейство). Старые `peer`/`patchPeer` (только первый пир) удаляются.

- [ ] **Step 1: Написать падающий тест**

Добавить в конец `frontend/test/outbound-form.test.tsx`:

```tsx
describe('OutboundForm — freedom fragment, blackhole response, wireguard полный', () => {
  it('freedom: redirect пишется, пресет tlshello заполняет fragment', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 'direct', protocol: 'freedom', settings: {} }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Redirect'), ':3366')
    expect((onChange.mock.lastCall![0] as { settings: Record<string, unknown> }).settings.redirect).toBe(':3366')
    await userEvent.click(screen.getByRole('button', { name: /Fragment \(анти-DPI\)/ }))
    await userEvent.click(screen.getByText('Пресет tlshello'))
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings.fragment).toEqual({ packets: 'tlshello', length: '100-200', interval: '10-20' })
  })

  it('freedom: очистка последнего поля fragment удаляет секцию', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulOutboundForm
        initial={{ tag: 'direct', protocol: 'freedom', settings: { fragment: { packets: 'tlshello' } } }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Fragment \(анти-DPI\)/ }))
    await userEvent.clear(screen.getByLabelText('Пакеты (packets)'))
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings.fragment).toBeUndefined()
  })

  it('blackhole: response.type пишется и удаляется', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 'block', protocol: 'blackhole', settings: {} }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Ответ (response.type)'), 'http')
    expect((onChange.mock.lastCall![0] as { settings: Record<string, unknown> }).settings.response).toEqual({ type: 'http' })
    await userEvent.selectOptions(screen.getByLabelText('Ответ (response.type)'), '')
    expect((onChange.mock.lastCall![0] as { settings: Record<string, unknown> }).settings.response).toBeUndefined()
  })

  it('wireguard: второй пир добавляется, preSharedKey и keepAlive пишутся', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulOutboundForm
        initial={{ tag: 'warp', protocol: 'wireguard', settings: { peers: [{ publicKey: 'pk1' }] } }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByText('+ Пир'))
    await userEvent.type(screen.getAllByLabelText('preSharedKey')[1]!, 'psk')
    await userEvent.type(screen.getAllByLabelText('keepAlive (сек)')[1]!, '25')
    const next = onChange.mock.lastCall![0] as { settings: { peers: Record<string, unknown>[] } }
    expect(next.settings.peers).toHaveLength(2)
    expect(next.settings.peers[0]).toEqual({ publicKey: 'pk1' })
    expect(next.settings.peers[1]).toEqual({ preSharedKey: 'psk', keepAlive: 25 })
  })

  it('wireguard: reserved парсится в числа построчно, domainStrategy пишется', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 'warp', protocol: 'wireguard', settings: {} }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Reserved (по числу на строку)'), '51{enter}77')
    expect((onChange.mock.lastCall![0] as { settings: Record<string, unknown> }).settings.reserved).toEqual([51, 77])
    await userEvent.selectOptions(screen.getByLabelText('Стратегия доменов'), 'ForceIPv4')
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings.domainStrategy).toBe('ForceIPv4')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/outbound-form.test.tsx`
Ожидание: FAIL — полей Redirect/Fragment/response/пиров-карточек/Reserved нет.

- [ ] **Step 3: Реализация**

В `frontend/src/features/inspector/OutboundForm.tsx`:

1. Заменить импорт `import { Button } from '../../shared/ui'` на:

```tsx
import { Button, CollapsibleSection } from '../../shared/ui'
```

2. После `OUTBOUND_FLOWS` добавить константы:

```tsx
const WG_DOMAIN_STRATEGIES: Option[] = [
  { value: '', label: 'не задана (ForceIP)' },
  { value: 'ForceIP', label: 'ForceIP' },
  { value: 'ForceIPv4', label: 'ForceIPv4' },
  { value: 'ForceIPv6', label: 'ForceIPv6' },
  { value: 'ForceIPv6v4', label: 'ForceIPv6v4' },
]

const BLACKHOLE_RESPONSES: Option[] = [
  { value: '', label: 'не задан (none — молча разорвать)' },
  { value: 'none', label: 'none — молча разорвать' },
  { value: 'http', label: 'http — пустой HTTP-ответ (мягкий отказ)' },
]
```

3. В теле компонента заменить строки

```tsx
  const peer = ((settings.peers as Obj[]) ?? [])[0] ?? {}
```

на:

```tsx
  const peers = settings.peers as Obj[] | undefined
  const fragment = (settings.fragment as Obj) ?? {}
```

и удалить целиком функцию `patchPeer` (больше не используется), добавив вместо неё:

```tsx
  // Правка settings.fragment; опустевшая секция удаляется целиком
  function patchFragment(mut: (f: Obj) => void) {
    patchSettings((s) => {
      const f = (s.fragment as Obj) ?? {}
      mut(f)
      if (Object.keys(f).length === 0) delete s.fragment
      else s.fragment = f
    })
  }
```

4. Заменить блок `{protocol === 'freedom' && ( ... )}` (единственный SelectField) на:

```tsx
      {protocol === 'freedom' && (
        <>
          <SelectField
            label="Стратегия доменов"
            value={(settings.domainStrategy as string) ?? ''}
            options={DOMAIN_STRATEGIES}
            onChange={(v) => patchSettings((s) => { if (v === '') delete s.domainStrategy; else s.domainStrategy = v })}
          />
          <TextField
            label="Redirect"
            mono
            placeholder="127.0.0.1:3366"
            hint="Весь трафик принудительно уходит на этот адрес (адрес:порт)"
            value={settings.redirect as string | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.redirect; else s.redirect = v })}
          />
          <CollapsibleSection title="Fragment (анти-DPI)">
            <Button
              variant="ghost"
              onClick={() =>
                patchSettings((s) => { s.fragment = { packets: 'tlshello', length: '100-200', interval: '10-20' } })
              }
            >
              Пресет tlshello
            </Button>
            <p className="muted" style={{ margin: 0 }}>
              Фрагментация ClientHello ломает DPI-детект; работает только для исходящего TLS.
            </p>
            <TextField label="Пакеты (packets)" mono placeholder="tlshello"
              value={fragment.packets as string | undefined}
              onChange={(v) => patchFragment((f) => { if (v === undefined) delete f.packets; else f.packets = v })} />
            <TextField label="Длина (length)" mono placeholder="100-200"
              value={fragment.length as string | undefined}
              onChange={(v) => patchFragment((f) => { if (v === undefined) delete f.length; else f.length = v })} />
            <TextField label="Интервал (interval)" mono placeholder="10-20"
              value={fragment.interval as string | undefined}
              onChange={(v) => patchFragment((f) => { if (v === undefined) delete f.interval; else f.interval = v })} />
          </CollapsibleSection>
        </>
      )}
```

5. Заменить блок `{protocol === 'blackhole' && ( ... )}` на:

```tsx
      {protocol === 'blackhole' && (
        <>
          <p className="muted" style={{ margin: 0 }}>Блокирует весь трафик, направленный в этот outbound.</p>
          <SelectField
            label="Ответ (response.type)"
            value={((settings.response as Obj | undefined)?.type as string) ?? ''}
            options={BLACKHOLE_RESPONSES}
            onChange={(v) =>
              patchSettings((s) => {
                if (v === '') delete s.response
                else s.response = { ...((s.response as Obj) ?? {}), type: v }
              })
            }
          />
        </>
      )}
```

6. Заменить блок `{protocol === 'wireguard' && ( ... )}` целиком на:

```tsx
      {protocol === 'wireguard' && (
        <>
          <Button onClick={() => {
            patch((n) => { n.settings = structuredClone(WARP_TEMPLATE) })
            setWarpFillCount((c) => c + 1)
          }}>
            Заполнить шаблон WARP
          </Button>
          <p className="muted" style={{ margin: 0 }}>
            secretKey и address выдаёт Cloudflare при регистрации устройства (утилита wgcf).
          </p>
          <TextField label="Приватный ключ (secretKey)" mono value={settings.secretKey as string | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.secretKey; else s.secretKey = v })} />
          <StringListField key={`address:${warpFillCount}`} label="Адреса интерфейса" placeholder="172.16.0.2/32"
            value={settings.address as string[] | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.address; else s.address = v })} />
          <ListEditor<Obj>
            label="Пиры (peers)"
            value={peers}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.peers; else s.peers = v })}
            createItem={() => ({})}
            addLabel="+ Пир"
            renderItem={(item, update, i) => {
              const total = peers?.length ?? 0
              return (
                <>
                  <TextField label="Публичный ключ пира" mono value={item.publicKey as string | undefined}
                    onChange={(v) => update({ publicKey: v })} />
                  <TextField label="Endpoint пира" mono placeholder="engage.cloudflareclient.com:2408"
                    value={item.endpoint as string | undefined}
                    onChange={(v) => update({ endpoint: v })} />
                  {/* Mount-only буфер: remount при смене числа карточек и заливке WARP-шаблона */}
                  <StringListField key={`allowedIPs:${warpFillCount}:${i}:${total}`} label="AllowedIPs пира"
                    placeholder={'0.0.0.0/0\n::/0'}
                    value={item.allowedIPs as string[] | undefined}
                    onChange={(v) => update({ allowedIPs: v })} />
                  <TextField label="preSharedKey" mono value={item.preSharedKey as string | undefined}
                    onChange={(v) => update({ preSharedKey: v })} />
                  <NumberField label="keepAlive (сек)" placeholder="25" value={item.keepAlive as number | undefined}
                    onChange={(v) => update({ keepAlive: v })} />
                </>
              )
            }}
          />
          <NumberField label="MTU" placeholder="1280" value={settings.mtu as number | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.mtu; else s.mtu = v })} />
          <StringListField key={`reserved:${warpFillCount}`} label="Reserved (по числу на строку)"
            hint="3 байта client id WARP; нечисловые строки игнорируются" placeholder={'51\n77\n99'}
            value={(settings.reserved as number[] | undefined)?.map(String)}
            onChange={(v) =>
              patchSettings((s) => {
                const nums = (v ?? []).map(Number).filter((n) => Number.isInteger(n))
                if (nums.length === 0) delete s.reserved
                else s.reserved = nums
              })
            } />
          <SelectField label="Стратегия доменов" value={(settings.domainStrategy as string) ?? ''}
            options={WG_DOMAIN_STRATEGIES}
            onChange={(v) => patchSettings((s) => { if (v === '') delete s.domainStrategy; else s.domainStrategy = v })} />
        </>
      )}
```

Импорт `StringListField` уже есть в файле; `useState`/`warpFillCount` не меняются.

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/outbound-form.test.tsx test/node-inspector.test.tsx` — PASS. Регрессия важна: «правка publicKey пира не трогает остальное» (лейбл сохранён, `update` карточки мержит поля), «кнопка WARP обновляет отображаемые значения StringListField» (key `allowedIPs` включает `warpFillCount`).

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/OutboundForm.tsx frontend/test/outbound-form.test.tsx
git commit -m "feat(frontend): freedom fragment, blackhole response, full wireguard form" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: OutboundForm — `mux` и `sendThrough` в «Продвинутых»

**Files:**
- Modify: `frontend/src/features/inspector/OutboundForm.tsx`
- Test: `frontend/test/outbound-form.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `CheckboxField` из `./fields`, `MuxSchema`/`sendThrough` (план 1, не менять).
- Produces: CollapsibleSection «Продвинутые (outbound)» в конце формы (для всех протоколов): `sendThrough` (TextField, top-level ключ outbound); mux-поля (`enabled`, `concurrency`, `xudpConcurrency`, `xudpProxyUDP443`) — только для vless/socks/http (протоколы с мультиплексируемым транспортом). Хелпер `patchTop(key, mut)` — правка top-level секции с удалением опустевшей (`mux`).

- [ ] **Step 1: Написать падающий тест**

Добавить в конец `frontend/test/outbound-form.test.tsx`:

```tsx
describe('OutboundForm — mux и sendThrough', () => {
  it('vless: mux включается, выключение удаляет пустой mux', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 'chain', protocol: 'vless', settings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(outbound\)/ }))
    await userEvent.click(screen.getByLabelText('Mux включён'))
    expect((onChange.mock.lastCall![0] as Record<string, unknown>).mux).toEqual({ enabled: true })
    await userEvent.type(screen.getByLabelText('Concurrency'), '8')
    expect((onChange.mock.lastCall![0] as Record<string, unknown>).mux).toEqual({ enabled: true, concurrency: 8 })
    await userEvent.click(screen.getByLabelText('Mux включён'))
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.mux).toEqual({ concurrency: 8 })
  })

  it('sendThrough пишется и удаляется; у freedom mux-полей нет', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 'direct', protocol: 'freedom', settings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(outbound\)/ }))
    expect(screen.queryByLabelText('Mux включён')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Исходящий адрес (sendThrough)'), '10.0.0.5')
    expect((onChange.mock.lastCall![0] as Record<string, unknown>).sendThrough).toBe('10.0.0.5')
    await userEvent.clear(screen.getByLabelText('Исходящий адрес (sendThrough)'))
    expect('sendThrough' in (onChange.mock.lastCall![0] as Record<string, unknown>)).toBe(false)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/outbound-form.test.tsx`
Ожидание: FAIL — секции «Продвинутые (outbound)» нет.

- [ ] **Step 3: Реализация**

В `frontend/src/features/inspector/OutboundForm.tsx`:

1. Расширить импорт из `./fields`:

```tsx
import { CheckboxField, NumberField, SelectField, StringListField, TextField, type Option } from './fields'
```

2. После `BLACKHOLE_RESPONSES` добавить:

```tsx
const XUDP_MODES: Option[] = [
  { value: '', label: 'reject (по умолчанию)' },
  { value: 'reject', label: 'reject — отклонять UDP/443' },
  { value: 'allow', label: 'allow — пропускать через mux' },
  { value: 'skip', label: 'skip — мимо mux' },
]

// Протоколы, для которых mux имеет смысл (мультиплексируемый прокси-транспорт)
const MUX_PROTOCOLS = ['vless', 'socks', 'http']
```

3. В теле компонента после `const fragment = ...` добавить:

```tsx
  const mux = (value.mux as Obj) ?? {}
```

и после `patchFragment` добавить:

```tsx
  // Правка top-level секции outbound (mux); опустевшая секция удаляется целиком
  function patchTop(key: string, mut: (s: Obj) => void) {
    patch((next) => {
      const s = (next[key] as Obj) ?? {}
      mut(s)
      if (Object.keys(s).length === 0) delete next[key]
      else next[key] = s
    })
  }
```

4. Перед закрывающим `</>` компонента (после блока StreamForm) добавить:

```tsx
      <CollapsibleSection title="Продвинутые (outbound)">
        <TextField
          label="Исходящий адрес (sendThrough)"
          mono
          placeholder="0.0.0.0"
          hint="IP интерфейса для исходящих соединений (мульти-IP серверы)"
          value={value.sendThrough as string | undefined}
          onChange={(v) => patch((n) => { if (v === undefined) delete n.sendThrough; else n.sendThrough = v })}
        />
        {MUX_PROTOCOLS.includes(protocol) && (
          <>
            <CheckboxField
              label="Mux включён"
              hint="Мультиплексирование потоков; несовместим с flow xtls-rprx-vision"
              value={mux.enabled as boolean | undefined}
              onChange={(v) => patchTop('mux', (m) => { if (v === undefined) delete m.enabled; else m.enabled = v })}
            />
            <NumberField label="Concurrency" placeholder="8" value={mux.concurrency as number | undefined}
              onChange={(v) => patchTop('mux', (m) => { if (v === undefined) delete m.concurrency; else m.concurrency = v })} />
            <NumberField label="xudpConcurrency" placeholder="16" value={mux.xudpConcurrency as number | undefined}
              onChange={(v) =>
                patchTop('mux', (m) => { if (v === undefined) delete m.xudpConcurrency; else m.xudpConcurrency = v })
              } />
            <SelectField label="UDP/443 (xudpProxyUDP443)" value={(mux.xudpProxyUDP443 as string) ?? ''} options={XUDP_MODES}
              onChange={(v) =>
                patchTop('mux', (m) => { if (v === '') delete m.xudpProxyUDP443; else m.xudpProxyUDP443 = v })
              } />
          </>
        )}
      </CollapsibleSection>
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/outbound-form.test.tsx test/node-inspector.test.tsx test/stream-form.test.tsx` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/OutboundForm.tsx frontend/test/outbound-form.test.tsx
git commit -m "feat(frontend): outbound mux and sendThrough advanced section" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `DnsForm` + kind `dns` в NodeInspector

**Files:**
- Create: `frontend/src/features/inspector/DnsForm.tsx`
- Modify: `frontend/src/features/topology/NodeInspector.tsx`
- Test: `frontend/test/dns-form.test.tsx` (создать)
- Test: `frontend/test/node-inspector.test.tsx` (один существующий тест заменяется осознанно)

**Interfaces:**
- Consumes: `DnsServerObjectSchema`/`DnsSchema` (план 1, не менять); адресация dns-узла в mutations: `getNodeJson(config, 'dns')` возвращает объект `config.dns` целиком, `applyNodeJson(config, 'dns', value)` кладёт его обратно, `removeNode` удаляет секцию — mutations и buildGraph НЕ меняются, DnsForm получает и пишет весь объект dns через существующий механизм NodeInspector (`parsedNode` → `setText`).
- Produces: `DnsForm({ value, onChange })` — `value` = объект dns целиком. `servers` — `ListEditor<ServerCard>` с двумя видами карточки: `{ kind: 'simple', address }` (строка-адрес в конфиге) и `{ kind: 'full', server }` (объект `address`/`port`/`domains`/`expectIPs`); kind-обёртка живёт только в UI, `fromCard` возвращает в конфиг исходную форму (string | object), неизвестные поля объекта сохраняются. Переключатель «Тип сервера» конвертирует строку в объект (адрес переносится) и обратно (остаётся только адрес — с подсказкой). Плюс `queryStrategy` (select), `hosts` (KeyValueField — только строковые записи; записи-массивы сохраняются нетронутыми, с пометкой про JSON), `tag`, `clientIp` в «Продвинутых (DNS)». NodeInspector: `nodeId === 'dns'` → новый kind `dns`, вкладка «Форма» с DnsForm (по аналогии с rule из плана 2).

- [ ] **Step 1: Написать падающие тесты**

1. Создать `frontend/test/dns-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DnsForm } from '../src/features/inspector/DnsForm'

// Обёртка-родитель: эхо-ит onChange обратно в value (DnsForm — controlled)
function StatefulDnsForm({
  initial,
  onChange,
}: {
  initial: Record<string, unknown>
  onChange?: (next: Record<string, unknown>) => void
}) {
  const [value, setValue] = useState(initial)
  const handle = (next: Record<string, unknown>) => {
    setValue(next)
    onChange?.(next)
  }
  return <DnsForm value={value} onChange={handle} />
}

describe('DnsForm — servers', () => {
  it('строка-адрес редактируется и остаётся строкой', async () => {
    const onChange = vi.fn()
    render(<StatefulDnsForm initial={{ servers: ['8.8.8.8'] }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Адрес'), '8')
    expect((onChange.mock.lastCall![0] as { servers: unknown[] }).servers).toEqual(['8.8.8.88'])
  })

  it('добавленный сервер — простая карточка; ввод адреса пишет строку', async () => {
    const onChange = vi.fn()
    render(<StatefulDnsForm initial={{}} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Сервер'))
    await userEvent.type(screen.getByLabelText('Адрес'), '1.1.1.1')
    expect((onChange.mock.lastCall![0] as { servers: unknown[] }).servers).toEqual(['1.1.1.1'])
  })

  it('переключение в расширенный объект переносит адрес; domains пишутся', async () => {
    const onChange = vi.fn()
    render(<StatefulDnsForm initial={{ servers: ['8.8.8.8'] }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Тип сервера'), 'full')
    expect((onChange.mock.lastCall![0] as { servers: unknown[] }).servers).toEqual([{ address: '8.8.8.8' }])
    await userEvent.type(screen.getByLabelText('Домены (domains)'), 'geosite:category-ru')
    const next = onChange.mock.lastCall![0] as { servers: { domains?: string[] }[] }
    expect(next.servers[0]!.domains).toEqual(['geosite:category-ru'])
  })

  it('объект-сервер: неизвестные поля сохраняются при правке порта', async () => {
    const onChange = vi.fn()
    render(<StatefulDnsForm initial={{ servers: [{ address: '1.1.1.1', unknownOpt: true }] }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Порт'), '53')
    expect((onChange.mock.lastCall![0] as { servers: unknown[] }).servers).toEqual([
      { address: '1.1.1.1', unknownOpt: true, port: 53 },
    ])
  })

  it('удаление последнего сервера удаляет ключ servers', async () => {
    const onChange = vi.fn()
    render(<StatefulDnsForm initial={{ servers: ['8.8.8.8'] }} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Удалить элемент 1'))
    expect((onChange.mock.lastCall![0] as Record<string, unknown>).servers).toBeUndefined()
  })
})

describe('DnsForm — hosts, queryStrategy, продвинутые', () => {
  it('hosts: строковые пары редактируются, записи-массивы сохраняются', async () => {
    const onChange = vi.fn()
    render(
      <StatefulDnsForm
        initial={{ hosts: { 'multi.example.com': ['1.1.1.1', '2.2.2.2'], 'b.com': '3.3.3.3' } }}
        onChange={onChange}
      />,
    )
    expect(screen.getByText(/multi\.example\.com/)).toBeInTheDocument()
    await userEvent.click(screen.getByText('+ Пара'))
    await userEvent.type(screen.getAllByPlaceholderText('example.com')[1]!, 'c.com')
    await userEvent.type(screen.getAllByPlaceholderText('1.2.3.4')[1]!, '4.4.4.4')
    const next = onChange.mock.lastCall![0] as { hosts: Record<string, unknown> }
    expect(next.hosts).toEqual({
      'multi.example.com': ['1.1.1.1', '2.2.2.2'],
      'b.com': '3.3.3.3',
      'c.com': '4.4.4.4',
    })
  })

  it('queryStrategy, tag и clientIp пишутся', async () => {
    const onChange = vi.fn()
    render(<StatefulDnsForm initial={{}} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Стратегия запросов (queryStrategy)'), 'UseIPv4')
    await userEvent.type(screen.getByLabelText('Тег (tag)'), 'dns-out')
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(DNS\)/ }))
    await userEvent.type(screen.getByLabelText('IP клиента (clientIp)'), '203.0.113.1')
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.queryStrategy).toBe('UseIPv4')
    expect(next.tag).toBe('dns-out')
    expect(next.clientIp).toBe('203.0.113.1')
  })
})
```

2. В `frontend/test/node-inspector.test.tsx` заменить существующий тест `it('для dns узла вкладок нет — сразу JSON', ...)` целиком на (семантика меняется по спеке — dns получает форму):

```tsx
  it('dns-узел: вкладка «Форма» с DnsForm, правка применяется', async () => {
    const onApply = vi.fn()
    const dnsConfig = { ...config, dns: { servers: ['8.8.8.8'] } }
    wrap(
      <NodeInspector config={dnsConfig} nodeId="dns" onApply={onApply} onRemove={() => {}} onClose={() => {}} />,
    )
    expect(screen.getByText('Форма')).toBeInTheDocument()
    expect(screen.getByText('JSON узла')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Стратегия запросов (queryStrategy)'), 'UseIPv4')
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(onApply).toHaveBeenCalledWith({ servers: ['8.8.8.8'], queryStrategy: 'UseIPv4' })
  })
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/dns-form.test.tsx test/node-inspector.test.tsx`
Ожидание: FAIL — модуля `DnsForm` нет; у dns-узла нет вкладки «Форма».

- [ ] **Step 3: Реализация**

1. Создать `frontend/src/features/inspector/DnsForm.tsx`:

```tsx
import { CollapsibleSection } from '../../shared/ui'
import { KeyValueField, ListEditor } from './collections'
import { NumberField, SelectField, StringListField, TextField, type Option } from './fields'

type Obj = Record<string, unknown>

const QUERY_STRATEGIES: Option[] = [
  { value: '', label: 'не задана (UseIP)' },
  { value: 'UseIP', label: 'UseIP — A и AAAA' },
  { value: 'UseIPv4', label: 'UseIPv4 — только A' },
  { value: 'UseIPv6', label: 'UseIPv6 — только AAAA' },
]

const SERVER_KINDS: Option[] = [
  { value: 'simple', label: 'адрес строкой' },
  { value: 'full', label: 'расширенный объект' },
]

// Сервер DNS в конфиге — строка-адрес ИЛИ объект. kind-обёртка живёт только в UI:
// fromCard возвращает в конфиг исходную форму, неизвестные поля объекта сохраняются.
type ServerCard = { kind: 'simple'; address: string } | { kind: 'full'; server: Obj }

function toCard(s: unknown): ServerCard {
  return typeof s === 'string' ? { kind: 'simple', address: s } : { kind: 'full', server: { ...((s as Obj) ?? {}) } }
}

function fromCard(c: ServerCard): unknown {
  return c.kind === 'simple' ? c.address : c.server
}

interface Props {
  value: Obj // объект dns целиком (getNodeJson(config, 'dns'))
  onChange: (next: Obj) => void
}

export function DnsForm({ value, onChange }: Props) {
  const servers = value.servers as unknown[] | undefined
  const cards = servers?.map(toCard)
  const hosts = (value.hosts as Record<string, unknown> | undefined) ?? {}
  // KeyValueField умеет только строки; записи-массивы (несколько IP на домен)
  // в форме не редактируются, но сохраняются при любых правках
  const stringHosts = Object.fromEntries(
    Object.entries(hosts).filter((e): e is [string, string] => typeof e[1] === 'string'),
  )
  const arrayHostEntries = Object.entries(hosts).filter(([, v]) => typeof v !== 'string')

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  return (
    <>
      <ListEditor<ServerCard>
        label="Серверы"
        hint="Опрашиваются по порядку; адрес — IP, tcp://…, https://…/dns-query или localhost"
        value={cards}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.servers; else n.servers = v.map(fromCard) })}
        createItem={() => ({ kind: 'simple', address: '' })}
        addLabel="+ Сервер"
        renderItem={(item, update, i) => {
          const total = cards?.length ?? 0
          const server = item.kind === 'full' ? item.server : {}
          const setServer = (mut: (s: Obj) => void) => {
            const s = { ...server }
            mut(s)
            update({ kind: 'full', server: s } as Partial<ServerCard>)
          }
          return (
            <>
              <SelectField
                label="Тип сервера"
                hint="Расширенный — свои домены и expectIPs; при сворачивании в строку останется только адрес"
                value={item.kind}
                options={SERVER_KINDS}
                onChange={(v) => {
                  if (v === item.kind) return
                  if (v === 'full') {
                    update({
                      kind: 'full',
                      server: item.kind === 'simple' && item.address !== '' ? { address: item.address } : {},
                    } as Partial<ServerCard>)
                  } else {
                    update({
                      kind: 'simple',
                      address: ((item.kind === 'full' ? item.server.address : '') as string | undefined) ?? '',
                    } as Partial<ServerCard>)
                  }
                }}
              />
              {item.kind === 'simple' && (
                <TextField
                  label="Адрес"
                  mono
                  placeholder="1.1.1.1"
                  value={item.address === '' ? undefined : item.address}
                  onChange={(v) => update({ address: v ?? '' } as Partial<ServerCard>)}
                />
              )}
              {item.kind === 'full' && (
                <>
                  <TextField label="Адрес" mono placeholder="8.8.8.8" value={server.address as string | undefined}
                    onChange={(v) => setServer((s) => { if (v === undefined) delete s.address; else s.address = v })} />
                  <NumberField label="Порт" placeholder="53" value={server.port as number | undefined}
                    onChange={(v) => setServer((s) => { if (v === undefined) delete s.port; else s.port = v })} />
                  {/* Mount-only буфер StringListField — remount при смене числа карточек */}
                  <StringListField key={`domains:${i}:${total}`} label="Домены (domains)"
                    hint="Только эти домены резолвятся этим сервером"
                    placeholder={'geosite:category-ru\ndomain:example.com'}
                    value={server.domains as string[] | undefined}
                    onChange={(v) => setServer((s) => { if (v === undefined) delete s.domains; else s.domains = v })} />
                  <StringListField key={`expectIPs:${i}:${total}`} label="Ожидаемые IP (expectIPs)"
                    hint="Ответы вне списка отбрасываются (защита от DNS-подмены)"
                    placeholder="geoip:ru"
                    value={server.expectIPs as string[] | undefined}
                    onChange={(v) => setServer((s) => { if (v === undefined) delete s.expectIPs; else s.expectIPs = v })} />
                </>
              )}
            </>
          )
        }}
      />
      <SelectField
        label="Стратегия запросов (queryStrategy)"
        value={(value.queryStrategy as string) ?? ''}
        options={QUERY_STRATEGIES}
        onChange={(v) => patch((n) => { if (v === '') delete n.queryStrategy; else n.queryStrategy = v })}
      />
      <KeyValueField
        label="Hosts"
        hint="Статические записи: домен → IP или домен → другой домен"
        keyPlaceholder="example.com"
        valuePlaceholder="1.2.3.4"
        value={Object.keys(stringHosts).length > 0 ? stringHosts : undefined}
        onChange={(v) =>
          patch((n) => {
            const merged: Record<string, unknown> = { ...(v ?? {}) }
            for (const [k, val] of arrayHostEntries) merged[k] = val
            if (Object.keys(merged).length === 0) delete n.hosts
            else n.hosts = merged
          })
        }
      />
      {arrayHostEntries.length > 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Записи с несколькими значениями ({arrayHostEntries.map(([k]) => k).join(', ')}) редактируются на
          вкладке «JSON узла».
        </p>
      )}
      <TextField
        label="Тег (tag)"
        mono
        hint="Запросы DNS-модуля помечаются этим тегом — можно маршрутизировать правилами"
        value={value.tag as string | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.tag; else n.tag = v })}
      />
      <CollapsibleSection title="Продвинутые (DNS)">
        <TextField
          label="IP клиента (clientIp)"
          mono
          placeholder="203.0.113.1"
          hint="EDNS Client Subnet — геопривязка DNS-ответов к этому IP"
          value={value.clientIp as string | undefined}
          onChange={(v) => patch((n) => { if (v === undefined) delete n.clientIp; else n.clientIp = v })}
        />
      </CollapsibleSection>
    </>
  )
}
```

2. В `frontend/src/features/topology/NodeInspector.tsx`:

Добавить импорт после импорта `RuleForm`:

```tsx
import { DnsForm } from '../inspector/DnsForm'
```

Заменить вычисление `kind` на:

```tsx
  const kind = nodeId.startsWith('in:')
    ? 'inbound'
    : nodeId.startsWith('out:')
      ? 'outbound'
      : nodeId.startsWith('rule:')
        ? 'rule'
        : nodeId === 'dns'
          ? 'dns'
          : 'other'
```

После блока `{parsedNode !== null && kind === 'rule' && ( ... )}` добавить:

```tsx
          {parsedNode !== null && kind === 'dns' && (
            <DnsForm value={parsedNode} onChange={(next) => setText(JSON.stringify(next, null, 2))} />
          )}
```

Остальное (вкладки, apply, retag-диалог) менять не нужно: условия `kind !== 'other'` автоматически дают dns-узлу вкладки «Форма»/«JSON узла».

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/dns-form.test.tsx test/node-inspector.test.tsx` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/DnsForm.tsx frontend/src/features/topology/NodeInspector.tsx frontend/test/dns-form.test.tsx frontend/test/node-inspector.test.tsx
git commit -m "feat(frontend): dns form for dns graph node" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Playwright e2e — сводные сценарии форм

**Files:**
- Modify: `frontend/e2e/mocks.ts` (в CONFIG добавляется секция dns)
- Create: `frontend/e2e/forms.spec.ts`
- Regress: `frontend/e2e/editor.spec.ts`, `frontend/e2e/routing.spec.ts` (не менять; добавление dns в мок их не задевает — они считают rule-узлы и кликают по конкретным data-id)

**Interfaces:**
- Consumes: стиль существующих e2e — `mockApi(page)` перехватывает `/api/*`, dev-сервер поднимает `playwright.config.ts` на `127.0.0.1:4173`, бэкенд не нужен. e2e не входит в tsconfig — `tsc --noEmit` их не проверяет.
- Produces: 4 сценария (по секции 8 спеки, без перебора): (1) правка правила формой; (2) матрица транспорт/security + hysteria2-inbound; (3) outbound vless со streamSettings Reality (клиентские поля); (4) диалог «Настройки конфига» + DNS-форма.

- [ ] **Step 1: Дополнить мок**

В `frontend/e2e/mocks.ts` в объект `CONFIG` добавить после `log: { loglevel: 'warning' },`:

```ts
  dns: { servers: ['1.1.1.1'] },
```

- [ ] **Step 2: Написать сценарии**

Создать `frontend/e2e/forms.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
})

test('правило маршрутизации редактируется формой', async ({ page }) => {
  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="rule:0"]').click()
  await inspector.getByLabel('Outbound (куда отправить)').selectOption('block')
  await inspector.getByRole('button', { name: 'Применить' }).click()
  // Ребро перестроилось на новый outbound, конфиг ушёл в черновик
  await expect(page.locator('.react-flow__edge[data-id="e:rule:0->out:block"]')).toBeVisible()
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
})

test('матрица security×network в селектах + hysteria2-inbound', async ({ page }) => {
  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="in:vless-in"]').click()
  // ws не совместим с reality — опция пропадает из селекта шифрования (остаются none и tls)
  await inspector.getByLabel('Транспорт').selectOption('ws')
  await expect(inspector.getByLabel('Шифрование').locator('option')).toHaveCount(2)
  // hysteria2-протокол: чистый шаблон settings и русская подсказка про сертификат
  await inspector.getByLabel('Протокол').selectOption('hysteria')
  await expect(inspector.getByText(/настоящий TLS-сертификат/)).toBeVisible()
})

test('outbound vless: streamSettings Reality с клиентскими полями', async ({ page }) => {
  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="out:direct"]').click()
  await inspector.getByLabel('Протокол').selectOption('vless')
  await inspector.getByLabel('Шифрование').selectOption('reality')
  // Клиентские поля Reality (outbound-режим StreamForm); серверных кнопок генерации нет
  await inspector.getByLabel('Имя сервера (serverName)').fill('yahoo.com')
  await inspector.getByLabel('Публичный ключ сервера (password)').fill('PBK')
  await expect(inspector.getByText('Сгенерировать ключи')).toHaveCount(0)
  await inspector.getByRole('button', { name: 'Применить' }).click()
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
})

test('диалог «Настройки конфига» и DNS-форма', async ({ page }) => {
  await page.getByRole('button', { name: 'Настройки конфига' }).click()
  await page.getByLabel('Стратегия доменов (domainStrategy)').selectOption('IPIfNonMatch')
  await page.getByRole('button', { name: 'Закрыть настройки' }).click()
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()

  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="dns"]').click()
  await inspector.getByLabel('Стратегия запросов (queryStrategy)').selectOption('UseIPv4')
  await inspector.getByRole('button', { name: 'Применить' }).click()
  // dns-узел остаётся выбранным после применения (getNodeJson('dns') определён)
  await expect(page.locator('.react-flow__node[data-id="dns"]')).toBeVisible()
  await expect(inspector.getByText('dns', { exact: true })).toBeVisible()
})
```

- [ ] **Step 3: Прогон (если chromium установлен)**

Из корня: `npm run e2e -w frontend`
Если браузер не установлен: `cd frontend && npx playwright install chromium`, затем повторить. Если в окружении прогон невозможен (нет сети/браузера) — зафиксировать это в сообщении коммита не нужно, прогон повторяется в финальной задаче как опциональный шаг.
Ожидание: PASS всех файлов `e2e/` (editor, routing, forms).

- [ ] **Step 4: Коммит**

```bash
git add frontend/e2e/mocks.ts frontend/e2e/forms.spec.ts
git commit -m "test(frontend): e2e for protocol forms, compat matrix, dns and settings dialog" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Финальная проверка плана

**Files:** нет новых — только запуск проверок.

**Interfaces:**
- Consumes: всё из задач 1–10.
- Produces: зелёный полный прогон — фаза «полное UI-покрытие Xray» закрыта (все 4 плана).

- [ ] **Step 1: Полный прогон юнит-тестов фронтенда**

Из каталога `frontend`: `npm test`
Ожидание: PASS, 0 упавших (все существующие + новые из задач 1–9).

- [ ] **Step 2: Типы**

Из корня: `npm run typecheck -w frontend`
Ожидание: exit 0. (e2e-каталог не входит в include tsconfig — его typecheck не проверяет.)

- [ ] **Step 3: Тесты бэкенда не задеты**

Из корня: `npm test -w backend`
Ожидание: PASS (план бэкенд не трогает, прогон дешёвый).

- [ ] **Step 4 (опциональный, если окружение позволяет): e2e**

Перед первым запуском: `cd frontend && npx playwright install chromium` (скачивает браузер — нужна сеть).
Затем из корня: `npm run e2e -w frontend`
Ожидание: PASS. Если окружение без сети/браузера — шаг пропускается с явной пометкой в отчёте о выполнении плана; юнит-покрытие тех же форм остаётся обязательным (Step 1).

- [ ] **Step 5: Если что-то упало — починить и закоммитить фикс**

Формат коммита: `fix(frontend): <что именно>` (+ трейлер Co-Authored-By). Если всё зелёное сразу — коммит не нужен.

---

## Self-Review (сверка со спекой, секции 5–8)

**Секция 5 — протоколы:**

- ✅ **Inbound vless**: `fallbacks` (ListEditor: dest/path/alpn/name/xver — Task 3), `decryption` в «Продвинутых (VLESS)» (Task 3); клиентов инжектит панель — формы клиентов нет (сохранено).
- ✅ **Inbound trojan**: `fallbacks` общим рендером с vless (Task 3); клиенты — панель.
- ✅ **Inbound shadowsocks**: `network` tcp/udp/tcp,udp (Task 4).
- ✅ **Inbound hysteria2**: новый вариант протокола, шаблон `{ version: 2 }` (version фиксирован, в форме не редактируется), подсказка «нужен настоящий TLS-сертификат, Reality не используется» + отсылка к транспорту «Hysteria 2 (QUIC)» (сам транспорт сделан планом 3); клиентов инжектит панель (Task 4).
- ✅ **Sniffing полный**: `destOverride` (MultiSelect http/tls/quic/fakedns), `routeOnly`, `metadataOnly` — показываются при включённом sniffing (Task 4).
- ✅ **Outbound vless**: `vnext` (адрес/порт/uuid/flow/encryption) для цепочек нод; UUID опционален — может инжектить панель; `encryption: 'none'` в шаблоне новой карточки (Task 5).
- ✅ **Outbound socks/http**: `servers` (адрес/порт/users[0].user/pass) (Task 6). Заглушек «редактируется в JSON» в OutboundForm не осталось.
- ✅ **Outbound freedom**: `redirect`, `fragment` с пресетом `packets: "tlshello"` (Task 7).
- ✅ **Outbound blackhole**: `response.type` none/http (Task 7).
- ✅ **Outbound wireguard**: несколько peers (ListEditor, + `preSharedKey`/`keepAlive` на пира), `reserved` (число на строку → number[]), `domainStrategy` (ForceIP-семейство) (Task 7). Лейблы полей пира сохранены — существующие тесты и WARP-шаблон не задеты.
- ✅ **`mux` + `sendThrough`** в «Продвинутых (outbound)»; mux — только для vless/socks/http (Task 8).

**Секция 6 — DNS:**

- ✅ `DnsForm` для dns-узла графа: новый kind `dns` в NodeInspector (по аналогии с rule из плана 2), вкладки «Форма»/«JSON узла» (Task 9). Адресация — существующая: `getNodeJson/applyNodeJson` по nodeId `'dns'` отдают/пишут объект `config.dns` целиком; mutations и buildGraph не менялись.
- ✅ `servers` — ListEditor с двумя видами карточки (строка-адрес / объект address/port/domains/expectIPs), переключатель типа с переносом адреса; строковые серверы остаются строками в конфиге (kind-обёртка только в UI), неизвестные поля объектов сохраняются.
- ✅ `queryStrategy`, `hosts` (KeyValueField; записи-массивы не редактируются, но сохраняются — с пометкой про JSON), `tag`; `clientIp` — в «Продвинутых (DNS)».

**Секция 7 — валидация:**

- ✅ `analyzeIntegrity` расширен (Task 2) с переиспользованием готовых чистых функций: `securityNetworkIssue`/`flowNetworkIssue`/`hysteriaCertificateIssue` из `compat.ts` (план 3), `portSpecError`/`keywordEntries` — перенесены в `entities/xray/rules.ts` (Task 1) и реэкспортированы из RuleForm (тесты плана 2 зелёные без правок). Слоевое нарушение entities→features исключено.
- ✅ Проверки: security×network по inbound И outbound; flow×network (settings.flow у inbound vless + users[].flow в vnext у outbound vless); hysteria+tls без certificates; `sockopt.dialerProxy` и `rule.balancerTag` на несуществующий тег; домены без префикса; битый формат port/sourcePort правила.
- ✅ Вывод — существующий `IssueList` и gutter JSON (`validateXrayConfig` уже подключён в EditorPage/JsonView — проводки не потребовалось).
- ⚠️ Сознательное отклонение от спеки (зафиксировано в Global Constraints): висячие `dialerProxy`/`balancerTag` — `warning`, а не `error` — консистентно с существующими висячими ссылками правил и обещанием диалога удаления узла; матрица/flow/hysteria/порты — `error` (конфиг не запустится ядром; блокировка «Сохранить в панель» через существующий `hasErrors` — намеренная).

**Секция 8 — тестирование:**

- ✅ Vitest: перенос helpers (Task 1), каждое новое правило `analyzeIntegrity` — позитив и негатив (Task 2), round-trip форм с сохранением неизвестных полей (Task 3–9; напр. `unknownOpt` у dns-сервера, spread-мерж карточек ListEditor).
- ✅ Playwright: 4 сценария (Task 10) — правка правила формой, матрица транспорт/security + hysteria2-inbound, outbound vless + Reality (клиентские поля, отсутствие серверных кнопок генерации), диалог «Настройки конфига» + DNS-форма. Порядок правил формой покрыт юнит-тестами плана 2 (в моке одно правило — e2e-перестановка не добавлена сознательно, «не переусердствуй»).
- ✅ e2e-прогон вынесен в опциональные шаги (Task 10 Step 3, Task 11 Step 4) — требует `npx playwright install chromium`; юнит-прогон и typecheck обязательны.

**Консистентность паттернов:** patch `structuredClone` + `delete` при `undefined` — везде; опустевшие секции удаляются (`patchFragment`, `patchTop('mux')`, `fromCard`-мерж hosts); boolean false → undefined через CheckboxField; mount-only поля в карточках ListEditor — `key` с индексом и длиной (`fb-dest`, `domains`, `expectIPs`, `allowedIPs` + `warpFillCount`); «битая ссылка видима и снимаема» — dialerProxy/balancerTag подсвечиваются warning'ом, формы не переписывают конфиг молча; смена протокола чистит settings шаблоном (расширено на hysteria).

**Изменённые существующие тесты (оба — осознанно, семантика меняется по спеке):** `node-inspector.test.tsx` «для dns узла вкладок нет» → dns получает форму (Task 9); `outbound-form.test.tsx` «для socks показывает подсказку про JSON» → socks получает форму серверов (Task 6). `StatefulOutboundForm`/`StatefulStreamForm`-стиль обёрток расширен аддитивно (опциональный `onChange`).

**Новые зависимости:** нет. **Новые примитивы форм:** нет. **Изменения схем:** нет. **Новые модули:** `entities/xray/rules.ts` (чистый, без зависимостей), `features/inspector/DnsForm.tsx`, `e2e/forms.spec.ts`.

**Плейсхолдеры:** отсутствуют — каждый шаг содержит полный код или точную замену «заменить X на Y»; команды запуска и ожидания указаны в каждом шаге.
