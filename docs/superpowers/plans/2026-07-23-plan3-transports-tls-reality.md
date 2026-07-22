# План 3 «Транспорты и безопасность»: полный StreamForm, режимы inbound/outbound, TLS, Reality, sockopt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Полное UI-покрытие `streamSettings`: StreamForm получает режим `inbound`/`outbound` и подключается к OutboundForm; все транспорты (tcp/raw, ws, grpc, httpupgrade, xhttp, hysteria), TLS и Reality целиком с разведением серверных/клиентских полей, секция sockopt с `dialerProxy`-цепочками, матрица совместимости security×network зашита в select'ы с предупреждениями о несовместимых комбинациях.

**Architecture:** Три слоя. (1) `entities/xray/compat.ts` — новая чистая матрица совместимости (`allowedNetworks`, `allowedSecurities`, `securityNetworkIssue`, `flowNetworkIssue`, `hysteriaCertificateIssue`, `normalizeNetwork`), реэкспорт через `entities/xray/index.ts`: единый источник и для StreamForm (фильтрация select'ов, предупреждения), и для `analyzeIntegrity` плана 4 — как plan2 сделал с `portSpecError`. (2) `features/inspector/StreamForm.tsx` — расширяется, а не переписывается: сохраняется patch-паттерн (`structuredClone` + точечная мутация), генерация ключей Reality (`useRealityKeypair`/`useRealityPublicKey`), паттерн «редактируем существующий ключ-алиас» (`dest`/`target`, добавляется `tcpSettings`/`rawSettings`); появляются пропсы `mode` (дефолт `'inbound'` — обратная совместимость с InboundForm и существующими тестами), `flow` (для матрицы vision→raw) и `outboundTags` (для `dialerProxy`). (3) `features/inspector/OutboundForm.tsx` рендерит StreamForm с `mode="outbound"` для всех протоколов, кроме `wireguard` (streamSettings не поддерживает) и `blackhole` (бессмысленно); список тегов для `dialerProxy` прокидывается из `NodeInspector` (`config.outbounds`) через новый опциональный проп `outboundTags`, свой тег исключается в OutboundForm.

**Tech Stack:** React 19, vitest (jsdom) + @testing-library/react + userEvent, zod v3 (схемы плана 1 — `TlsSettingsSchema`/`RealitySettingsSchema`/транспорты/`SockoptSchema`/`FinalmaskSchema` уже полные, менять НЕ надо), CSS в `tokens.css` (новых классов не требуется — `.field-warning`/`.field-hint`/`.field-error` уже есть). Примитивы: `TextField`, `SelectField`, `NumberField`, `CheckboxField`, `MultiSelectField`, `StringListField`, `TagListField`, `KeyValueField`, `ListEditor`, `CollapsibleSection`.

**Спека:** `docs/superpowers/specs/2026-07-22-full-xray-ui-coverage-design.md` (секция 4 «Транспорты и безопасность»; секция 5 — в части streamSettings у outbound). Справочник матрицы: скилл `remnawave-xray` (`reference/transports.md`, `reference/xray-reality.md`).

## Global Constraints

- Язык UI-текстов и подсказок — русский; коммиты — английский conventional style (`feat(frontend): ...`) с трейлером `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Никаких новых npm-зависимостей и новых примитивов форм. `NumberField` и `TagListField` не имеют пропа `hint` — подсказки к числовым полям либо не нужны (описательный label), либо оформляются `<p className="muted">`; проп `hint` в примитивы НЕ добавлять.
- Схемы `entities/xray` НЕ меняются — все поля этого плана уже есть в `stream.ts` (план 1). Новый файл только один: `entities/xray/compat.ts` (+ строка реэкспорта в `index.ts`).
- Дефолт `mode = 'inbound'` у StreamForm обязателен: существующие вызовы из InboundForm и существующие тесты `stream-form.test.tsx` должны оставаться зелёными без правок семантики (тест-файл только дополняется; единственная правка существующего кода тестов — `StatefulStreamForm` получает опциональные пропсы `mode`, дефолт прежний).
- Матрица совместимости: несовместимые комбинации НЕ предлагаются в select'ах, но уже существующее в конфиге значение остаётся видимой опцией с пометкой «(несовместимо)» и предупреждением `.field-warning` под select'ом. Молча переписывать конфиг нельзя.
- Ключи-алиасы Xray: `network: 'raw'` = `'tcp'` (переименование v24.9.30), `tcpSettings`/`rawSettings`, `dest`/`target` — редактируем тот ключ, что уже есть в конфиге (паттерн `destKey` из текущего StreamForm).
- Формы не удаляют неизвестные поля: patch через `structuredClone(value)` + точечная мутация; `undefined` → `delete` ключа; опустевшая вложенная секция (`wsSettings`, `sockopt`, `finalmask.quicParams`, …) удаляется целиком (хелпер `patchSection`). Исключения: `realitySettings`/`tlsSettings` создаются пустыми при переключении security (текущее поведение, сохранить).
- boolean-поля: `false` → `undefined` (уже зашито в `CheckboxField`); пустые списки → `undefined` (зашито в `StringListField`/`MultiSelectField`/`KeyValueField`).
- Mount-only поля (`StringListField`, `KeyValueField`, `PortField`) читают value при монтировании. Ремоунт при смене узла гарантирован `key={selectedNode}` на NodeInspector в EditorPage; блоки транспорта/security монтируются заново при переключении network/security (условный рендер) — доп. key не нужен. Единственное исключение — `StringListField` внутри карточек `ListEditor` сертификатов: удаление карточки сдвигает индексы, поэтому key включает длину списка (`key={\`cert:${i}:${total}\`}`) — remount перечитывает буферы.
- Генерацию ключей Reality (`useRealityKeypair`/`useRealityPublicKey`, кнопки «Сгенерировать ключи»/«Публичный ключ», `derive.reset()`) не менять — блок переносится в inbound-ветку Reality как есть. Клиентский публичный ключ Reality в outbound-конфиге хранится в поле `password` (алиас `publicKey`, сверено со скиллом).
- Тесты — vitest (jsdom), файлы `frontend/test/*.test.{ts,tsx}`; запуск из каталога `frontend`: `npx vitest run test/<файл>`. Компоненты, содержащие StreamForm (InboundForm, OutboundForm, NodeInspector), требуют обёртки `QueryClientProvider` — в `outbound-form.test.tsx` её сейчас нет, Task 8 её добавляет. Playwright e2e — вне этого плана (сводный e2e — план 4).

---

### Task 1: Матрица совместимости `entities/xray/compat.ts`

**Files:**
- Create: `frontend/src/entities/xray/compat.ts`
- Modify: `frontend/src/entities/xray/index.ts`
- Test: `frontend/test/xray-compat.test.ts` (создать)

**Interfaces:**
- Consumes: ничего (чистые функции без зависимостей).
- Produces (всё реэкспортируется через `entities/xray/index.ts`):
  - `normalizeNetwork(network: string | undefined): string` — `'raw'` → `'tcp'`, `undefined` → `'tcp'`;
  - `ALL_NETWORKS: string[]` — все транспорты плана в нормализованных именах;
  - `allowedNetworks(security: string | undefined): string[]` — транспорты, допустимые при данном security (reality → только `tcp`/`xhttp`/`grpc`);
  - `allowedSecurities(network: string | undefined): string[]` — security, допустимые при данном транспорте (hysteria → только `tls`; ws/httpupgrade → без reality);
  - `securityNetworkIssue(security, network): string | null` — русское сообщение о несовместимости или `null`;
  - `flowNetworkIssue(flow, network): string | null` — `xtls-rprx-vision*` только поверх raw/tcp;
  - `hysteriaCertificateIssue(network, security, tlsSettings): string | null` — hysteria без `certificates` в tlsSettings.
- Task 6 подключает функции к select'ам StreamForm; план 4 переиспользует их в `analyzeIntegrity` (`entities/xray/config.ts`) — поэтому матрица живёт в `entities/xray`, а не в компоненте формы.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/xray-compat.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  allowedNetworks,
  allowedSecurities,
  flowNetworkIssue,
  hysteriaCertificateIssue,
  normalizeNetwork,
  securityNetworkIssue,
} from '../src/entities/xray'

describe('normalizeNetwork', () => {
  it('raw → tcp, отсутствие → tcp, остальное как есть', () => {
    expect(normalizeNetwork('raw')).toBe('tcp')
    expect(normalizeNetwork(undefined)).toBe('tcp')
    expect(normalizeNetwork('ws')).toBe('ws')
  })
})

describe('allowedNetworks', () => {
  it('reality — только tcp/xhttp/grpc', () => {
    expect(allowedNetworks('reality')).toEqual(['tcp', 'xhttp', 'grpc'])
  })

  it('tls и none — все транспорты', () => {
    expect(allowedNetworks('tls')).toContain('hysteria')
    expect(allowedNetworks('none')).toContain('ws')
    expect(allowedNetworks(undefined)).toContain('httpupgrade')
  })
})

describe('allowedSecurities', () => {
  it('hysteria — только tls', () => {
    expect(allowedSecurities('hysteria')).toEqual(['tls'])
  })

  it('ws и httpupgrade — без reality', () => {
    expect(allowedSecurities('ws')).toEqual(['none', 'tls'])
    expect(allowedSecurities('httpupgrade')).toEqual(['none', 'tls'])
  })

  it('tcp, raw, grpc, xhttp — все три', () => {
    expect(allowedSecurities('tcp')).toEqual(['none', 'tls', 'reality'])
    expect(allowedSecurities('raw')).toEqual(['none', 'tls', 'reality'])
    expect(allowedSecurities('grpc')).toEqual(['none', 'tls', 'reality'])
    expect(allowedSecurities('xhttp')).toEqual(['none', 'tls', 'reality'])
  })
})

describe('securityNetworkIssue', () => {
  it('совместимые пары — null', () => {
    expect(securityNetworkIssue('reality', 'tcp')).toBeNull()
    expect(securityNetworkIssue('reality', 'raw')).toBeNull()
    expect(securityNetworkIssue('reality', 'grpc')).toBeNull()
    expect(securityNetworkIssue('reality', 'xhttp')).toBeNull()
    expect(securityNetworkIssue('tls', 'ws')).toBeNull()
    expect(securityNetworkIssue(undefined, 'ws')).toBeNull()
  })

  it('reality поверх ws/httpupgrade/hysteria — русское сообщение', () => {
    expect(securityNetworkIssue('reality', 'ws')).toMatch(/Reality несовместим/)
    expect(securityNetworkIssue('reality', 'httpupgrade')).toMatch(/Reality несовместим/)
    expect(securityNetworkIssue('reality', 'hysteria')).toMatch(/Reality несовместим/)
  })

  it('hysteria без tls — сообщение; с tls — null', () => {
    expect(securityNetworkIssue('none', 'hysteria')).toMatch(/hysteria требует/)
    expect(securityNetworkIssue(undefined, 'hysteria')).toMatch(/hysteria требует/)
    expect(securityNetworkIssue('tls', 'hysteria')).toBeNull()
  })
})

describe('flowNetworkIssue', () => {
  it('vision поверх raw/tcp — ок; поверх остальных — сообщение', () => {
    expect(flowNetworkIssue('xtls-rprx-vision', 'tcp')).toBeNull()
    expect(flowNetworkIssue('xtls-rprx-vision', 'raw')).toBeNull()
    expect(flowNetworkIssue('xtls-rprx-vision', 'ws')).toMatch(/только поверх raw/)
    expect(flowNetworkIssue('xtls-rprx-vision-udp443', 'grpc')).toMatch(/только поверх raw/)
  })

  it('без flow — всегда null', () => {
    expect(flowNetworkIssue(undefined, 'ws')).toBeNull()
    expect(flowNetworkIssue('', 'ws')).toBeNull()
  })
})

describe('hysteriaCertificateIssue', () => {
  it('hysteria + tls без certificates — сообщение', () => {
    expect(hysteriaCertificateIssue('hysteria', 'tls', {})).toMatch(/сертификат/)
    expect(hysteriaCertificateIssue('hysteria', 'tls', undefined)).toMatch(/сертификат/)
    expect(hysteriaCertificateIssue('hysteria', 'tls', { certificates: [] })).toMatch(/сертификат/)
  })

  it('с certificates — null; не-hysteria и не-tls — null (покрыто securityNetworkIssue)', () => {
    expect(hysteriaCertificateIssue('hysteria', 'tls', { certificates: [{}] })).toBeNull()
    expect(hysteriaCertificateIssue('tcp', 'tls', {})).toBeNull()
    expect(hysteriaCertificateIssue('hysteria', 'none', {})).toBeNull()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/xray-compat.test.ts`
Ожидание: FAIL — имена не экспортируются из `../src/entities/xray` (ошибка импорта).

- [ ] **Step 3: Реализация**

Создать `frontend/src/entities/xray/compat.ts`:

```ts
// Матрица совместимости security × network — жёсткое ограничение ядра Xray.
// Единый источник и для форм (фильтрация select'ов, предупреждения), и для
// analyzeIntegrity (план 4). Сверено со справочником remnawave-xray:
//   reality — только raw(tcp)/xhttp/grpc; flow vision — только raw;
//   network hysteria — только tls с настоящим сертификатом.

/** 'raw' — новое имя 'tcp' (Xray v24.9.30); в хранимых конфигах встречаются оба */
export function normalizeNetwork(network: string | undefined): string {
  const n = network ?? 'tcp'
  return n === 'raw' ? 'tcp' : n
}

export const ALL_NETWORKS = ['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp', 'hysteria']

const REALITY_NETWORKS = ['tcp', 'xhttp', 'grpc']

/** Транспорты, допустимые при данном security (нормализованные имена) */
export function allowedNetworks(security: string | undefined): string[] {
  if (security === 'reality') return [...REALITY_NETWORKS]
  return [...ALL_NETWORKS]
}

/** Security, допустимые при данном транспорте */
export function allowedSecurities(network: string | undefined): string[] {
  const n = normalizeNetwork(network)
  if (n === 'hysteria') return ['tls']
  if (REALITY_NETWORKS.includes(n)) return ['none', 'tls', 'reality']
  return ['none', 'tls']
}

/** null — совместимо; иначе русское сообщение для предупреждения формы / IssueList */
export function securityNetworkIssue(
  security: string | undefined,
  network: string | undefined,
): string | null {
  const n = normalizeNetwork(network)
  const sec = security ?? 'none'
  if (sec === 'reality' && !REALITY_NETWORKS.includes(n)) {
    return `Reality несовместим с транспортом «${n}» — допустимы только raw (tcp), xhttp и grpc`
  }
  if (n === 'hysteria' && sec !== 'tls') {
    return 'Транспорт hysteria требует security «tls» с настоящим сертификатом'
  }
  return null
}

/** flow xtls-rprx-vision (и -udp443) работает только поверх raw (tcp) */
export function flowNetworkIssue(
  flow: string | undefined,
  network: string | undefined,
): string | null {
  if (!flow || !flow.startsWith('xtls-rprx-vision')) return null
  if (normalizeNetwork(network) !== 'tcp') {
    return `Flow «${flow}» работает только поверх raw (tcp) — уберите flow или смените транспорт`
  }
  return null
}

/** Транспорт hysteria без TLS-сертификатов не стартует (Reality тут не используется) */
export function hysteriaCertificateIssue(
  network: string | undefined,
  security: string | undefined,
  tlsSettings: { certificates?: unknown[] } | undefined,
): string | null {
  if (normalizeNetwork(network) !== 'hysteria') return null
  if ((security ?? 'none') !== 'tls') return null // это уже поймал securityNetworkIssue
  if ((tlsSettings?.certificates?.length ?? 0) === 0) {
    return 'Для hysteria нужен настоящий TLS-сертификат — добавьте certificates в tlsSettings'
  }
  return null
}
```

В `frontend/src/entities/xray/index.ts` добавить первой строкой:

```ts
export * from './compat'
```

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/xray-compat.test.ts` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/compat.ts frontend/src/entities/xray/index.ts frontend/test/xray-compat.test.ts
git commit -m "feat(frontend): security-network compatibility matrix in xray entities" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: StreamForm — проп `mode` + полные транспорты ws/grpc/httpupgrade/xhttp/tcp

**Files:**
- Modify: `frontend/src/features/inspector/StreamForm.tsx` (полная перезапись)
- Test: `frontend/test/stream-form.test.tsx` (дополнить; существующие тесты не менять по смыслу)

**Interfaces:**
- Consumes: `KeyValueField` из `collections.tsx`; `CheckboxField`, `NumberField` из `fields.tsx`; `CollapsibleSection` из `shared/ui`.
- Produces: `StreamForm({ value, onChange, mode?: 'inbound' | 'outbound' })`, дефолт `mode='inbound'` — существующие вызовы из InboundForm и тесты не задеты. Экспорт `StreamFormMode`. Хелпер `patchSection(key, mut)` — правка вложенной секции с удалением опустевшей (Task 3–7 строят на нём). Транспортные поля: ws (`path`, `host`, `heartbeatPeriod`, `headers`), grpc (`serviceName`, `authority`, `multiMode`), httpupgrade (`path`, `host`, `headers`), xhttp (`path`, `host`, `mode`; `extra` — пометка про JSON), tcp/raw (`acceptProxyProtocol` в «Продвинутых», только inbound, с алиасом `tcpSettings`/`rawSettings`). Блоки TLS и Reality в этой задаче переносятся без изменений (их доводят Task 3–4).

- [ ] **Step 1: Написать падающий тест**

В `frontend/test/stream-form.test.tsx`:

1. Заменить компонент `StatefulStreamForm` на (добавился опциональный `mode`, `onChange` стал опциональным):

```tsx
// Обёртка-родитель как в реальном приложении: эхо-ит onChange обратно в value через useState
// (см. StatefulOutboundForm в outbound-form.test.tsx) — StreamForm является controlled-компонентом,
// поэтому без эха value каждый keystroke откатывается к неизменному пропу.
function StatefulStreamForm({
  initial,
  onChange,
  mode,
}: {
  initial: Record<string, unknown>
  onChange?: (next: Record<string, unknown>) => void
  mode?: 'inbound' | 'outbound'
}) {
  const [value, setValue] = useState(initial)
  const handleChange = (next: Record<string, unknown>) => {
    setValue(next)
    onChange?.(next)
  }
  return <StreamForm value={value} onChange={handleChange} mode={mode} />
}
```

2. Добавить в конец файла:

```tsx
describe('StreamForm — транспорты полностью', () => {
  it('ws: host, heartbeat и headers пишутся в wsSettings', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'ws', security: 'none' }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Host'), 'cdn.example.com')
    await userEvent.type(screen.getByLabelText('Heartbeat (сек)'), '30')
    await userEvent.click(screen.getByText('+ Пара'))
    await userEvent.type(screen.getByPlaceholderText('Ключ'), 'X-Token')
    await userEvent.type(screen.getByPlaceholderText('Значение'), 'abc')
    const next = onChange.mock.lastCall![0] as { wsSettings: Record<string, unknown> }
    expect(next.wsSettings.host).toBe('cdn.example.com')
    expect(next.wsSettings.heartbeatPeriod).toBe(30)
    expect(next.wsSettings.headers).toEqual({ 'X-Token': 'abc' })
  })

  it('ws: очистка последнего поля удаляет wsSettings целиком', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'ws', security: 'none', wsSettings: { path: '/a' } }} onChange={onChange} />)
    await userEvent.clear(screen.getByLabelText('Путь WebSocket'))
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.wsSettings).toBeUndefined()
  })

  it('grpc: authority и multiMode', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'grpc', security: 'none' }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Authority'), 'cdn.example.com')
    await userEvent.click(screen.getByLabelText('multiMode'))
    const next = onChange.mock.lastCall![0] as { grpcSettings: Record<string, unknown> }
    expect(next.grpcSettings.authority).toBe('cdn.example.com')
    expect(next.grpcSettings.multiMode).toBe(true)
  })

  it('httpupgrade: host и headers', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'httpupgrade', security: 'none' }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Host'), 'front.example.com')
    await userEvent.click(screen.getByText('+ Пара'))
    await userEvent.type(screen.getByPlaceholderText('Ключ'), 'X-A')
    await userEvent.type(screen.getByPlaceholderText('Значение'), '1')
    const next = onChange.mock.lastCall![0] as { httpupgradeSettings: Record<string, unknown> }
    expect(next.httpupgradeSettings.host).toBe('front.example.com')
    expect(next.httpupgradeSettings.headers).toEqual({ 'X-A': '1' })
  })

  it('xhttp: путь и режим; extra остаётся в JSON с пометкой', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'xhttp', security: 'none' }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Путь XHTTP'), '/api/data')
    await userEvent.selectOptions(screen.getByLabelText('Режим (mode)'), 'packet-up')
    const next = onChange.mock.lastCall![0] as { xhttpSettings: Record<string, unknown> }
    expect(next.xhttpSettings.path).toBe('/api/data')
    expect(next.xhttpSettings.mode).toBe('packet-up')
    expect(screen.getByText(/спека XHTTP нестабильна/)).toBeInTheDocument()
  })

  it('tcp inbound: acceptProxyProtocol в «Продвинутых»; пишет в tcpSettings', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'tcp', security: 'none' }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(транспорт\)/ }))
    await userEvent.click(screen.getByLabelText('Принимать PROXY protocol'))
    const next = onChange.mock.lastCall![0] as { tcpSettings: Record<string, unknown> }
    expect(next.tcpSettings).toEqual({ acceptProxyProtocol: true })
  })

  it('tcp: rawSettings-алиас — правка пишет в существующий ключ, tcpSettings не создаётся', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'none', rawSettings: { header: { type: 'none' } } }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(транспорт\)/ }))
    await userEvent.click(screen.getByLabelText('Принимать PROXY protocol'))
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.rawSettings).toEqual({ header: { type: 'none' }, acceptProxyProtocol: true })
    expect(next.tcpSettings).toBeUndefined()
  })

  it('tcp в outbound-режиме: блока «Продвинутые (транспорт)» нет', () => {
    wrap(<StreamForm value={{ network: 'tcp', security: 'none' }} onChange={vi.fn()} mode="outbound" />)
    expect(screen.queryByText(/Продвинутые \(транспорт\)/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/stream-form.test.tsx`
Ожидание: FAIL — TS не знает проп `mode`; полей `Host`/`Authority`/`Режим (mode)` нет в разметке. Существующие тесты остаются зелёными.

- [ ] **Step 3: Реализация**

Заменить содержимое `frontend/src/features/inspector/StreamForm.tsx` целиком на:

```tsx
import { Button, CollapsibleSection } from '../../shared/ui'
import { randomShortId } from '../../entities/xray/generate'
import { useRealityKeypair, useRealityPublicKey } from '../../shared/api'
import { KeyValueField } from './collections'
import {
  CheckboxField,
  NumberField,
  SelectField,
  StringListField,
  TagListField,
  TextField,
  type Option,
} from './fields'

type Obj = Record<string, unknown>

const NETWORKS: Option[] = [
  { value: 'tcp', label: 'TCP (raw)' },
  { value: 'ws', label: 'WebSocket' },
  { value: 'grpc', label: 'gRPC' },
  { value: 'httpupgrade', label: 'HTTPUpgrade' },
  { value: 'xhttp', label: 'XHTTP' },
]

const SECURITIES: Option[] = [
  { value: 'none', label: 'Без шифрования' },
  { value: 'tls', label: 'TLS' },
  { value: 'reality', label: 'Reality' },
]

const FINGERPRINTS: Option[] = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random', 'randomized'].map(
  (v) => ({ value: v, label: v }),
)

const XHTTP_MODES: Option[] = [
  { value: '', label: 'auto (по умолчанию)' },
  { value: 'packet-up', label: 'packet-up' },
  { value: 'stream-up', label: 'stream-up' },
  { value: 'stream-one', label: 'stream-one' },
]

export type StreamFormMode = 'inbound' | 'outbound'

interface Props {
  value: Obj // streamSettings целиком
  onChange: (next: Obj) => void
  /** inbound — серверные поля (дефолт, сохраняет прежнее поведение), outbound — клиентские */
  mode?: StreamFormMode
}

export function StreamForm({ value, onChange, mode = 'inbound' }: Props) {
  const keypair = useRealityKeypair()
  const derive = useRealityPublicKey()
  const network = (value.network as string) ?? 'tcp'
  const security = (value.security as string) ?? 'none'
  const reality = (value.realitySettings as Obj) ?? {}
  const tls = (value.tlsSettings as Obj) ?? {}
  const ws = (value.wsSettings as Obj) ?? {}
  const grpc = (value.grpcSettings as Obj) ?? {}
  const upgrade = (value.httpupgradeSettings as Obj) ?? {}
  const xhttp = (value.xhttpSettings as Obj) ?? {}
  // Xray понимает и tcpSettings, и rawSettings (network tcp→raw) — редактируем тот ключ, что уже есть
  const tcpKey = 'rawSettings' in value ? 'rawSettings' : 'tcpSettings'
  const tcp = (value[tcpKey] as Obj) ?? {}

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  // Правка вложенной секции (wsSettings, tcpSettings, sockopt, ...);
  // опустевшая секция удаляется целиком — не оставляем в JSON висящие "{}"
  function patchSection(key: string, mut: (s: Obj) => void) {
    patch((next) => {
      const s = (next[key] as Obj) ?? {}
      mut(s)
      if (Object.keys(s).length === 0) delete next[key]
      else next[key] = s
    })
  }

  function patchReality(mut: (r: Obj) => void) {
    patch((next) => {
      const r = (next.realitySettings as Obj) ?? {}
      mut(r)
      next.realitySettings = r
    })
  }

  // Xray ≥24.09 понимает и dest, и target — редактируем тот ключ, что уже есть
  const destKey = 'target' in reality ? 'target' : 'dest'
  const shownPublicKey = derive.data?.publicKey ?? keypair.data?.publicKey

  return (
    <>
      <SelectField label="Транспорт" value={network} options={NETWORKS} onChange={(v) => patch((n) => { n.network = v })} />
      <SelectField
        label="Шифрование"
        value={security}
        options={SECURITIES}
        onChange={(v) =>
          patch((n) => {
            n.security = v
            if (v === 'reality' && n.realitySettings === undefined) n.realitySettings = {}
            if (v === 'tls' && n.tlsSettings === undefined) n.tlsSettings = {}
          })
        }
      />

      {network === 'ws' && (
        <>
          <TextField
            label="Путь WebSocket"
            mono
            placeholder="/ws"
            value={ws.path as string | undefined}
            onChange={(v) => patchSection('wsSettings', (s) => { if (v === undefined) delete s.path; else s.path = v })}
          />
          <TextField
            label="Host"
            mono
            hint="Заголовок Host; за CDN — домен фронта"
            value={ws.host as string | undefined}
            onChange={(v) => patchSection('wsSettings', (s) => { if (v === undefined) delete s.host; else s.host = v })}
          />
          <NumberField
            label="Heartbeat (сек)"
            placeholder="0"
            value={ws.heartbeatPeriod as number | undefined}
            onChange={(v) =>
              patchSection('wsSettings', (s) => { if (v === undefined) delete s.heartbeatPeriod; else s.heartbeatPeriod = v })
            }
          />
          <KeyValueField
            label="Заголовки (headers)"
            hint="Дополнительные HTTP-заголовки; отправляет клиент"
            value={ws.headers as Record<string, string> | undefined}
            onChange={(v) => patchSection('wsSettings', (s) => { if (v === undefined) delete s.headers; else s.headers = v })}
          />
        </>
      )}

      {network === 'grpc' && (
        <>
          <TextField
            label="Имя gRPC-сервиса"
            mono
            value={grpc.serviceName as string | undefined}
            onChange={(v) =>
              patchSection('grpcSettings', (s) => { if (v === undefined) delete s.serviceName; else s.serviceName = v })
            }
          />
          <TextField
            label="Authority"
            mono
            hint="Псевдозаголовок :authority — обычно домен за CDN"
            value={grpc.authority as string | undefined}
            onChange={(v) =>
              patchSection('grpcSettings', (s) => { if (v === undefined) delete s.authority; else s.authority = v })
            }
          />
          <CheckboxField
            label="multiMode"
            hint="Несколько потоков данных в одном gRPC-соединении (экспериментально)"
            value={grpc.multiMode as boolean | undefined}
            onChange={(v) =>
              patchSection('grpcSettings', (s) => { if (v === undefined) delete s.multiMode; else s.multiMode = v })
            }
          />
        </>
      )}

      {network === 'httpupgrade' && (
        <>
          <TextField
            label="Путь HTTPUpgrade"
            mono
            placeholder="/upgrade"
            value={upgrade.path as string | undefined}
            onChange={(v) =>
              patchSection('httpupgradeSettings', (s) => { if (v === undefined) delete s.path; else s.path = v })
            }
          />
          <TextField
            label="Host"
            mono
            hint="Заголовок Host; за CDN — домен фронта"
            value={upgrade.host as string | undefined}
            onChange={(v) =>
              patchSection('httpupgradeSettings', (s) => { if (v === undefined) delete s.host; else s.host = v })
            }
          />
          <KeyValueField
            label="Заголовки (headers)"
            hint="Дополнительные HTTP-заголовки; отправляет клиент"
            value={upgrade.headers as Record<string, string> | undefined}
            onChange={(v) =>
              patchSection('httpupgradeSettings', (s) => { if (v === undefined) delete s.headers; else s.headers = v })
            }
          />
        </>
      )}

      {network === 'xhttp' && (
        <>
          <TextField
            label="Путь XHTTP"
            mono
            placeholder="/api/data"
            value={xhttp.path as string | undefined}
            onChange={(v) => patchSection('xhttpSettings', (s) => { if (v === undefined) delete s.path; else s.path = v })}
          />
          <TextField
            label="Host"
            mono
            hint="Домен CDN-фронта"
            value={xhttp.host as string | undefined}
            onChange={(v) => patchSection('xhttpSettings', (s) => { if (v === undefined) delete s.host; else s.host = v })}
          />
          <SelectField
            label="Режим (mode)"
            value={(xhttp.mode as string) ?? ''}
            options={XHTTP_MODES}
            onChange={(v) => patchSection('xhttpSettings', (s) => { if (v === '') delete s.mode; else s.mode = v })}
          />
          <p className="muted" style={{ margin: 0 }}>
            Поле extra (xmux, padding) редактируется на вкладке «JSON узла» — спека XHTTP нестабильна.
          </p>
        </>
      )}

      {(network === 'tcp' || network === 'raw') && mode === 'inbound' && (
        <CollapsibleSection title="Продвинутые (транспорт)">
          <CheckboxField
            label="Принимать PROXY protocol"
            hint="acceptProxyProtocol — реальный IP клиента от реверс-прокси перед Xray"
            value={tcp.acceptProxyProtocol as boolean | undefined}
            onChange={(v) =>
              patchSection(tcpKey, (s) => { if (v === undefined) delete s.acceptProxyProtocol; else s.acceptProxyProtocol = v })
            }
          />
        </CollapsibleSection>
      )}

      {security === 'tls' && (
        <>
          <TextField
            label="Имя сервера (SNI)"
            mono
            value={tls.serverName as string | undefined}
            onChange={(v) => patch((n) => { n.tlsSettings = { ...((n.tlsSettings as Obj) ?? {}), serverName: v } })}
          />
          <p className="muted" style={{ margin: 0 }}>Сертификаты настраиваются на вкладке «JSON узла».</p>
        </>
      )}

      {security === 'reality' && (
        <>
          <TextField
            label="Цель маскировки (dest)"
            mono
            placeholder="yahoo.com:443"
            value={reality[destKey] === undefined ? undefined : String(reality[destKey])}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r[destKey]; else r[destKey] = v })}
          />
          <StringListField
            label="Имена серверов (serverNames)"
            placeholder={'yahoo.com\nwww.yahoo.com'}
            value={reality.serverNames as string[] | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.serverNames; else r.serverNames = v })}
          />
          <TextField
            label="Приватный ключ"
            mono
            value={reality.privateKey as string | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.privateKey; else r.privateKey = v })}
          />
          <div className="row">
            <Button
              disabled={keypair.isPending}
              onClick={() => {
                // Сбрасываем прежний derive — иначе его устаревший pbk перекрыл бы ключ новой пары
                derive.reset()
                keypair.mutate(undefined, {
                  onSuccess: (keys) => patchReality((r) => { r.privateKey = keys.privateKey }),
                })
              }}
            >
              Сгенерировать ключи
            </Button>
            <Button
              variant="ghost"
              disabled={derive.isPending || !reality.privateKey}
              onClick={() => derive.mutate(reality.privateKey as string)}
            >
              Публичный ключ
            </Button>
          </div>
          {shownPublicKey && (
            <p className="mono" style={{ fontSize: 12, wordBreak: 'break-all', margin: 0 }}>
              pbk: {shownPublicKey}
            </p>
          )}
          {(keypair.isError || derive.isError) && (
            <span className="field-error">{((keypair.error ?? derive.error) as Error).message}</span>
          )}
          <TagListField
            label="Короткие ID (shortIds)"
            addLabel="+ ID"
            value={reality.shortIds as string[] | undefined}
            onAdd={() => patchReality((r) => { r.shortIds = [...((r.shortIds as string[]) ?? []), randomShortId()] })}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.shortIds; else r.shortIds = v })}
          />
          <SelectField
            label="Отпечаток (fingerprint)"
            value={(reality.fingerprint as string) ?? 'chrome'}
            options={FINGERPRINTS}
            onChange={(v) => patchReality((r) => { r.fingerprint = v })}
          />
        </>
      )}
    </>
  )
}
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/stream-form.test.tsx test/inbound-form.test.tsx test/node-inspector.test.tsx` — PASS (старые тесты StreamForm работают через дефолт `mode='inbound'`, InboundForm пропсы не менялись).

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/StreamForm.tsx frontend/test/stream-form.test.tsx
git commit -m "feat(frontend): stream form mode prop and full transport fields" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: StreamForm — TLS целиком (серверные vs клиентские поля)

**Files:**
- Modify: `frontend/src/features/inspector/StreamForm.tsx`
- Test: `frontend/test/stream-form.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `patchSection` (Task 2), `MultiSelectField`, `ListEditor`, `CollapsibleSection`, схема `TlsSettingsSchema` (поля уже полные — план 1).
- Produces: TLS-блок: оба режима — `serverName`, `alpn` (MultiSelect h2/http\/1.1/h3); только outbound — `fingerprint` (uTLS, клиентское поле); только inbound — `certificates` (ListEditor: `certificateFile`/`keyFile` ИЛИ inline `certificate[]`/`key[]` построчно) и «Продвинутые (TLS)» (`minVersion`, `maxVersion`, `rejectUnknownSni`). `allowInsecure` сознательно отсутствует (выпилен из свежих ядер). Подсказка «Сертификаты настраиваются на вкладке „JSON узла“» удаляется.

- [ ] **Step 1: Написать падающий тест**

Дополнить `frontend/test/stream-form.test.tsx` в конец файла:

```tsx
describe('StreamForm — TLS целиком', () => {
  it('inbound: alpn чипами, rejectUnknownSni в «Продвинутых (TLS)»', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'tcp', security: 'tls', tlsSettings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'h2' }))
    expect((onChange.mock.lastCall![0] as { tlsSettings: Record<string, unknown> }).tlsSettings).toEqual({ alpn: ['h2'] })
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(TLS\)/ }))
    await userEvent.click(screen.getByLabelText('Отклонять неизвестный SNI (rejectUnknownSni)'))
    const next = onChange.mock.lastCall![0] as { tlsSettings: Record<string, unknown> }
    expect(next.tlsSettings).toEqual({ alpn: ['h2'], rejectUnknownSni: true })
  })

  it('inbound: минимальная версия TLS выбирается в «Продвинутых (TLS)»', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'tcp', security: 'tls', tlsSettings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(TLS\)/ }))
    await userEvent.selectOptions(screen.getByLabelText('Мин. версия TLS'), '1.3')
    const next = onChange.mock.lastCall![0] as { tlsSettings: Record<string, unknown> }
    expect(next.tlsSettings).toEqual({ minVersion: '1.3' })
  })

  it('inbound: сертификаты через ListEditor — файловые пути', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'tcp', security: 'tls', tlsSettings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Сертификат'))
    await userEvent.type(screen.getByLabelText('Файл сертификата (certificateFile)'), '/etc/ssl/cert.pem')
    await userEvent.type(screen.getByLabelText('Файл ключа (keyFile)'), '/etc/ssl/key.pem')
    const next = onChange.mock.lastCall![0] as { tlsSettings: { certificates: Record<string, unknown>[] } }
    expect(next.tlsSettings.certificates).toHaveLength(1)
    expect(next.tlsSettings.certificates[0]!.certificateFile).toBe('/etc/ssl/cert.pem')
    expect(next.tlsSettings.certificates[0]!.keyFile).toBe('/etc/ssl/key.pem')
  })

  it('inbound: inline-PEM пишется массивом строк', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'tls', tlsSettings: { certificates: [{}] } }}
        onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('Сертификат (PEM, построчно)'), '-----BEGIN CERTIFICATE-----\nAAA')
    const next = onChange.mock.lastCall![0] as { tlsSettings: { certificates: Record<string, unknown>[] } }
    expect(next.tlsSettings.certificates[0]!.certificate).toEqual(['-----BEGIN CERTIFICATE-----', 'AAA'])
  })

  it('outbound: fingerprint есть, сертификаты и серверные поля отсутствуют', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'tls', tlsSettings: {} }}
        onChange={onChange}
        mode="outbound"
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Отпечаток (fingerprint)'), 'chrome')
    const next = onChange.mock.lastCall![0] as { tlsSettings: Record<string, unknown> }
    expect(next.tlsSettings).toEqual({ fingerprint: 'chrome' })
    expect(screen.queryByText('+ Сертификат')).not.toBeInTheDocument()
    expect(screen.queryByText(/Продвинутые \(TLS\)/)).not.toBeInTheDocument()
  })

  it('очистка SNI удаляет ключ, опустевший tlsSettings удаляется целиком', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'tls', tlsSettings: { serverName: 'a.com' } }}
        onChange={onChange}
      />,
    )
    await userEvent.clear(screen.getByLabelText('Имя сервера (SNI)'))
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.tlsSettings).toBeUndefined()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/stream-form.test.tsx`
Ожидание: FAIL — полей ALPN/fingerprint/сертификатов нет в разметке.

- [ ] **Step 3: Реализация**

В `frontend/src/features/inspector/StreamForm.tsx`:

1. Расширить импорты:

```tsx
import { KeyValueField, ListEditor } from './collections'
import {
  CheckboxField,
  MultiSelectField,
  NumberField,
  SelectField,
  StringListField,
  TagListField,
  TextField,
  type Option,
} from './fields'
```

2. Добавить константы после `XHTTP_MODES`:

```tsx
const ALPN_OPTIONS: Option[] = ['h2', 'http/1.1', 'h3'].map((v) => ({ value: v, label: v }))

const TLS_VERSIONS: Option[] = [
  { value: '', label: 'не задана' },
  { value: '1.0', label: '1.0' },
  { value: '1.1', label: '1.1' },
  { value: '1.2', label: '1.2' },
  { value: '1.3', label: '1.3' },
]
```

3. Заменить весь блок `{security === 'tls' && ( ... )}` на:

```tsx
      {security === 'tls' && (
        <>
          <TextField
            label="Имя сервера (SNI)"
            mono
            value={tls.serverName as string | undefined}
            onChange={(v) =>
              patchSection('tlsSettings', (s) => { if (v === undefined) delete s.serverName; else s.serverName = v })
            }
          />
          <MultiSelectField
            label="ALPN"
            hint="Пусто — дефолт ядра (h2, http/1.1)"
            options={ALPN_OPTIONS}
            value={tls.alpn as string[] | undefined}
            onChange={(v) => patchSection('tlsSettings', (s) => { if (v === undefined) delete s.alpn; else s.alpn = v })}
          />
          {mode === 'outbound' && (
            <SelectField
              label="Отпечаток (fingerprint)"
              hint="uTLS-профиль клиентского ClientHello"
              value={(tls.fingerprint as string) ?? ''}
              options={[{ value: '', label: 'не задан' }, ...FINGERPRINTS]}
              onChange={(v) =>
                patchSection('tlsSettings', (s) => { if (v === '') delete s.fingerprint; else s.fingerprint = v })
              }
            />
          )}
          {mode === 'inbound' && (
            <>
              <ListEditor<Obj>
                label="Сертификаты"
                hint="Файловые пути ИЛИ inline-PEM построчно"
                value={tls.certificates as Obj[] | undefined}
                onChange={(v) =>
                  patchSection('tlsSettings', (s) => { if (v === undefined) delete s.certificates; else s.certificates = v })
                }
                createItem={() => ({})}
                addLabel="+ Сертификат"
                renderItem={(item, update, i) => {
                  const total = (tls.certificates as Obj[] | undefined)?.length ?? 0
                  return (
                    <>
                      <TextField
                        label="Файл сертификата (certificateFile)"
                        mono
                        placeholder="/etc/ssl/cert.pem"
                        value={item.certificateFile as string | undefined}
                        onChange={(v) => update({ certificateFile: v })}
                      />
                      <TextField
                        label="Файл ключа (keyFile)"
                        mono
                        placeholder="/etc/ssl/key.pem"
                        value={item.keyFile as string | undefined}
                        onChange={(v) => update({ keyFile: v })}
                      />
                      {/* Mount-only буфер StringListField: удаление карточки сдвигает индексы,
                          key с длиной списка remount'ит поля, чтобы буферы перечитали значения */}
                      <StringListField
                        key={`cert:${i}:${total}`}
                        label="Сертификат (PEM, построчно)"
                        placeholder="-----BEGIN CERTIFICATE-----"
                        value={item.certificate as string[] | undefined}
                        onChange={(v) => update({ certificate: v })}
                      />
                      <StringListField
                        key={`key:${i}:${total}`}
                        label="Ключ (PEM, построчно)"
                        placeholder="-----BEGIN PRIVATE KEY-----"
                        value={item.key as string[] | undefined}
                        onChange={(v) => update({ key: v })}
                      />
                    </>
                  )
                }}
              />
              <CollapsibleSection title="Продвинутые (TLS)">
                <SelectField
                  label="Мин. версия TLS"
                  value={(tls.minVersion as string) ?? ''}
                  options={TLS_VERSIONS}
                  onChange={(v) =>
                    patchSection('tlsSettings', (s) => { if (v === '') delete s.minVersion; else s.minVersion = v })
                  }
                />
                <SelectField
                  label="Макс. версия TLS"
                  value={(tls.maxVersion as string) ?? ''}
                  options={TLS_VERSIONS}
                  onChange={(v) =>
                    patchSection('tlsSettings', (s) => { if (v === '') delete s.maxVersion; else s.maxVersion = v })
                  }
                />
                <CheckboxField
                  label="Отклонять неизвестный SNI (rejectUnknownSni)"
                  hint="Соединения с SNI вне certificates разрываются"
                  value={tls.rejectUnknownSni as boolean | undefined}
                  onChange={(v) =>
                    patchSection('tlsSettings', (s) => {
                      if (v === undefined) delete s.rejectUnknownSni
                      else s.rejectUnknownSni = v
                    })
                  }
                />
              </CollapsibleSection>
            </>
          )}
        </>
      )}
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/stream-form.test.tsx test/inbound-form.test.tsx` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/StreamForm.tsx frontend/test/stream-form.test.tsx
git commit -m "feat(frontend): full tls settings in stream form" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: StreamForm — Reality целиком (mode-разведение, генерация ключей сохранена)

**Files:**
- Modify: `frontend/src/features/inspector/StreamForm.tsx`
- Test: `frontend/test/stream-form.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `patchReality`, `destKey`, блок генерации ключей (Task 2 перенёс без изменений), `NumberField`, `CheckboxField`, `CollapsibleSection`.
- Produces: Reality-блок разведён по режимам. Inbound (серверные): `dest`/`target`, `serverNames`, `privateKey` + кнопки генерации + pbk (всё как было), `shortIds`, новое `xver` (NumberField) и «Продвинутые (Reality)» с `show` (Checkbox). `fingerprint`-select из inbound-режима убирается — это клиентское uTLS-поле (по спеке и справочнику). Outbound (клиентские): `serverName` (единственное число), `password` (публичный ключ сервера, алиас `publicKey`), `shortId` (единственное число), `spiderX`, `fingerprint`. Кнопок генерации в outbound нет — ключи генерятся на сервере.

- [ ] **Step 1: Написать падающий тест**

Дополнить `frontend/test/stream-form.test.tsx` в конец файла:

```tsx
describe('StreamForm — Reality целиком', () => {
  it('inbound: xver пишется числом, show — в «Продвинутых (Reality)»', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'tcp', security: 'reality', realitySettings: {} }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('PROXY protocol к цели (xver)'), '1')
    expect((onChange.mock.lastCall![0] as { realitySettings: Record<string, unknown> }).realitySettings.xver).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(Reality\)/ }))
    await userEvent.click(screen.getByLabelText('Отладочный вывод (show)'))
    const next = onChange.mock.lastCall![0] as { realitySettings: Record<string, unknown> }
    expect(next.realitySettings.show).toBe(true)
  })

  it('inbound: fingerprint-селект не показывается — это клиентское поле', () => {
    wrap(<StreamForm value={{ network: 'tcp', security: 'reality', realitySettings: {} }} onChange={vi.fn()} />)
    expect(screen.queryByLabelText('Отпечаток (fingerprint)')).not.toBeInTheDocument()
  })

  it('outbound: клиентские поля serverName/password/shortId/spiderX/fingerprint', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'reality', realitySettings: {} }}
        onChange={onChange}
        mode="outbound"
      />,
    )
    await userEvent.type(screen.getByLabelText('Имя сервера (serverName)'), 'a.com')
    await userEvent.type(screen.getByLabelText('Публичный ключ сервера (password)'), 'PBK')
    await userEvent.type(screen.getByLabelText('Короткий ID (shortId)'), 'aa11')
    await userEvent.type(screen.getByLabelText('spiderX'), '/')
    await userEvent.selectOptions(screen.getByLabelText('Отпечаток (fingerprint)'), 'randomized')
    const next = onChange.mock.lastCall![0] as { realitySettings: Record<string, unknown> }
    expect(next.realitySettings).toEqual({
      serverName: 'a.com',
      password: 'PBK',
      shortId: 'aa11',
      spiderX: '/',
      fingerprint: 'randomized',
    })
  })

  it('outbound: серверных полей и кнопок генерации нет', () => {
    wrap(
      <StreamForm
        value={{ network: 'tcp', security: 'reality', realitySettings: {} }}
        onChange={vi.fn()}
        mode="outbound"
      />,
    )
    expect(screen.queryByText('Сгенерировать ключи')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Имена серверов (serverNames)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Приватный ключ')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Цель маскировки (dest)')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/stream-form.test.tsx`
Ожидание: FAIL — `xver`/`show`/клиентских полей нет; в inbound по-прежнему рендерится fingerprint.

- [ ] **Step 3: Реализация**

В `frontend/src/features/inspector/StreamForm.tsx` заменить весь блок `{security === 'reality' && ( ... )}` на два блока:

```tsx
      {security === 'reality' && mode === 'inbound' && (
        <>
          <TextField
            label="Цель маскировки (dest)"
            mono
            placeholder="yahoo.com:443"
            value={reality[destKey] === undefined ? undefined : String(reality[destKey])}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r[destKey]; else r[destKey] = v })}
          />
          <StringListField
            label="Имена серверов (serverNames)"
            placeholder={'yahoo.com\nwww.yahoo.com'}
            value={reality.serverNames as string[] | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.serverNames; else r.serverNames = v })}
          />
          <TextField
            label="Приватный ключ"
            mono
            value={reality.privateKey as string | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.privateKey; else r.privateKey = v })}
          />
          <div className="row">
            <Button
              disabled={keypair.isPending}
              onClick={() => {
                // Сбрасываем прежний derive — иначе его устаревший pbk перекрыл бы ключ новой пары
                derive.reset()
                keypair.mutate(undefined, {
                  onSuccess: (keys) => patchReality((r) => { r.privateKey = keys.privateKey }),
                })
              }}
            >
              Сгенерировать ключи
            </Button>
            <Button
              variant="ghost"
              disabled={derive.isPending || !reality.privateKey}
              onClick={() => derive.mutate(reality.privateKey as string)}
            >
              Публичный ключ
            </Button>
          </div>
          {shownPublicKey && (
            <p className="mono" style={{ fontSize: 12, wordBreak: 'break-all', margin: 0 }}>
              pbk: {shownPublicKey}
            </p>
          )}
          {(keypair.isError || derive.isError) && (
            <span className="field-error">{((keypair.error ?? derive.error) as Error).message}</span>
          )}
          <TagListField
            label="Короткие ID (shortIds)"
            addLabel="+ ID"
            value={reality.shortIds as string[] | undefined}
            onAdd={() => patchReality((r) => { r.shortIds = [...((r.shortIds as string[]) ?? []), randomShortId()] })}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.shortIds; else r.shortIds = v })}
          />
          <NumberField
            label="PROXY protocol к цели (xver)"
            placeholder="0"
            value={reality.xver as number | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.xver; else r.xver = v })}
          />
          <CollapsibleSection title="Продвинутые (Reality)">
            <CheckboxField
              label="Отладочный вывод (show)"
              hint="Печатает отладку хендшейка в лог — в проде выключено"
              value={reality.show as boolean | undefined}
              onChange={(v) => patchReality((r) => { if (v === undefined) delete r.show; else r.show = v })}
            />
          </CollapsibleSection>
        </>
      )}

      {security === 'reality' && mode === 'outbound' && (
        <>
          <TextField
            label="Имя сервера (serverName)"
            mono
            hint="Ровно одно значение — одно из serverNames сервера"
            value={reality.serverName as string | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.serverName; else r.serverName = v })}
          />
          <TextField
            label="Публичный ключ сервера (password)"
            mono
            hint="В свежих ядрах поле называется password — это x25519 publicKey сервера (pbk)"
            value={reality.password as string | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.password; else r.password = v })}
          />
          <TextField
            label="Короткий ID (shortId)"
            mono
            hint="Один из shortIds сервера"
            value={reality.shortId as string | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.shortId; else r.shortId = v })}
          />
          <TextField
            label="spiderX"
            mono
            placeholder="/"
            hint="Путь имитации краулера; рекомендуется свой на каждого клиента"
            value={reality.spiderX as string | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.spiderX; else r.spiderX = v })}
          />
          <SelectField
            label="Отпечаток (fingerprint)"
            hint="uTLS-профиль; Reality работает только с uTLS"
            value={(reality.fingerprint as string) ?? 'chrome'}
            options={FINGERPRINTS}
            onChange={(v) => patchReality((r) => { r.fingerprint = v })}
          />
        </>
      )}
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/stream-form.test.tsx` — PASS. Существующие тесты (`target`-алиас, генерация ключей, `+ ID`) работают: дефолтный режим inbound, блок перенесён без изменений логики.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/StreamForm.tsx frontend/test/stream-form.test.tsx
git commit -m "feat(frontend): full reality settings with inbound and outbound modes" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: StreamForm — транспорт hysteria (up/down, masquerade, finalmask.quicParams)

**Files:**
- Modify: `frontend/src/features/inspector/StreamForm.tsx`
- Test: `frontend/test/stream-form.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `patchSection`, схемы `HysteriaSettingsSchema`/`FinalmaskSchema` (план 1).
- Produces: опция `hysteria` в списке транспортов; при выборе создаётся `hysteriaSettings: { version: 2 }` (ядро жёстко требует `version: 2`); поля `up`/`down` (строки «100mbps»), `masquerade` (select нет/file + каталог — HY2-аналог selfsteal), `congestion`/`brutalUp`/`brutalDown` — пишутся в `finalmask.quicParams` (унификация Xray v26.3.27+; одноимённые поля в hysteriaSettings soft-deprecated) через хелпер `patchQuic` с двухуровневой очисткой пустых объектов.

- [ ] **Step 1: Написать падающий тест**

Дополнить `frontend/test/stream-form.test.tsx` в конец файла:

```tsx
describe('StreamForm — транспорт hysteria', () => {
  it('выбор hysteria создаёт hysteriaSettings с version: 2', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'tcp', security: 'tls', tlsSettings: {} }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Транспорт'), 'hysteria')
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.network).toBe('hysteria')
    expect(next.hysteriaSettings).toEqual({ version: 2 })
  })

  it('up/down пишутся строками, version сохраняется', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'hysteria', security: 'tls', hysteriaSettings: { version: 2 } }}
        onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('Скорость вверх (up)'), '100mbps')
    await userEvent.type(screen.getByLabelText('Скорость вниз (down)'), '300mbps')
    const next = onChange.mock.lastCall![0] as { hysteriaSettings: Record<string, unknown> }
    expect(next.hysteriaSettings).toEqual({ version: 2, up: '100mbps', down: '300mbps' })
  })

  it('masquerade: тип file + каталог', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'hysteria', security: 'tls', hysteriaSettings: { version: 2 } }}
        onChange={onChange}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Маскировка (masquerade)'), 'file')
    await userEvent.type(screen.getByLabelText('Каталог сайта (masquerade.dir)'), '/var/www')
    const next = onChange.mock.lastCall![0] as { hysteriaSettings: Record<string, unknown> }
    expect(next.hysteriaSettings.masquerade).toEqual({ type: 'file', dir: '/var/www' })
  })

  it('congestion/brutalUp пишутся в finalmask.quicParams', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'hysteria', security: 'tls', hysteriaSettings: { version: 2 } }}
        onChange={onChange}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Congestion control'), 'brutal')
    await userEvent.type(screen.getByLabelText('brutalUp (Мбит/с)'), '100')
    const next = onChange.mock.lastCall![0] as { finalmask: { quicParams: Record<string, unknown> } }
    expect(next.finalmask.quicParams).toEqual({ congestion: 'brutal', brutalUp: 100 })
  })

  it('сброс единственного quic-параметра удаляет finalmask целиком', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{
          network: 'hysteria',
          security: 'tls',
          hysteriaSettings: { version: 2 },
          finalmask: { quicParams: { congestion: 'bbr' } },
        }}
        onChange={onChange}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Congestion control'), '')
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.finalmask).toBeUndefined()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/stream-form.test.tsx`
Ожидание: FAIL — опции `hysteria` нет в select'е «Транспорт».

- [ ] **Step 3: Реализация**

В `frontend/src/features/inspector/StreamForm.tsx`:

1. В константу `NETWORKS` добавить последним элементом:

```tsx
  { value: 'hysteria', label: 'Hysteria 2 (QUIC)' },
```

2. Добавить константы после `TLS_VERSIONS`:

```tsx
const MASQUERADE_TYPES: Option[] = [
  { value: '', label: 'нет' },
  { value: 'file', label: 'file — отдавать сайт из каталога' },
]

const CONGESTIONS: Option[] = [
  { value: '', label: 'по умолчанию (brutal)' },
  { value: 'reno', label: 'reno' },
  { value: 'bbr', label: 'bbr' },
  { value: 'brutal', label: 'brutal' },
  { value: 'force-brutal', label: 'force-brutal' },
]
```

3. В компоненте после строки `const tcp = ...` добавить:

```tsx
  const hysteria = (value.hysteriaSettings as Obj) ?? {}
  const masquerade = (hysteria.masquerade as Obj) ?? {}
  const quic = ((value.finalmask as Obj | undefined)?.quicParams as Obj | undefined) ?? {}
```

4. После функции `patchReality` добавить:

```tsx
  // QUIC-параметры (congestion/brutal*) унифицированы в finalmask.quicParams (Xray v26.3.27+),
  // одноимённые поля в hysteriaSettings soft-deprecated; опустевшие уровни удаляются
  function patchQuic(mut: (q: Obj) => void) {
    patch((next) => {
      const fm = (next.finalmask as Obj) ?? {}
      const q = (fm.quicParams as Obj) ?? {}
      mut(q)
      if (Object.keys(q).length === 0) delete fm.quicParams
      else fm.quicParams = q
      if (Object.keys(fm).length === 0) delete next.finalmask
      else next.finalmask = fm
    })
  }
```

5. Заменить `onChange` у SelectField «Транспорт» на:

```tsx
        onChange={(v) =>
          patch((n) => {
            n.network = v
            // Hysteria 2 жёстко требует version: 2 — иначе ядро не стартует
            if (v === 'hysteria' && n.hysteriaSettings === undefined) n.hysteriaSettings = { version: 2 }
          })
        }
```

6. После блока `{network === 'xhttp' && ( ... )}` добавить:

```tsx
      {network === 'hysteria' && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Hysteria 2 работает поверх QUIC: нужен security «TLS» с настоящим сертификатом; version: 2 фиксирован.
          </p>
          <TextField
            label="Скорость вверх (up)"
            mono
            placeholder="100mbps"
            hint="Единицы: bps/kbps/mbps/gbps"
            value={hysteria.up as string | undefined}
            onChange={(v) => patchSection('hysteriaSettings', (s) => { if (v === undefined) delete s.up; else s.up = v })}
          />
          <TextField
            label="Скорость вниз (down)"
            mono
            placeholder="300mbps"
            hint="Единицы: bps/kbps/mbps/gbps"
            value={hysteria.down as string | undefined}
            onChange={(v) => patchSection('hysteriaSettings', (s) => { if (v === undefined) delete s.down; else s.down = v })}
          />
          <SelectField
            label="Маскировка (masquerade)"
            hint="Неавторизованным отдаётся реальный сайт — HY2-аналог selfsteal"
            value={(masquerade.type as string) ?? ''}
            options={MASQUERADE_TYPES}
            onChange={(v) =>
              patchSection('hysteriaSettings', (s) => {
                if (v === '') delete s.masquerade
                else s.masquerade = { ...((s.masquerade as Obj) ?? {}), type: v }
              })
            }
          />
          {masquerade.type === 'file' && (
            <TextField
              label="Каталог сайта (masquerade.dir)"
              mono
              placeholder="/var/www"
              value={masquerade.dir as string | undefined}
              onChange={(v) =>
                patchSection('hysteriaSettings', (s) => {
                  const m = (s.masquerade as Obj) ?? { type: 'file' }
                  if (v === undefined) delete m.dir
                  else m.dir = v
                  s.masquerade = m
                })
              }
            />
          )}
          <SelectField
            label="Congestion control"
            hint="brutal требует brutalUp/brutalDown — фиксированная полоса, стабильность на потерях"
            value={(quic.congestion as string) ?? ''}
            options={CONGESTIONS}
            onChange={(v) => patchQuic((q) => { if (v === '') delete q.congestion; else q.congestion = v })}
          />
          <NumberField
            label="brutalUp (Мбит/с)"
            value={quic.brutalUp as number | undefined}
            onChange={(v) => patchQuic((q) => { if (v === undefined) delete q.brutalUp; else q.brutalUp = v })}
          />
          <NumberField
            label="brutalDown (Мбит/с)"
            value={quic.brutalDown as number | undefined}
            onChange={(v) => patchQuic((q) => { if (v === undefined) delete q.brutalDown; else q.brutalDown = v })}
          />
        </>
      )}
```

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/stream-form.test.tsx` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/StreamForm.tsx frontend/test/stream-form.test.tsx
git commit -m "feat(frontend): hysteria transport fields in stream form" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Матрица совместимости в select'ах + предупреждения (+ проп `flow`)

**Files:**
- Modify: `frontend/src/features/inspector/StreamForm.tsx`
- Modify: `frontend/src/features/inspector/InboundForm.tsx`
- Test: `frontend/test/stream-form.test.tsx` (дополнить)
- Test: `frontend/test/inbound-form.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `allowedNetworks`, `allowedSecurities`, `securityNetworkIssue`, `flowNetworkIssue`, `hysteriaCertificateIssue`, `normalizeNetwork` из `entities/xray` (Task 1); CSS-класс `.field-warning` (уже в `tokens.css`, план 2).
- Produces: StreamForm получает проп `flow?: string` (InboundForm передаёт `settings.flow` — VLESS хранит flow на уровне settings). Select'ы «Транспорт»/«Шифрование» предлагают только совместимые опции; уже существующее несовместимое значение остаётся видимой опцией с пометкой «(несовместимо)» (`network: 'raw'` — легитимный алиас, пометка «(= tcp)»); под select'ами — предупреждения `.field-warning` из трёх функций матрицы. Конфиг НИКОГДА не переписывается молча.

- [ ] **Step 1: Написать падающие тесты**

1. Дополнить `frontend/test/stream-form.test.tsx` в конец файла:

```tsx
describe('StreamForm — матрица совместимости', () => {
  it('reality: транспорт-селект не предлагает ws/httpupgrade/hysteria', () => {
    wrap(<StreamForm value={{ network: 'tcp', security: 'reality', realitySettings: {} }} onChange={vi.fn()} />)
    expect(screen.queryByRole('option', { name: 'WebSocket' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'HTTPUpgrade' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Hysteria 2 (QUIC)' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'gRPC' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'XHTTP' })).toBeInTheDocument()
  })

  it('ws: шифрование-селект не предлагает Reality', () => {
    wrap(<StreamForm value={{ network: 'ws', security: 'none' }} onChange={vi.fn()} />)
    expect(screen.queryByRole('option', { name: 'Reality' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'TLS' })).toBeInTheDocument()
  })

  it('существующая пара reality+ws не переписывается: опция с пометкой + предупреждение', () => {
    const onChange = vi.fn()
    wrap(<StreamForm value={{ network: 'ws', security: 'reality', realitySettings: {} }} onChange={onChange} />)
    expect(screen.getByLabelText('Транспорт')).toHaveValue('ws')
    expect(screen.getByRole('option', { name: 'ws (несовместимо)' })).toBeInTheDocument()
    expect(screen.getByText(/Reality несовместим с транспортом «ws»/)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('network raw — легитимный алиас tcp: опция «(= tcp)», предупреждения нет', () => {
    wrap(<StreamForm value={{ network: 'raw', security: 'reality', realitySettings: {} }} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Транспорт')).toHaveValue('raw')
    expect(screen.getByRole('option', { name: 'raw (= tcp)' })).toBeInTheDocument()
    expect(screen.queryByText(/несовместим/)).not.toBeInTheDocument()
  })

  it('flow vision + ws: предупреждение и транспорт-селект только с TCP', () => {
    wrap(<StreamForm value={{ network: 'ws', security: 'none' }} onChange={vi.fn()} flow="xtls-rprx-vision" />)
    expect(screen.getByText(/работает только поверх raw/)).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'gRPC' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'TCP (raw)' })).toBeInTheDocument()
  })

  it('hysteria + none: предупреждение, шифрование-селект предлагает только TLS', () => {
    wrap(<StreamForm value={{ network: 'hysteria', security: 'none' }} onChange={vi.fn()} />)
    expect(screen.getByText(/hysteria требует security «tls»/)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'TLS' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Reality' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'none (несовместимо)' })).toBeInTheDocument()
  })

  it('hysteria + tls без certificates: предупреждение про сертификат; с certificates — нет', () => {
    const { unmount } = wrap(
      <StreamForm value={{ network: 'hysteria', security: 'tls', tlsSettings: {} }} onChange={vi.fn()} />,
    )
    expect(screen.getByText(/нужен настоящий TLS-сертификат/)).toBeInTheDocument()
    unmount()
    wrap(
      <StreamForm
        value={{ network: 'hysteria', security: 'tls', tlsSettings: { certificates: [{ certificateFile: '/a' }] } }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.queryByText(/нужен настоящий TLS-сертификат/)).not.toBeInTheDocument()
  })
})
```

2. Дополнить `frontend/test/inbound-form.test.tsx` в конец `describe('InboundForm', ...)`:

```tsx
  it('flow из settings прокидывается в StreamForm: vision + ws даёт предупреждение', () => {
    wrap(
      <InboundForm
        value={{
          ...VLESS,
          settings: { ...VLESS.settings, flow: 'xtls-rprx-vision' },
          streamSettings: { network: 'ws', security: 'none' },
        }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/работает только поверх raw/)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/stream-form.test.tsx test/inbound-form.test.tsx`
Ожидание: FAIL — TS не знает проп `flow`; несовместимые опции по-прежнему в select'ах; предупреждений нет.

- [ ] **Step 3: Реализация**

1. В `frontend/src/features/inspector/StreamForm.tsx`:

Добавить импорт после импорта `useRealityKeypair...`:

```tsx
import {
  allowedNetworks,
  allowedSecurities,
  flowNetworkIssue,
  hysteriaCertificateIssue,
  normalizeNetwork,
  securityNetworkIssue,
} from '../../entities/xray'
```

Добавить после константы `CONGESTIONS` (перед `export type StreamFormMode`):

```tsx
// Несовместимые комбинации не предлагаются, но уже существующее в конфиге значение
// остаётся видимой опцией с пометкой — молча переписывать конфиг нельзя,
// вместо этого под select'ами показываются предупреждения
function networkSelectOptions(security: string, flow: string | undefined, current: string): Option[] {
  const allowed = allowedNetworks(security).filter((n) => flowNetworkIssue(flow, n) === null)
  const base = NETWORKS.filter((o) => allowed.includes(o.value))
  if (base.some((o) => o.value === current)) return base
  const compatible = allowed.includes(normalizeNetwork(current))
  return [...base, { value: current, label: compatible ? `${current} (= tcp)` : `${current} (несовместимо)` }]
}

function securitySelectOptions(network: string, current: string): Option[] {
  const allowed = allowedSecurities(network)
  const base = SECURITIES.filter((o) => allowed.includes(o.value))
  return base.some((o) => o.value === current)
    ? base
    : [...base, { value: current, label: `${current} (несовместимо)` }]
}
```

В интерфейс `Props` добавить после `mode`:

```tsx
  /** flow протокола (settings.flow у VLESS) — для матрицы «vision только поверх raw» */
  flow?: string
```

В сигнатуру компонента добавить `flow`:

```tsx
export function StreamForm({ value, onChange, mode = 'inbound', flow }: Props) {
```

После строки `const shownPublicKey = ...` добавить:

```tsx
  const secNetIssue = securityNetworkIssue(security, network)
  const flowIssue = flowNetworkIssue(flow, network)
  const certIssue = hysteriaCertificateIssue(network, security, tls as { certificates?: unknown[] })
```

Заменить `options={NETWORKS}` у SelectField «Транспорт» на `options={networkSelectOptions(security, flow, network)}`, а `options={SECURITIES}` у SelectField «Шифрование» на `options={securitySelectOptions(network, security)}`.

Сразу после SelectField «Шифрование» добавить:

```tsx
      {secNetIssue && <span className="field-warning">{secNetIssue}</span>}
      {flowIssue && <span className="field-warning">{flowIssue}</span>}
      {certIssue && <span className="field-warning">{certIssue}</span>}
```

2. В `frontend/src/features/inspector/InboundForm.tsx` заменить вызов StreamForm на:

```tsx
      <StreamForm value={(value.streamSettings as Obj) ?? {}}
        onChange={(stream) => patch((n) => { n.streamSettings = stream })}
        flow={settings.flow as string | undefined} />
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/stream-form.test.tsx test/inbound-form.test.tsx test/node-inspector.test.tsx` — PASS. Регрессия важна: тест «смена security на reality» использует `network: 'tcp'` (reality допустим), тест ws-пути — `security: 'none'` (ws допустим) — фильтрация их не задевает.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/StreamForm.tsx frontend/src/features/inspector/InboundForm.tsx frontend/test/stream-form.test.tsx frontend/test/inbound-form.test.tsx
git commit -m "feat(frontend): compatibility matrix wired into stream form selects" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Секция sockopt + dialerProxy

**Files:**
- Modify: `frontend/src/features/inspector/StreamForm.tsx`
- Test: `frontend/test/stream-form.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `patchSection`, `SockoptSchema` (план 1), `CollapsibleSection`.
- Produces: StreamForm получает проп `outboundTags?: string[]`; в конце формы — CollapsibleSection «Сетевые опции (sockopt)»: outbound-режим — `dialerProxy` (select из тегов outbound + текущее значение с пометкой «(нет в конфиге)», сценарий цепочки нода→WARP) и `domainStrategy`; inbound-режим — `acceptProxyProtocol` (уровень сокета); оба режима — `mark`, `tcpFastOpen`, `interface`. Опустевший `sockopt` удаляется целиком. Числовой `tcpFastOpen` (длина очереди) остаётся в JSON — чекбокс отражает только `true`.

- [ ] **Step 1: Написать падающий тест**

1. В `frontend/test/stream-form.test.tsx` заменить `StatefulStreamForm` на вариант с `outboundTags`:

```tsx
function StatefulStreamForm({
  initial,
  onChange,
  mode,
  outboundTags,
}: {
  initial: Record<string, unknown>
  onChange?: (next: Record<string, unknown>) => void
  mode?: 'inbound' | 'outbound'
  outboundTags?: string[]
}) {
  const [value, setValue] = useState(initial)
  const handleChange = (next: Record<string, unknown>) => {
    setValue(next)
    onChange?.(next)
  }
  return <StreamForm value={value} onChange={handleChange} mode={mode} outboundTags={outboundTags} />
}
```

2. Добавить в конец файла:

```tsx
describe('StreamForm — sockopt', () => {
  it('outbound: dialerProxy выбирается из тегов outbound', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'none' }}
        onChange={onChange}
        mode="outbound"
        outboundTags={['direct', 'warp']}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Сетевые опции \(sockopt\)/ }))
    await userEvent.selectOptions(screen.getByLabelText('Проксировать через outbound (dialerProxy)'), 'warp')
    const next = onChange.mock.lastCall![0] as { sockopt: Record<string, unknown> }
    expect(next.sockopt).toEqual({ dialerProxy: 'warp' })
  })

  it('outbound: битый dialerProxy виден с пометкой «нет в конфиге»', async () => {
    wrap(
      <StreamForm
        value={{ network: 'tcp', security: 'none', sockopt: { dialerProxy: 'ghost' } }}
        onChange={vi.fn()}
        mode="outbound"
        outboundTags={['warp']}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Сетевые опции \(sockopt\)/ }))
    expect(screen.getByLabelText('Проксировать через outbound (dialerProxy)')).toHaveValue('ghost')
    expect(screen.getByRole('option', { name: 'ghost (нет в конфиге)' })).toBeInTheDocument()
  })

  it('outbound: сброс единственного ключа удаляет sockopt целиком', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'none', sockopt: { dialerProxy: 'warp' } }}
        onChange={onChange}
        mode="outbound"
        outboundTags={['warp']}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Сетевые опции \(sockopt\)/ }))
    await userEvent.selectOptions(screen.getByLabelText('Проксировать через outbound (dialerProxy)'), '')
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.sockopt).toBeUndefined()
  })

  it('inbound: dialerProxy отсутствует, acceptProxyProtocol и mark пишутся', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'ws', security: 'none' }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Сетевые опции \(sockopt\)/ }))
    expect(screen.queryByLabelText('Проксировать через outbound (dialerProxy)')).not.toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Принимать PROXY protocol (sockopt)'))
    await userEvent.type(screen.getByLabelText('Метка пакетов (mark)'), '255')
    const next = onChange.mock.lastCall![0] as { sockopt: Record<string, unknown> }
    expect(next.sockopt).toEqual({ acceptProxyProtocol: true, mark: 255 })
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/stream-form.test.tsx`
Ожидание: FAIL — TS не знает проп `outboundTags`; секции sockopt нет в разметке.

- [ ] **Step 3: Реализация**

В `frontend/src/features/inspector/StreamForm.tsx`:

1. Добавить константу после `CONGESTIONS`:

```tsx
const SOCKOPT_DOMAIN_STRATEGIES: Option[] = [
  { value: '', label: 'не задана (AsIs)' },
  { value: 'AsIs', label: 'AsIs' },
  { value: 'UseIP', label: 'UseIP' },
  { value: 'UseIPv4', label: 'UseIPv4' },
  { value: 'UseIPv6', label: 'UseIPv6' },
]
```

2. В интерфейс `Props` добавить после `flow`:

```tsx
  /** Теги outbound конфига — для select'а sockopt.dialerProxy (outbound-режим) */
  outboundTags?: string[]
```

и в деструктуризацию компонента: `{ value, onChange, mode = 'inbound', flow, outboundTags }`.

3. После строки `const quic = ...` добавить:

```tsx
  const sockopt = (value.sockopt as Obj) ?? {}
  const dialerProxy = (sockopt.dialerProxy as string) ?? ''
  // Значение, которого нет среди тегов конфига, остаётся видимым с пометкой —
  // битая ссылка снимается из формы, а не пропадает молча
  const dialerOptions: Option[] = [
    { value: '', label: '— нет —' },
    ...(outboundTags ?? []).map((t) => ({ value: t, label: t })),
    ...(dialerProxy !== '' && !(outboundTags ?? []).includes(dialerProxy)
      ? [{ value: dialerProxy, label: `${dialerProxy} (нет в конфиге)` }]
      : []),
  ]
```

4. Перед закрывающим `</>` компонента (после outbound-блока Reality) добавить:

```tsx
      <CollapsibleSection title="Сетевые опции (sockopt)">
        {mode === 'outbound' && (
          <SelectField
            label="Проксировать через outbound (dialerProxy)"
            hint="Цепочка: исходящие соединения этого outbound пойдут через указанный тег (например, нода → WARP)"
            value={dialerProxy}
            options={dialerOptions}
            onChange={(v) =>
              patchSection('sockopt', (s) => { if (v === '') delete s.dialerProxy; else s.dialerProxy = v })
            }
          />
        )}
        {mode === 'inbound' && (
          <CheckboxField
            label="Принимать PROXY protocol (sockopt)"
            hint="acceptProxyProtocol на уровне сокета"
            value={sockopt.acceptProxyProtocol as boolean | undefined}
            onChange={(v) =>
              patchSection('sockopt', (s) => {
                if (v === undefined) delete s.acceptProxyProtocol
                else s.acceptProxyProtocol = v
              })
            }
          />
        )}
        <NumberField
          label="Метка пакетов (mark)"
          placeholder="0"
          value={sockopt.mark as number | undefined}
          onChange={(v) => patchSection('sockopt', (s) => { if (v === undefined) delete s.mark; else s.mark = v })}
        />
        <CheckboxField
          label="TCP Fast Open"
          hint="Числовое значение (длина очереди) редактируется в JSON — чекбокс отражает только true"
          value={sockopt.tcpFastOpen === true ? true : undefined}
          onChange={(v) =>
            patchSection('sockopt', (s) => { if (v === undefined) delete s.tcpFastOpen; else s.tcpFastOpen = v })
          }
        />
        <TextField
          label="Сетевой интерфейс (interface)"
          mono
          placeholder="eth0"
          value={sockopt.interface as string | undefined}
          onChange={(v) =>
            patchSection('sockopt', (s) => { if (v === undefined) delete s.interface; else s.interface = v })
          }
        />
        {mode === 'outbound' && (
          <SelectField
            label="Стратегия доменов (sockopt)"
            hint="Как резолвить домены при исходящем соединении на уровне сокета"
            value={(sockopt.domainStrategy as string) ?? ''}
            options={SOCKOPT_DOMAIN_STRATEGIES}
            onChange={(v) =>
              patchSection('sockopt', (s) => { if (v === '') delete s.domainStrategy; else s.domainStrategy = v })
            }
          />
        )}
      </CollapsibleSection>
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/stream-form.test.tsx` — PASS (первый тест файла с `sockopt: { mark: 1 }` не задет: правки security не трогают sockopt).

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/StreamForm.tsx frontend/test/stream-form.test.tsx
git commit -m "feat(frontend): sockopt section with dialer proxy select" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Подключение StreamForm к OutboundForm (mode=outbound) + NodeInspector

**Files:**
- Modify: `frontend/src/features/inspector/OutboundForm.tsx`
- Modify: `frontend/src/features/topology/NodeInspector.tsx`
- Test: `frontend/test/outbound-form.test.tsx` (изменить + дополнить)
- Test: `frontend/test/node-inspector.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `StreamForm` со всеми пропсами (Task 2–7); `config.outbounds` в NodeInspector.
- Produces: `OutboundForm` получает опциональный проп `outboundTags?: string[]` и рендерит StreamForm с `mode="outbound"` для всех протоколов, кроме `wireguard` и `blackhole` (по спеке; freedom — тоже с транспортом, это допустимо). Свой тег исключается из списка dialerProxy (петля). NodeInspector передаёт `outboundTags` из конфига. **Важно:** `outbound-form.test.tsx` получает обёртку `QueryClientProvider` — StreamForm внутри OutboundForm использует react-query-хуки (`useRealityKeypair`), без провайдера тесты упадут.

- [ ] **Step 1: Написать падающие тесты**

1. В `frontend/test/outbound-form.test.tsx`:

Заменить шапку файла (импорты + StatefulOutboundForm) на:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { OutboundForm, WARP_TEMPLATE } from '../src/features/inspector/OutboundForm'

// OutboundForm теперь рендерит StreamForm → react-query-хуки требуют провайдер
function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

// Обёртка-родитель как в реальном приложении: эхо-ит onChange обратно в value через useState
function StatefulOutboundForm({ initial, outboundTags }: { initial: Record<string, unknown>; outboundTags?: string[] }) {
  const [value, setValue] = useState(initial)
  return <OutboundForm value={value} onChange={setValue} outboundTags={outboundTags} />
}
```

Во всех существующих тестах файла заменить вызовы `render(` на `wrap(` (поведение тестов не меняется).

Добавить в конец файла:

```tsx
describe('OutboundForm — streamSettings', () => {
  it('freedom, socks, http и vless показывают блок транспорта', () => {
    for (const protocol of ['freedom', 'socks', 'http', 'vless']) {
      const { unmount } = wrap(<OutboundForm value={{ tag: 't', protocol }} onChange={vi.fn()} />)
      expect(screen.getByLabelText('Транспорт')).toBeInTheDocument()
      unmount()
    }
  })

  it('wireguard и blackhole — без блока транспорта', () => {
    for (const protocol of ['wireguard', 'blackhole']) {
      const { unmount } = wrap(<OutboundForm value={{ tag: 't', protocol }} onChange={vi.fn()} />)
      expect(screen.queryByLabelText('Транспорт')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('правка транспорта уходит в streamSettings outbound-узла', async () => {
    const onChange = vi.fn()
    const Stateful = () => {
      const [value, setValue] = useState<Record<string, unknown>>({ tag: 'chain', protocol: 'vless' })
      return (
        <OutboundForm
          value={value}
          onChange={(next) => {
            setValue(next)
            onChange(next)
          }}
        />
      )
    }
    wrap(<Stateful />)
    await userEvent.selectOptions(screen.getByLabelText('Транспорт'), 'ws')
    await userEvent.type(screen.getByLabelText('Путь WebSocket'), '/ws')
    const next = onChange.mock.lastCall![0] as { streamSettings: Record<string, unknown> }
    expect(next.streamSettings).toEqual({ network: 'ws', wsSettings: { path: '/ws' } })
  })

  it('vless + tls: клиентский fingerprint есть, серверных сертификатов нет', async () => {
    wrap(<StatefulOutboundForm initial={{ tag: 'chain', protocol: 'vless', streamSettings: { network: 'tcp' } }} />)
    await userEvent.selectOptions(screen.getByLabelText('Шифрование'), 'tls')
    expect(screen.getByLabelText('Отпечаток (fingerprint)')).toBeInTheDocument()
    expect(screen.queryByText('+ Сертификат')).not.toBeInTheDocument()
  })

  it('dialerProxy: свой тег исключён из списка', async () => {
    wrap(
      <OutboundForm
        value={{ tag: 'proxy', protocol: 'vless' }}
        onChange={vi.fn()}
        outboundTags={['proxy', 'warp', 'direct']}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Сетевые опции \(sockopt\)/ }))
    const select = screen.getByLabelText('Проксировать через outbound (dialerProxy)')
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'warp' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'proxy' })).not.toBeInTheDocument()
  })
})
```

2. В `frontend/test/node-inspector.test.tsx` добавить в конец файла:

```tsx
describe('NodeInspector — streamSettings у outbound', () => {
  it('outbound-узел показывает форму транспорта, dialerProxy получает теги конфига без своего', async () => {
    wrap(
      <NodeInspector config={ruleConfig} nodeId="out:direct" onApply={() => {}} onRemove={() => {}} onClose={() => {}} />,
    )
    expect(screen.getByLabelText('Транспорт')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Сетевые опции \(sockopt\)/ }))
    expect(screen.getByRole('option', { name: 'warp' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'direct' })).not.toBeInTheDocument()
  })
})
```

(фикстура `ruleConfig` с outbound'ами `direct`/`warp` уже определена в этом файле планом 2; если тест добавляется вне области её видимости — перенести определение `ruleConfig` на верхний уровень файла.)

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/outbound-form.test.tsx test/node-inspector.test.tsx`
Ожидание: FAIL — у OutboundForm нет блока транспорта (`getByLabelText('Транспорт')` не находит элемент), TS не знает проп `outboundTags`.

- [ ] **Step 3: Реализация**

1. В `frontend/src/features/inspector/OutboundForm.tsx`:

Добавить импорт после импорта `Button`:

```tsx
import { StreamForm } from './StreamForm'
```

Заменить интерфейс `Props` на:

```tsx
interface Props {
  value: Obj // outbound целиком
  onChange: (next: Obj) => void
  /** Теги всех outbound конфига — для select'а sockopt.dialerProxy; свой тег исключается */
  outboundTags?: string[]
}
```

и сигнатуру компонента на:

```tsx
export function OutboundForm({ value, onChange, outboundTags }: Props) {
```

После блока `{(protocol === 'socks' || protocol === 'http' || protocol === 'vless') && ( ... )}` (перед закрывающим `</>`) добавить:

```tsx
      {protocol !== 'wireguard' && protocol !== 'blackhole' && (
        // wireguard не поддерживает streamSettings, для blackhole транспорт бессмыслен
        <StreamForm
          mode="outbound"
          value={(value.streamSettings as Obj) ?? {}}
          onChange={(stream) => patch((n) => { n.streamSettings = stream })}
          outboundTags={(outboundTags ?? []).filter((t) => t !== (value.tag as string | undefined))}
        />
      )}
```

2. В `frontend/src/features/topology/NodeInspector.tsx` заменить вызов OutboundForm на:

```tsx
          {parsedNode !== null && kind === 'outbound' && (
            <OutboundForm
              value={parsedNode}
              onChange={(next) => setText(JSON.stringify(next, null, 2))}
              outboundTags={(config.outbounds ?? []).map((o) => o.tag)}
            />
          )}
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/outbound-form.test.tsx test/node-inspector.test.tsx test/stream-form.test.tsx test/inbound-form.test.tsx` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/OutboundForm.tsx frontend/src/features/topology/NodeInspector.tsx frontend/test/outbound-form.test.tsx frontend/test/node-inspector.test.tsx
git commit -m "feat(frontend): stream settings form for outbounds" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Финальная проверка плана

**Files:** нет новых — только запуск проверок.

**Interfaces:**
- Consumes: всё из задач 1–8.
- Produces: зелёный полный прогон — транспорты и безопасность закрыты, план 4 может строить `analyzeIntegrity` на `entities/xray/compat.ts`.

- [ ] **Step 1: Полный прогон тестов фронтенда**

Из каталога `frontend`: `npm test`
Ожидание: PASS, 0 упавших (все существующие + новые из задач 1–8).

- [ ] **Step 2: Типы**

Из корня: `npm run typecheck -w frontend`
Ожидание: exit 0, без ошибок.

- [ ] **Step 3: Тесты бэкенда не задеты**

Из корня: `npm test -w backend`
Ожидание: PASS (план не трогает бэкенд, прогон дешёвый).

- [ ] **Step 4: Если что-то упало — починить и закоммитить фикс**

Формат коммита: `fix(frontend): <что именно>` (+ трейлер Co-Authored-By). Если всё зелёное сразу — коммит не нужен.

---

## Self-Review (сверка со спекой, секция 4)

**Покрытие требований спеки:**

- ✅ **`mode: 'inbound' | 'outbound'` + подключение к OutboundForm** (Task 2, 8): дефолт `'inbound'` сохраняет обратную совместимость (InboundForm не меняет вызов до Task 6, существующие тесты зелёные без правок); OutboundForm рендерит StreamForm для всех протоколов, кроме wireguard (streamSettings не поддерживает) и blackhole (бессмысленно) — freedom по спеке «для всех, кроме…» тоже получает транспорт. Outbound-режим — клиентские поля: TLS `fingerprint`+`serverName` (+`alpn`), Reality `serverName`/`password`(publicKey)/`shortId`/`spiderX`/`fingerprint`; inbound-режим — серверные: TLS `certificates`/`rejectUnknownSni`/`minVersion`/`maxVersion`, Reality `privateKey`/`serverNames`/`shortIds`/`dest`/`xver`.
- ✅ **Все транспорты** (Task 2, 5): tcp/raw (`acceptProxyProtocol` в «Продвинутых», алиас `tcpSettings`/`rawSettings`), ws (`path`, `host`, `headers` через KeyValueField, `heartbeatPeriod`), grpc (`serviceName`, `authority`, `multiMode`), httpupgrade (`path`, `host`, `headers`), xhttp (`path`, `host`, `mode`; `extra` — в JSON с пометкой «спека нестабильна»), hysteria (`up`/`down`, `masquerade`, `congestion`/`brutalUp`/`brutalDown` из `finalmask.quicParams`, `version: 2` проставляется автоматически).
- ✅ **TLS целиком** (Task 3): `serverName`, `alpn` (MultiSelect), `fingerprint` (клиент), `minVersion`/`maxVersion`, `rejectUnknownSni`, `certificates` через ListEditor (file-пути `certificateFile`/`keyFile` ИЛИ inline `certificate[]`/`key[]` построчно). `allowInsecure` сознательно отсутствует (выпилен из свежих ядер — спека, секция 1).
- ✅ **Reality целиком** (Task 4): к существующим dest/serverNames/privateKey/shortIds добавлены `xver`, `spiderX` (клиент), `show` (сервер, «Продвинутые»); серверные/клиентские поля разведены по mode. Генерация ключей (`useRealityKeypair`/`useRealityPublicKey`, `derive.reset()`) перенесена без изменений — блок дословно сохранён. Сознательное отличие от текущего кода: `fingerprint` убран из inbound-режима (это клиентское uTLS-поле — по спеке и справочнику `xray-reality.md`), покрыто тестом.
- ✅ **Матрица совместимости зашита в формы** (Task 1, 6): `reality` → только raw(tcp)/xhttp/grpc; `flow: xtls-rprx-vision*` → только raw (flow прокидывается пропом из InboundForm — `settings.flow` у VLESS); `hysteria` → только `tls`, отдельная проверка наличия `certificates`. Несовместимые комбинации не предлагаются в select'ах; существующие в конфиге — остаются видимой опцией «(несовместимо)» + предупреждение `.field-warning`, конфиг не переписывается молча (тест «reality+ws» проверяет `onChange` не вызван). Алиас `raw` показан как «raw (= tcp)» без ложного предупреждения.
- ✅ **sockopt** (Task 7): секция «Сетевые опции (sockopt)» (CollapsibleSection, по умолчанию закрыта); `dialerProxy` — select из тегов outbound (сценарий нода→WARP), битая ссылка видима с пометкой; `mark`, `tcpFastOpen`, `interface`, `domainStrategy` (outbound), `acceptProxyProtocol` (inbound). Опустевший sockopt удаляется.
- ➡️ Вне плана (по спеке): `analyzeIntegrity`-проверки матрицы — план 4 (функции `compat.ts` экспортированы именно под это); протокольные settings outbound (vnext, servers) и `mux`/`sendThrough` — план 4 (секция 5 спеки); Playwright e2e «outbound vless со streamSettings + Reality» — план 4.

**Ключевые решения (зафиксированы):**

- **Матрица** — в `entities/xray/compat.ts` (не в StreamForm): план 4 расширяет `analyzeIntegrity` в `entities/xray/config.ts`, форма и валидатор берут правила из одного места; реэкспорт через `entities/xray/index.ts`.
- **dialerProxy-теги** — проброс пропсом по цепочке `NodeInspector` (`config.outbounds`) → `OutboundForm` (`outboundTags?`, свой тег исключается — петля) → `StreamForm`. Свободного текст-ввода нет: у NodeInspector конфиг всегда под рукой, проброс дешёвый; отсутствующее в конфиге значение остаётся снимаемой опцией «(нет в конфиге)».
- **Обратная совместимость тестов** — дефолт `mode='inbound'`; существующие тесты `stream-form.test.tsx` не переписываются (только `StatefulStreamForm` получает опциональные пропсы). `outbound-form.test.tsx` получает `QueryClientProvider`-обёртку (Task 8) — обязательная адаптация: StreamForm тянет react-query-хуки.

**Консистентность паттернов:** patch через `structuredClone` + `delete` при `undefined` (как InboundForm/OutboundForm/RuleForm); `patchSection` с удалением пустой секции — паттерн `patchSection` из ConfigSettingsDialog (план 2); опции «текущее значение всегда видимо» — паттерн `tagOptions` из RuleForm; алиасы ключей — паттерн `destKey` текущего StreamForm; `key` с длиной списка для mount-only полей в ListEditor — задокументирован комментарием (Global Constraint плана 1).

**CSS:** новых классов нет — `.field-warning` (`--out`), `.field-hint`, `.field-error` уже существуют; `--accent` нигде не используется.

**Новые зависимости:** нет. Новые примитивы форм: нет. Изменения схем: нет (все поля добавлены планом 1); единственный новый модуль в entities — чистый `compat.ts` без зависимостей.

**Плейсхолдеры:** отсутствуют — каждый шаг содержит полный код или точную замену «заменить X на Y»; команды запуска и ожидания указаны в каждом шаге.
