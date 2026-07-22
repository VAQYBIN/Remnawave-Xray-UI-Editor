# Протокольные формы, Reality-генератор, бэкапы и e2e — план 4 (финал)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Формы протоколов в инспекторе узла (VLESS/Reality с flow, Trojan, Shadowsocks, WireGuard/WARP), генератор Reality-ключей, пресеты профилей, панель бэкапов, полировка топологии и Playwright-сценарии.

**Architecture:** Формы — тонкий слой над JSON узла: единый текстовый черновик в NodeInspector, форма парсит его и пишет обратно через `JSON.stringify`; passthrough-инвариант сохраняется структурным клонированием и точечными присвоениями. Reality-ключи генерирует бэкенд (`node:crypto` x25519). Бэкапы читаются существующими endpoint'ами, восстановление — в черновик (без нового API).

**Tech Stack:** Fastify 5, node:crypto (x25519), React 19, zustand, TanStack Query, @playwright/test (chromium).

## Global Constraints

- Все Zod-схемы `.passthrough()`; формы НИКОГДА не теряют неизвестные поля узла: изменение = `structuredClone` + точечное присвоение/`delete`, никаких пересборок объекта с нуля.
- UI полностью на русском; технические термины (flow, dest, shortIds) — в оригинале.
- Дизайн: только токены из `frontend/src/shared/ui/tokens.css` (`--bg`, `--surface`, `--border`, `--text`, `--muted`, `--in`, `--out`, `--danger`, `--ok`, `--font-mono`); компоненты из `frontend/src/shared/ui`.
- Reality-ключи — x25519 в **base64url без padding** (совместимо с выводом `xray x25519`): 32 байта → 43 символа.
- Существующие экспорты не менять и не удалять (`TEMPLATE`, `formatConfig`, `resolveEditorText`, `toGraphContext`, `nextSelection`, id-контракт графа `in:{tag}`/`out:{tag}`/`rule:{i}`/`e:{source}->{target}`).
- Тесты: backend — `npm test -w backend` (vitest, файлы в `backend/test/*.test.ts`); frontend — `npm test -w frontend` (vitest+jsdom, файлы в `frontend/test/*.test.{ts,tsx}`); e2e — `npx playwright test` из `frontend/` (файлы `frontend/e2e/*.spec.ts`, vitest их не подхватывает: include ограничен `test/**`).
- Typecheck: `npm run typecheck -w frontend`, `npm run build -w backend`.
- Коммиты частые, `git add` только своих файлов (никогда `-A`).
- Все новые CSS-классы добавляются ТОЛЬКО в задаче 2 — остальные задачи tokens.css не трогают (защита от конфликтов при параллельном выполнении).

**Порядок/параллельность:** волна A — задачи 1, 2, 3, 4 (независимые файлы); волна B — задачи 5, 6, 7 (после 2–4); волна C — задачи 8, 9, 11 (8 после 5–7; 9 после 1, 3; 11 независима); волна D — задача 10 (после 8 — обе правят EditorPage.tsx); волна E — задача 12 (после всех).

---

### Task 1: Reality-инструменты (backend)

**Files:**
- Create: `backend/src/tools/reality.ts`
- Create: `backend/src/routes/tools.ts`
- Modify: `backend/src/server.ts` (регистрация роута)
- Test: `backend/test/reality.test.ts`

**Interfaces:**
- Produces: `POST /api/tools/reality-keypair` → `{ privateKey: string, publicKey: string }`; `POST /api/tools/reality-public-key` body `{ privateKey }` → `{ publicKey: string }`. Оба под auth-guard (регистрируются как остальные /api-роуты).

- [ ] **Step 1: Написать падающие тесты** `backend/test/reality.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { derivePublicKey, generateRealityKeypair } from '../src/tools/reality.js'

const B64URL_32 = /^[A-Za-z0-9_-]{43}$/

describe('reality tools', () => {
  it('генерирует пару ключей в base64url без padding', () => {
    const { privateKey, publicKey } = generateRealityKeypair()
    expect(privateKey).toMatch(B64URL_32)
    expect(publicKey).toMatch(B64URL_32)
    expect(privateKey).not.toBe(publicKey)
  })

  it('derivePublicKey восстанавливает публичный ключ из приватного', () => {
    const { privateKey, publicKey } = generateRealityKeypair()
    expect(derivePublicKey(privateKey)).toBe(publicKey)
  })

  it('каждый вызов даёт новую пару', () => {
    expect(generateRealityKeypair().privateKey).not.toBe(generateRealityKeypair().privateKey)
  })

  it('отклоняет ключ неверной длины', () => {
    expect(() => derivePublicKey('AAAA')).toThrow(/32 байта/)
  })
})
```

Плюс route-тесты в этом же файле — постройте сервер по образцу `backend/test/guard.test.ts` / `backend/test/profiles-routes.test.ts` (те же helpers `buildServer(config, deps)` + логин-cookie из существующих тестов):
- POST `/api/tools/reality-keypair` без сессии → 401.
- POST `/api/tools/reality-keypair` с сессией → 200, оба поля соответствуют `B64URL_32`.
- POST `/api/tools/reality-public-key` с телом `{ privateKey }` от сгенерированной пары → 200, `publicKey` совпадает.
- POST `/api/tools/reality-public-key` с `{ privateKey: 'AAAA' }` → 400.

- [ ] **Step 2: Запустить — убедиться, что падают**: `npm test -w backend` → FAIL (модуль не существует).

- [ ] **Step 3: Реализовать** `backend/src/tools/reality.ts`:

```ts
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'

// DER-префикс PKCS8 для x25519 — позволяет собрать KeyObject из 32 сырых байт
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')

export interface RealityKeypair {
  privateKey: string
  publicKey: string
}

// Формат совпадает с выводом `xray x25519`: base64url без padding
export function generateRealityKeypair(): RealityKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  const priv = (privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer).subarray(-32)
  const pub = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32)
  return { privateKey: priv.toString('base64url'), publicKey: pub.toString('base64url') }
}

export function derivePublicKey(privateKeyB64: string): string {
  const raw = Buffer.from(privateKeyB64, 'base64url')
  if (raw.length !== 32) {
    throw Object.assign(new Error('Приватный ключ должен быть 32 байта в base64url'), {
      statusCode: 400,
    })
  }
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  })
  return (createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer)
    .subarray(-32)
    .toString('base64url')
}
```

`backend/src/routes/tools.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { derivePublicKey, generateRealityKeypair } from '../tools/reality.js'

const deriveSchema = z.object({ privateKey: z.string().min(1) })

export const toolsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/tools/reality-keypair', async () => generateRealityKeypair())

  app.post('/api/tools/reality-public-key', async (req) => {
    const { privateKey } = deriveSchema.parse(req.body)
    return { publicKey: derivePublicKey(privateKey) }
  })
}
```

В `backend/src/server.ts`: импорт `import { toolsRoutes } from './routes/tools.js'` и `await app.register(toolsRoutes)` сразу после `await app.register(backupRoutes)`.

- [ ] **Step 4: Тесты зелёные**: `npm test -w backend` → PASS; `npm run build -w backend` чистый.

- [ ] **Step 5: Commit**: `git add backend/src/tools/reality.ts backend/src/routes/tools.ts backend/src/server.ts backend/test/reality.test.ts && git commit -m "feat(backend): reality x25519 keypair endpoints"`

---

### Task 2: UI-кит — Select, Checkbox, textarea и все новые стили

**Files:**
- Create: `frontend/src/shared/ui/Select.tsx`
- Create: `frontend/src/shared/ui/Checkbox.tsx`
- Modify: `frontend/src/shared/ui/index.ts`
- Modify: `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/ui-select.test.tsx`

**Interfaces:**
- Produces: `Select` — обёртка над `<select>` с классом `input select`, forwardRef, принимает все `SelectHTMLAttributes`; `Checkbox({ label, checked, onChange: (v: boolean) => void })`. CSS-классы для последующих задач: `.textarea`, `.field-mono`, `.taglist-item`, `.chip-x`, `.client-card`, `.inspector-form`, `.backup-list`.

- [ ] **Step 1: Падающий тест** `frontend/test/ui-select.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox, Select } from '../src/shared/ui'

describe('Select', () => {
  it('рендерит опции и меняет значение', async () => {
    const onChange = vi.fn()
    render(
      <Select aria-label="Прото" defaultValue="a" onChange={(e) => onChange(e.target.value)}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    )
    await userEvent.selectOptions(screen.getByLabelText('Прото'), 'b')
    expect(onChange).toHaveBeenCalledWith('b')
  })
})

describe('Checkbox', () => {
  it('переключается и отдаёт boolean', async () => {
    const onChange = vi.fn()
    render(<Checkbox label="Sniffing включён" checked={false} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Sniffing включён'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
```

- [ ] **Step 2: Запустить — FAIL** (`Select` не экспортируется): `npm test -w frontend`

- [ ] **Step 3: Реализация.** `frontend/src/shared/ui/Select.tsx`:

```tsx
import { forwardRef, type SelectHTMLAttributes } from 'react'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...rest }, ref) {
    return (
      <select
        ref={ref}
        {...rest}
        className={['input', 'select', className ?? ''].filter(Boolean).join(' ')}
      />
    )
  },
)
```

`frontend/src/shared/ui/Checkbox.tsx`:

```tsx
export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}
```

В `frontend/src/shared/ui/index.ts` добавить:

```ts
export { Select } from './Select'
export { Checkbox } from './Checkbox'
```

В `tokens.css`: расширить селектор существующего правила `.input` до `.input, .textarea` (сохранив все объявления), затем добавить в конец файла:

```css
.select {
  color-scheme: dark;
  cursor: pointer;
}
.textarea {
  font-family: var(--font-mono);
  font-size: 12px;
  resize: vertical;
  min-height: 64px;
}
.checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: var(--text);
  font-size: 13px;
}
.checkbox input {
  accent-color: var(--in);
}
.field-mono input {
  font-family: var(--font-mono);
  font-size: 12px;
}
.taglist-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text);
}
.chip-x {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  padding: 0 2px;
  font-size: 11px;
}
.chip-x:hover {
  color: var(--danger);
}
.client-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  background: var(--bg);
}
.inspector-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  max-height: calc(100vh - 380px);
  padding-right: 4px;
}
.backup-list {
  max-height: 50vh;
  overflow-y: auto;
}
```

- [ ] **Step 4: Тесты зелёные**: `npm test -w frontend`, `npm run typecheck -w frontend`.

- [ ] **Step 5: Commit**: `git add frontend/src/shared/ui/Select.tsx frontend/src/shared/ui/Checkbox.tsx frontend/src/shared/ui/index.ts frontend/src/shared/ui/tokens.css frontend/test/ui-select.test.tsx && git commit -m "feat(frontend): select, checkbox and form styles in ui kit"`

---

### Task 3: Генераторы значений и API-хуки

**Files:**
- Create: `frontend/src/entities/xray/generate.ts`
- Modify: `frontend/src/entities/xray/index.ts` (если есть barrel — добавить реэкспорт; если нет, импортировать напрямую)
- Modify: `frontend/src/shared/api/hooks.ts`
- Modify: `frontend/src/shared/api/types.ts`
- Test: `frontend/test/generate.test.ts`

**Interfaces:**
- Produces: `randomUuid(): string`, `randomShortId(bytes = 4): string` (hex, чётная длина), `randomBase64(bytes: number): string`, `ssPassword(method: string): string`, `trojanPassword(): string`; хуки `useRealityKeypair()` (mutation без аргументов → `{privateKey, publicKey}`), `useRealityPublicKey()` (mutation `privateKey: string` → `{publicKey}`), `useBackups(uuid: string, enabled?: boolean)` (query → `BackupEntry[]`); типы `BackupEntry { file, savedAt, profileName }`, `BackupFileData { savedAt: string; profile: Profile }`.
- Consumes: endpoints задачи 1 (мокается в тестах), `GET /api/profiles/:uuid/backups`.

- [ ] **Step 1: Падающий тест** `frontend/test/generate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { randomBase64, randomShortId, randomUuid, ssPassword } from '../src/entities/xray/generate'

describe('generate', () => {
  it('randomUuid — валидный UUID v4', () => {
    expect(randomUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('randomShortId — hex чётной длины, по умолчанию 8 символов', () => {
    expect(randomShortId()).toMatch(/^[0-9a-f]{8}$/)
    expect(randomShortId(8)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('randomShortId — значения не повторяются', () => {
    expect(randomShortId()).not.toBe(randomShortId())
  })

  it('ssPassword — длина ключа зависит от метода', () => {
    expect(atob(ssPassword('2022-blake3-aes-128-gcm'))).toHaveLength(16)
    expect(atob(ssPassword('2022-blake3-aes-256-gcm'))).toHaveLength(32)
    expect(atob(ssPassword('chacha20-ietf-poly1305'))).toHaveLength(16)
  })

  it('randomBase64 декодируется в исходную длину', () => {
    expect(atob(randomBase64(24))).toHaveLength(24)
  })
})
```

- [ ] **Step 2: FAIL**: `npm test -w frontend`.

- [ ] **Step 3: Реализация** `frontend/src/entities/xray/generate.ts`:

```ts
// Генераторы значений для форм (Web Crypto)

export function randomUuid(): string {
  return crypto.randomUUID()
}

export function randomShortId(bytes = 4): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomBase64(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...buf))
}

// Shadowsocks-2022 требует ключ фиксированной длины в base64; классические методы — любой пароль
export function ssPassword(method: string): string {
  if (method === '2022-blake3-aes-256-gcm') return randomBase64(32)
  return randomBase64(16)
}

export function trojanPassword(): string {
  return randomBase64(16)
}
```

В `frontend/src/shared/api/types.ts` добавить:

```ts
export interface BackupEntry {
  file: string
  savedAt: string
  profileName: string
}

export interface BackupFileData {
  savedAt: string
  profile: Profile
}
```

В `frontend/src/shared/api/hooks.ts` добавить (импортировав `BackupEntry` из `./types`):

```ts
export function useRealityKeypair() {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ privateKey: string; publicKey: string }>('/api/tools/reality-keypair', {
        method: 'POST',
      }),
  })
}

export function useRealityPublicKey() {
  return useMutation({
    mutationFn: (privateKey: string) =>
      apiFetch<{ publicKey: string }>('/api/tools/reality-public-key', {
        method: 'POST',
        body: JSON.stringify({ privateKey }),
      }),
  })
}

export function useBackups(uuid: string, enabled = true) {
  return useQuery({
    queryKey: ['profiles', uuid, 'backups'],
    queryFn: () =>
      apiFetch<{ backups: BackupEntry[] }>(`/api/profiles/${uuid}/backups`).then((r) => r.backups),
    enabled,
  })
}
```

Если `frontend/src/shared/api/index.ts` реэкспортирует hooks/types — новые имена подхватятся автоматически; проверить и при необходимости добавить.

- [ ] **Step 4: PASS + typecheck.**

- [ ] **Step 5: Commit**: `git add frontend/src/entities/xray/generate.ts frontend/src/shared/api/hooks.ts frontend/src/shared/api/types.ts frontend/test/generate.test.ts` (+ index-файлы, если менялись) `&& git commit -m "feat(frontend): value generators and reality/backups api hooks"`

---

### Task 4: Примитивы полей формы

**Files:**
- Create: `frontend/src/features/inspector/fields.tsx`
- Test: `frontend/test/inspector-fields.test.tsx`

**Interfaces:**
- Consumes: `Select`, `TextInput`, `Button` из shared/ui (задача 2).
- Produces: `Option { value, label }`, `Field({label, mono?, children})`, `TextField`, `PortField`, `NumberField`, `SelectField`, `StringListField`, `TagListField` — сигнатуры в коде ниже; все поля обёрнуты в `<label>`, поэтому доступны через `getByLabelText`.

- [ ] **Step 1: Падающий тест** `frontend/test/inspector-fields.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PortField, StringListField, TagListField, TextField } from '../src/features/inspector/fields'

describe('TextField', () => {
  it('пустая строка превращается в undefined (ключ удаляется)', async () => {
    const onChange = vi.fn()
    render(<TextField label="Тег" value="vless-in" onChange={onChange} />)
    await userEvent.clear(screen.getByLabelText('Тег'))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})

describe('PortField', () => {
  it('числовые строки становятся number, диапазоны остаются строкой', async () => {
    const onChange = vi.fn()
    render(<PortField label="Порт" value={undefined} onChange={onChange} />)
    const input = screen.getByLabelText('Порт')
    await userEvent.type(input, '8')
    expect(onChange).toHaveBeenLastCalledWith(8)
    await userEvent.type(input, '-9')
    expect(onChange).toHaveBeenLastCalledWith('8-9')
  })
})

describe('StringListField', () => {
  it('строки → массив, пустые отбрасываются', async () => {
    const onChange = vi.fn()
    render(<StringListField label="Имена" value={['a.com']} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Имена'), '\nb.com')
    expect(onChange).toHaveBeenLastCalledWith(['a.com', 'b.com'])
  })
})

describe('TagListField', () => {
  it('удаляет элемент по крестику и добавляет по кнопке', async () => {
    const onChange = vi.fn()
    const onAdd = vi.fn()
    render(
      <TagListField label="shortIds" value={['ab12', 'cd34']} onChange={onChange} onAdd={onAdd} addLabel="+ ID" />,
    )
    await userEvent.click(screen.getByLabelText('Удалить ab12'))
    expect(onChange).toHaveBeenCalledWith(['cd34'])
    await userEvent.click(screen.getByText('+ ID'))
    expect(onAdd).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация** `frontend/src/features/inspector/fields.tsx`:

```tsx
import { useState, type ReactNode } from 'react'
import { Button, Select, TextInput } from '../../shared/ui'

export interface Option {
  value: string
  label: string
}

export function Field({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <label className={mono ? 'field field-mono' : 'field'}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string
  value: string | undefined
  onChange: (v: string | undefined) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <Field label={label} mono={mono}>
      <TextInput
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      />
    </Field>
  )
}

// Порт может быть числом или строкой-диапазоном ("443-500") — числовые строки приводим к number
export function PortField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | string | undefined
  onChange: (v: number | string | undefined) => void
}) {
  return (
    <Field label={label}>
      <TextInput
        value={value === undefined ? '' : String(value)}
        placeholder="443"
        onChange={(e) => {
          const t = e.target.value.trim()
          onChange(t === '' ? undefined : /^\d+$/.test(t) ? Number(t) : t)
        }}
      />
    </Field>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  placeholder?: string
}) {
  return (
    <Field label={label}>
      <TextInput
        value={value === undefined ? '' : String(value)}
        placeholder={placeholder}
        inputMode="numeric"
        onChange={(e) => {
          const t = e.target.value.trim()
          if (t === '') return onChange(undefined)
          if (/^\d+$/.test(t)) onChange(Number(t))
        }}
      />
    </Field>
  )
}

export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Option[]
  onChange: (v: string) => void
}) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  )
}

// Локальный текст, чтобы не терять пустые строки во время набора; наружу уходит очищенный список.
// Значение из пропсов читается только при монтировании — внешние изменения требуют remount (key).
export function StringListField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string[] | undefined
  onChange: (v: string[] | undefined) => void
  placeholder?: string
}) {
  const [text, setText] = useState((value ?? []).join('\n'))
  return (
    <Field label={label} mono>
      <textarea
        className="textarea"
        rows={3}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value)
          const items = e.target.value
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
          onChange(items.length > 0 ? items : undefined)
        }}
      />
    </Field>
  )
}

// Список коротких значений чипами: добавление только генерацией (onAdd), удаление крестиком
export function TagListField({
  label,
  value,
  onChange,
  onAdd,
  addLabel,
}: {
  label: string
  value: string[] | undefined
  onChange: (v: string[] | undefined) => void
  onAdd: () => void
  addLabel: string
}) {
  const items = value ?? []
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="row-wrap">
        {items.map((s, i) => (
          <span key={`${s}:${i}`} className="taglist-item">
            {s}
            <button
              type="button"
              className="chip-x"
              aria-label={`Удалить ${s}`}
              onClick={() => {
                const next = items.filter((_, idx) => idx !== i)
                onChange(next.length > 0 ? next : undefined)
              }}
            >
              ✕
            </button>
          </span>
        ))}
        <Button onClick={onAdd}>{addLabel}</Button>
      </div>
    </div>
  )
}
```

Примечание: если задача 2 ещё не смерджена в вашу ветку, `Select` можно временно заимпортировать напрямую — но при выполнении по волнам задача 2 уже готова.

- [ ] **Step 4: PASS + typecheck.**

- [ ] **Step 5: Commit**: `git add frontend/src/features/inspector/fields.tsx frontend/test/inspector-fields.test.tsx && git commit -m "feat(frontend): inspector form field primitives"`

---

### Task 5: ClientsEditor (клиенты VLESS/Trojan)

**Files:**
- Create: `frontend/src/features/inspector/ClientsEditor.tsx`
- Test: `frontend/test/clients-editor.test.tsx`

**Interfaces:**
- Consumes: `TextField`, `SelectField`, `Option` (задача 4); `randomUuid`, `trojanPassword` (задача 3); `Button` (shared/ui).
- Produces: `ClientsEditor({ protocol: 'vless' | 'trojan', clients: Record<string, unknown>[], onChange(clients) })`.

- [ ] **Step 1: Падающий тест** `frontend/test/clients-editor.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ClientsEditor } from '../src/features/inspector/ClientsEditor'

describe('ClientsEditor', () => {
  it('vless: выбор flow добавляет поле, пустой flow удаляет ключ', async () => {
    const onChange = vi.fn()
    render(
      <ClientsEditor
        protocol="vless"
        clients={[{ id: 'u-1', email: 'a@b', extra: 42 }]}
        onChange={onChange}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'xtls-rprx-vision')
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'u-1', email: 'a@b', extra: 42, flow: 'xtls-rprx-vision' },
    ])
  })

  it('vless: сброс flow в «нет» удаляет ключ, неизвестные поля сохраняются', async () => {
    const onChange = vi.fn()
    render(
      <ClientsEditor
        protocol="vless"
        clients={[{ id: 'u-1', flow: 'xtls-rprx-vision', extra: 42 }]}
        onChange={onChange}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Flow'), '')
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'u-1', extra: 42 }])
  })

  it('добавляет клиента с готовым UUID (vless)', async () => {
    const onChange = vi.fn()
    render(<ClientsEditor protocol="vless" clients={[]} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Клиент'))
    const arg = onChange.mock.calls[0]![0] as Record<string, unknown>[]
    expect(arg).toHaveLength(1)
    expect(arg[0]!.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('удаляет клиента', async () => {
    const onChange = vi.fn()
    render(
      <ClientsEditor protocol="trojan" clients={[{ password: 'p1' }, { password: 'p2' }]} onChange={onChange} />,
    )
    await userEvent.click(screen.getByLabelText('Удалить клиента 1'))
    expect(onChange).toHaveBeenCalledWith([{ password: 'p2' }])
  })

  it('trojan: показывает поле пароля', () => {
    render(<ClientsEditor protocol="trojan" clients={[{ password: 'p1' }]} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Пароль')).toHaveValue('p1')
  })
})
```

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация** `frontend/src/features/inspector/ClientsEditor.tsx`:

```tsx
import { Button } from '../../shared/ui'
import { randomUuid, trojanPassword } from '../../entities/xray/generate'
import { SelectField, TextField, type Option } from './fields'

type Obj = Record<string, unknown>

const FLOWS: Option[] = [
  { value: '', label: 'нет' },
  { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
]

interface Props {
  protocol: 'vless' | 'trojan'
  clients: Obj[]
  onChange: (clients: Obj[]) => void
}

export function ClientsEditor({ protocol, clients, onChange }: Props) {
  function updateClient(index: number, patch: Obj) {
    onChange(
      clients.map((c, i) => {
        if (i !== index) return c
        const next: Obj = { ...c, ...patch }
        // undefined в патче означает «удалить ключ»
        for (const key of Object.keys(patch)) {
          if (next[key] === undefined) delete next[key]
        }
        return next
      }),
    )
  }

  function addClient() {
    onChange([...clients, protocol === 'vless' ? { id: randomUuid() } : { password: trojanPassword() }])
  }

  return (
    <div className="field">
      <span className="field-label">Клиенты ({clients.length})</span>
      {clients.map((client, i) => (
        <div key={i} className="client-card">
          <div className="row">
            <span className="muted">#{i + 1}</span>
            <span className="spacer" />
            <Button
              variant="ghost"
              aria-label={`Удалить клиента ${i + 1}`}
              onClick={() => onChange(clients.filter((_, idx) => idx !== i))}
            >
              ✕
            </Button>
          </div>
          {protocol === 'vless' && (
            <>
              <TextField label="UUID" mono value={client.id as string | undefined} onChange={(v) => updateClient(i, { id: v })} />
              <Button variant="ghost" onClick={() => updateClient(i, { id: randomUuid() })}>
                Сгенерировать UUID
              </Button>
              <SelectField
                label="Flow"
                value={(client.flow as string) ?? ''}
                options={FLOWS}
                onChange={(v) => updateClient(i, { flow: v === '' ? undefined : v })}
              />
            </>
          )}
          {protocol === 'trojan' && (
            <>
              <TextField
                label="Пароль"
                mono
                value={client.password as string | undefined}
                onChange={(v) => updateClient(i, { password: v })}
              />
              <Button variant="ghost" onClick={() => updateClient(i, { password: trojanPassword() })}>
                Сгенерировать пароль
              </Button>
            </>
          )}
          <TextField label="Email (метка)" value={client.email as string | undefined} onChange={(v) => updateClient(i, { email: v })} />
        </div>
      ))}
      <Button onClick={addClient}>+ Клиент</Button>
    </div>
  )
}
```

- [ ] **Step 4: PASS + typecheck.**

- [ ] **Step 5: Commit**: `git add frontend/src/features/inspector/ClientsEditor.tsx frontend/test/clients-editor.test.tsx && git commit -m "feat(frontend): clients editor for vless/trojan inbounds"`

---

### Task 6: StreamForm (транспорт, TLS, Reality с генерацией ключей)

**Files:**
- Create: `frontend/src/features/inspector/StreamForm.tsx`
- Test: `frontend/test/stream-form.test.tsx`

**Interfaces:**
- Consumes: примитивы задачи 4; `randomShortId` (задача 3); `useRealityKeypair`, `useRealityPublicKey` (задача 3).
- Produces: `StreamForm({ value: Record<string, unknown> /* streamSettings */, onChange(next) })`. Reality-поля: dest/target (редактируется существующий ключ, по умолчанию `dest` — Xray ≥24.09 понимает оба), serverNames, privateKey (+генерация), shortIds (чипы), fingerprint.

- [ ] **Step 1: Падающий тест** `frontend/test/stream-form.test.tsx`. Тестам нужен QueryClientProvider и мок fetch — повторите паттерн обёртки из `frontend/test/node-inspector.test.tsx` / `frontend/test/login.test.tsx` (QueryClientProvider с retry: false; `vi.stubGlobal('fetch', ...)`).

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StreamForm } from '../src/features/inspector/StreamForm'

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('StreamForm', () => {
  it('смена security на reality создаёт realitySettings, посторонние поля сохраняются', async () => {
    const onChange = vi.fn()
    wrap(<StreamForm value={{ network: 'tcp', security: 'none', sockopt: { mark: 1 } }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Шифрование'), 'reality')
    expect(onChange).toHaveBeenLastCalledWith({
      network: 'tcp',
      security: 'reality',
      sockopt: { mark: 1 },
      realitySettings: {},
    })
  })

  it('reality: редактирует существующий ключ target, а не создаёт dest', async () => {
    const onChange = vi.fn()
    wrap(
      <StreamForm
        value={{ security: 'reality', realitySettings: { target: 'a.com:443' } }}
        onChange={onChange}
      />,
    )
    const input = screen.getByLabelText('Цель маскировки (dest)')
    expect(input).toHaveValue('a.com:443')
    await userEvent.type(input, 'x')
    const next = onChange.mock.lastCall![0] as { realitySettings: Record<string, unknown> }
    expect(next.realitySettings.target).toBe('a.com:443x')
    expect(next.realitySettings.dest).toBeUndefined()
  })

  it('кнопка «Сгенерировать ключи» подставляет privateKey и показывает публичный', async () => {
    const onChange = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ privateKey: 'PRIV_43', publicKey: 'PUB_43' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    wrap(<StreamForm value={{ security: 'reality', realitySettings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByText('Сгенерировать ключи'))
    await waitFor(() => expect(screen.getByText(/PUB_43/)).toBeInTheDocument())
    const next = onChange.mock.lastCall![0] as { realitySettings: Record<string, unknown> }
    expect(next.realitySettings.privateKey).toBe('PRIV_43')
    vi.unstubAllGlobals()
  })

  it('добавляет короткий ID кнопкой «+ ID»', async () => {
    const onChange = vi.fn()
    wrap(<StreamForm value={{ security: 'reality', realitySettings: { shortIds: ['aa11'] } }} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ ID'))
    const next = onChange.mock.lastCall![0] as { realitySettings: { shortIds: string[] } }
    expect(next.realitySettings.shortIds).toHaveLength(2)
    expect(next.realitySettings.shortIds[1]).toMatch(/^[0-9a-f]{8}$/)
  })

  it('ws: показывает поле пути', async () => {
    const onChange = vi.fn()
    wrap(<StreamForm value={{ network: 'ws', security: 'none' }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Путь WebSocket'), '/ws')
    const next = onChange.mock.lastCall![0] as { wsSettings: Record<string, unknown> }
    expect(next.wsSettings.path).toBe('/ws')
  })
})
```

(Если существующие тесты используют другой хелпер мока fetch — используйте его; контракт тестов не менять.)

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация** `frontend/src/features/inspector/StreamForm.tsx`:

```tsx
import { Button } from '../../shared/ui'
import { randomShortId } from '../../entities/xray/generate'
import { useRealityKeypair, useRealityPublicKey } from '../../shared/api'
import { SelectField, StringListField, TagListField, TextField, type Option } from './fields'

type Obj = Record<string, unknown>

const NETWORKS: Option[] = [
  { value: 'tcp', label: 'TCP' },
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

interface Props {
  value: Obj // streamSettings целиком
  onChange: (next: Obj) => void
}

export function StreamForm({ value, onChange }: Props) {
  const keypair = useRealityKeypair()
  const derive = useRealityPublicKey()
  const network = (value.network as string) ?? 'tcp'
  const security = (value.security as string) ?? 'none'
  const reality = (value.realitySettings as Obj) ?? {}
  const tls = (value.tlsSettings as Obj) ?? {}

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
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
        <TextField
          label="Путь WebSocket"
          mono
          placeholder="/ws"
          value={(value.wsSettings as Obj | undefined)?.path as string | undefined}
          onChange={(v) => patch((n) => { n.wsSettings = { ...((n.wsSettings as Obj) ?? {}), path: v } })}
        />
      )}
      {network === 'grpc' && (
        <TextField
          label="Имя gRPC-сервиса"
          mono
          value={(value.grpcSettings as Obj | undefined)?.serviceName as string | undefined}
          onChange={(v) => patch((n) => { n.grpcSettings = { ...((n.grpcSettings as Obj) ?? {}), serviceName: v } })}
        />
      )}
      {network === 'httpupgrade' && (
        <TextField
          label="Путь HTTPUpgrade"
          mono
          placeholder="/upgrade"
          value={(value.httpupgradeSettings as Obj | undefined)?.path as string | undefined}
          onChange={(v) => patch((n) => { n.httpupgradeSettings = { ...((n.httpupgradeSettings as Obj) ?? {}), path: v } })}
        />
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
              onClick={() =>
                keypair.mutate(undefined, {
                  onSuccess: (keys) => patchReality((r) => { r.privateKey = keys.privateKey }),
                })
              }
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

- [ ] **Step 4: PASS + typecheck.**

- [ ] **Step 5: Commit**: `git add frontend/src/features/inspector/StreamForm.tsx frontend/test/stream-form.test.tsx && git commit -m "feat(frontend): stream/reality form with key generation"`

---

### Task 7: OutboundForm (freedom, blackhole, WireGuard/WARP)

**Files:**
- Create: `frontend/src/features/inspector/OutboundForm.tsx`
- Test: `frontend/test/outbound-form.test.tsx`

**Interfaces:**
- Consumes: примитивы задачи 4.
- Produces: `OutboundForm({ value: Record<string, unknown> /* outbound целиком */, onChange(next) })`; экспорт `WARP_TEMPLATE` (для теста).

- [ ] **Step 1: Падающий тест** `frontend/test/outbound-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OutboundForm, WARP_TEMPLATE } from '../src/features/inspector/OutboundForm'

describe('OutboundForm', () => {
  it('freedom: смена domainStrategy, посторонние поля сохраняются', async () => {
    const onChange = vi.fn()
    render(
      <OutboundForm value={{ tag: 'direct', protocol: 'freedom', settings: {}, custom: 1 }} onChange={onChange} />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Стратегия доменов'), 'UseIP')
    expect(onChange).toHaveBeenLastCalledWith({
      tag: 'direct',
      protocol: 'freedom',
      settings: { domainStrategy: 'UseIP' },
      custom: 1,
    })
  })

  it('wireguard: кнопка WARP заполняет шаблон', async () => {
    const onChange = vi.fn()
    render(<OutboundForm value={{ tag: 'warp', protocol: 'wireguard' }} onChange={onChange} />)
    await userEvent.click(screen.getByText('Заполнить шаблон WARP'))
    expect(onChange).toHaveBeenLastCalledWith({ tag: 'warp', protocol: 'wireguard', settings: WARP_TEMPLATE })
  })

  it('wireguard: правка publicKey пира не трогает остальное', async () => {
    const onChange = vi.fn()
    render(
      <OutboundForm
        value={{
          tag: 'warp',
          protocol: 'wireguard',
          settings: { secretKey: 'sk', peers: [{ publicKey: 'pk', endpoint: 'e:1', keepAlive: 25 }] },
        }}
        onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('Публичный ключ пира'), 'X')
    const next = onChange.mock.lastCall![0] as { settings: { peers: Record<string, unknown>[] } }
    expect(next.settings.peers[0]).toEqual({ publicKey: 'pkX', endpoint: 'e:1', keepAlive: 25 })
  })

  it('для socks показывает подсказку про JSON', () => {
    render(<OutboundForm value={{ tag: 's', protocol: 'socks' }} onChange={vi.fn()} />)
    expect(screen.getByText(/редактируются на вкладке JSON/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация** `frontend/src/features/inspector/OutboundForm.tsx`:

```tsx
import { Button } from '../../shared/ui'
import { NumberField, SelectField, StringListField, TextField, type Option } from './fields'

type Obj = Record<string, unknown>

const PROTOCOLS: Option[] = [
  { value: 'freedom', label: 'freedom — прямой выход' },
  { value: 'blackhole', label: 'blackhole — блокировка' },
  { value: 'wireguard', label: 'wireguard — WARP и другие' },
  { value: 'socks', label: 'socks — внешний прокси' },
  { value: 'http', label: 'http — внешний прокси' },
  { value: 'vless', label: 'vless — цепочка серверов' },
]

const DOMAIN_STRATEGIES: Option[] = [
  { value: '', label: 'AsIs (по умолчанию)' },
  { value: 'UseIP', label: 'UseIP' },
  { value: 'UseIPv4', label: 'UseIPv4' },
  { value: 'UseIPv6', label: 'UseIPv6' },
]

// Публичный ключ WARP-пира Cloudflare и endpoint одинаковы для всех аккаунтов;
// secretKey и address выдаются при регистрации устройства (wgcf / приложение WARP)
export const WARP_TEMPLATE: Obj = {
  secretKey: 'ВСТАВЬТЕ_ПРИВАТНЫЙ_КЛЮЧ_WARP',
  address: ['172.16.0.2/32'],
  mtu: 1280,
  peers: [
    {
      publicKey: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
      endpoint: 'engage.cloudflareclient.com:2408',
      allowedIPs: ['0.0.0.0/0', '::/0'],
    },
  ],
}

interface Props {
  value: Obj // outbound целиком
  onChange: (next: Obj) => void
}

export function OutboundForm({ value, onChange }: Props) {
  const protocol = (value.protocol as string) ?? 'freedom'
  const settings = (value.settings as Obj) ?? {}
  const peer = ((settings.peers as Obj[]) ?? [])[0] ?? {}

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

  function patchPeer(mut: (p: Obj) => void) {
    patchSettings((s) => {
      const list = ((s.peers as Obj[]) ?? []).map((p) => ({ ...p }))
      if (list.length === 0) list.push({})
      mut(list[0]!)
      s.peers = list
    })
  }

  return (
    <>
      <TextField label="Тег" mono value={value.tag as string | undefined} onChange={(v) => patch((n) => { if (v === undefined) delete n.tag; else n.tag = v })} />
      <SelectField label="Протокол" value={protocol} options={PROTOCOLS} onChange={(v) => patch((n) => { n.protocol = v })} />

      {protocol === 'freedom' && (
        <SelectField
          label="Стратегия доменов"
          value={(settings.domainStrategy as string) ?? ''}
          options={DOMAIN_STRATEGIES}
          onChange={(v) => patchSettings((s) => { if (v === '') delete s.domainStrategy; else s.domainStrategy = v })}
        />
      )}

      {protocol === 'blackhole' && (
        <p className="muted" style={{ margin: 0 }}>Блокирует весь трафик, направленный в этот outbound.</p>
      )}

      {protocol === 'wireguard' && (
        <>
          <Button onClick={() => patch((n) => { n.settings = structuredClone(WARP_TEMPLATE) })}>
            Заполнить шаблон WARP
          </Button>
          <p className="muted" style={{ margin: 0 }}>
            secretKey и address выдаёт Cloudflare при регистрации устройства (утилита wgcf).
          </p>
          <TextField label="Приватный ключ (secretKey)" mono value={settings.secretKey as string | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.secretKey; else s.secretKey = v })} />
          <StringListField label="Адреса интерфейса" placeholder="172.16.0.2/32" value={settings.address as string[] | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.address; else s.address = v })} />
          <TextField label="Публичный ключ пира" mono value={peer.publicKey as string | undefined}
            onChange={(v) => patchPeer((p) => { if (v === undefined) delete p.publicKey; else p.publicKey = v })} />
          <TextField label="Endpoint пира" mono placeholder="engage.cloudflareclient.com:2408" value={peer.endpoint as string | undefined}
            onChange={(v) => patchPeer((p) => { if (v === undefined) delete p.endpoint; else p.endpoint = v })} />
          <StringListField label="AllowedIPs пира" placeholder={'0.0.0.0/0\n::/0'} value={peer.allowedIPs as string[] | undefined}
            onChange={(v) => patchPeer((p) => { if (v === undefined) delete p.allowedIPs; else p.allowedIPs = v })} />
          <NumberField label="MTU" placeholder="1280" value={settings.mtu as number | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.mtu; else s.mtu = v })} />
        </>
      )}

      {(protocol === 'socks' || protocol === 'http' || protocol === 'vless') && (
        <p className="muted" style={{ margin: 0 }}>
          Настройки протокола «{protocol}» редактируются на вкладке JSON узла.
        </p>
      )}
    </>
  )
}
```

- [ ] **Step 4: PASS + typecheck.**

- [ ] **Step 5: Commit**: `git add frontend/src/features/inspector/OutboundForm.tsx frontend/test/outbound-form.test.tsx && git commit -m "feat(frontend): outbound form with warp template"`

---

### Task 8: InboundForm и интеграция в NodeInspector

**Files:**
- Create: `frontend/src/features/inspector/InboundForm.tsx`
- Modify: `frontend/src/features/topology/NodeInspector.tsx` (полная замена — код ниже)
- Modify: `frontend/src/features/editor/EditorPage.tsx` (проп `inboundSquads`)
- Test: `frontend/test/inbound-form.test.tsx`, обновить `frontend/test/node-inspector.test.tsx`

**Interfaces:**
- Consumes: `ClientsEditor` (5), `StreamForm` (6), `OutboundForm` (7), примитивы (4), `ssPassword` (3).
- Produces: `InboundForm({ value, onChange })`; новый проп NodeInspector `inboundSquads?: Record<string, string[]>`. Контракт `onApply(value: unknown)` не меняется.

- [ ] **Step 1: Падающие тесты.**

`frontend/test/inbound-form.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InboundForm } from '../src/features/inspector/InboundForm'

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const VLESS = {
  tag: 'vless-in',
  port: 443,
  protocol: 'vless',
  settings: { clients: [{ id: 'u1' }], decryption: 'none' },
  streamSettings: { network: 'tcp', security: 'none' },
  sniffing: { enabled: true, destOverride: ['http'] },
  unknownField: { keep: true },
}

describe('InboundForm', () => {
  it('правка тега сохраняет все остальные поля, включая неизвестные', async () => {
    const onChange = vi.fn()
    wrap(<InboundForm value={VLESS} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Тег'), '2')
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.tag).toBe('vless-in2')
    expect(next.unknownField).toEqual({ keep: true })
    expect(next.settings).toEqual({ clients: [{ id: 'u1' }], decryption: 'none' })
  })

  it('смена протокола на shadowsocks показывает метод и пароль', async () => {
    const onChange = vi.fn()
    wrap(<InboundForm value={{ ...VLESS, protocol: 'shadowsocks', settings: {} }} onChange={onChange} />)
    expect(screen.getByLabelText('Метод шифрования')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Сгенерировать пароль'))
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(typeof next.settings.password).toBe('string')
  })

  it('переключение на vless дополняет settings decryption/clients', async () => {
    const onChange = vi.fn()
    wrap(<InboundForm value={{ tag: 't', protocol: 'trojan', settings: { clients: [] } }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Протокол'), 'vless')
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings.decryption).toBe('none')
  })

  it('sniffing переключается чекбоксом', async () => {
    const onChange = vi.fn()
    wrap(<InboundForm value={VLESS} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Sniffing включён'))
    const next = onChange.mock.lastCall![0] as { sniffing: Record<string, unknown> }
    expect(next.sniffing).toEqual({ enabled: false, destOverride: ['http'] })
  })
})
```

В `frontend/test/node-inspector.test.tsx` добавить (и поправить существующие тесты: инспектор для `in:`/`out:` узлов теперь открывается на вкладке «Форма» — тестам, работающим с CodeMirror, нужно сначала `await userEvent.click(screen.getByText('JSON узла'))`; узлы `rule:`/`dns` — без вкладок, как раньше):

```tsx
it('отклоняет не-объект: "Применить" показывает ошибку и не вызывает onApply', async () => {
  // рендер инспектора для in:vless-in, вкладка «JSON узла», ввести текст «123»
  // (через существующий в файле механизм правки CodeMirror), нажать «Применить»
  // ожидание: onApply не вызван, виден текст «Узел должен быть JSON-объектом»
})

it('смена тега inbound со сквадами требует подтверждения', async () => {
  // props: nodeId="in:vless-in", inboundSquads={{ 'vless-in': ['squad-1'] }}
  // ввести JSON с tag: "renamed", нажать «Применить»
  // ожидание: onApply НЕ вызван, открыт диалог «Смена тега inbound»
  // клик «Сменить тег» → onApply вызван с новым значением
})

it('смена тега без сквадов применяется без подтверждения', async () => {
  // inboundSquads={{}} → onApply вызывается сразу
})
```

(Псевдокомментарии выше — план сценария; реализуйте их по образцу существующих тестов файла, который уже умеет вводить текст в CodeMirror.)

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация.**

`frontend/src/features/inspector/InboundForm.tsx`:

```tsx
import { Button, Checkbox } from '../../shared/ui'
import { ssPassword } from '../../entities/xray/generate'
import { ClientsEditor } from './ClientsEditor'
import { StreamForm } from './StreamForm'
import { PortField, SelectField, TextField, type Option } from './fields'

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

interface Props {
  value: Obj // inbound целиком
  onChange: (next: Obj) => void
}

export function InboundForm({ value, onChange }: Props) {
  const protocol = (value.protocol as string) ?? 'vless'
  const settings = (value.settings as Obj) ?? {}
  const sniffing = (value.sniffing as Obj) ?? {}

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
            n.protocol = v
            if (v === 'vless') {
              // VLESS требует decryption: 'none'
              const s = (n.settings as Obj) ?? {}
              if (s.decryption === undefined) s.decryption = 'none'
              if (s.clients === undefined) s.clients = []
              n.settings = s
            }
          })
        }
      />

      {(protocol === 'vless' || protocol === 'trojan') && (
        <>
          <ClientsEditor
            protocol={protocol}
            clients={(settings.clients as Obj[]) ?? []}
            onChange={(clients) => patchSettings((s) => { s.clients = clients })}
          />
          <p className="muted" style={{ margin: 0 }}>
            Пользователи панели Remnawave добавляются в inbound автоматически — здесь только статические клиенты.
          </p>
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
        onChange={(stream) => patch((n) => { n.streamSettings = stream })} />

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

`frontend/src/features/topology/NodeInspector.tsx` — полная замена:

```tsx
import { useMemo, useState } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import type { XrayConfig } from '../../entities/xray'
import { getNodeJson } from '../../entities/graph/mutations'
import { Button, Dialog } from '../../shared/ui'
import { InboundForm } from '../inspector/InboundForm'
import { OutboundForm } from '../inspector/OutboundForm'

const inspectorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg)', fontSize: '12px' },
  '.cm-content': { fontFamily: 'var(--font-mono)' },
})

type Obj = Record<string, unknown>

interface Props {
  config: XrayConfig
  nodeId: string
  inboundSquads?: Record<string, string[]>
  onApply: (value: unknown) => void
  onRemove: () => void
  onClose: () => void
}

function parseNode(text: string): Obj | null {
  try {
    const v = JSON.parse(text) as unknown
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null
  } catch {
    return null
  }
}

export function NodeInspector({ config, nodeId, inboundSquads, onApply, onRemove, onClose }: Props) {
  const original = useMemo(() => JSON.stringify(getNodeJson(config, nodeId) ?? {}, null, 2), [config, nodeId])
  const [text, setText] = useState(original)
  const [parseError, setParseError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [retagValue, setRetagValue] = useState<Obj | null>(null)
  const extensions = useMemo(() => [json(), inspectorTheme], [])

  const kind = nodeId.startsWith('in:') ? 'inbound' : nodeId.startsWith('out:') ? 'outbound' : 'other'
  const [tab, setTab] = useState<'form' | 'json'>(kind === 'other' ? 'json' : 'form')
  const parsedNode = useMemo(() => parseNode(text), [text])
  const oldTag = kind === 'inbound' ? nodeId.slice(3) : ''

  function apply() {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setParseError('Некорректный JSON')
      return
    }
    // Узел конфига — всегда объект; число или массив молча сломали бы конфиг
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setParseError('Узел должен быть JSON-объектом')
      return
    }
    setParseError(null)
    const node = parsed as Obj
    if (kind === 'inbound' && node.tag !== oldTag && (inboundSquads?.[oldTag]?.length ?? 0) > 0) {
      // Панель привязывает сквады к тегу — предупреждаем о потере привязки
      setRetagValue(node)
      return
    }
    onApply(node)
  }

  return (
    <aside
      style={{
        width: 420, flex: 'none', display: 'flex', flexDirection: 'column', gap: 8,
        border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--surface)',
      }}
    >
      <div className="row">
        <span className="mono">{nodeId}</span>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose} aria-label="Закрыть">✕</Button>
      </div>

      {kind !== 'other' && (
        <div className="row" style={{ gap: 4 }}>
          <Button variant={tab === 'form' ? 'primary' : 'ghost'} onClick={() => setTab('form')}>Форма</Button>
          <Button variant={tab === 'json' ? 'primary' : 'ghost'} onClick={() => setTab('json')}>JSON узла</Button>
        </div>
      )}

      {tab === 'form' && kind !== 'other' && (
        <div className="inspector-form">
          {parsedNode === null && <p className="muted">JSON узла некорректен — исправьте его на вкладке «JSON узла».</p>}
          {parsedNode !== null && kind === 'inbound' && (
            <InboundForm value={parsedNode} onChange={(next) => setText(JSON.stringify(next, null, 2))} />
          )}
          {parsedNode !== null && kind === 'outbound' && (
            <OutboundForm value={parsedNode} onChange={(next) => setText(JSON.stringify(next, null, 2))} />
          )}
        </div>
      )}

      {(tab === 'json' || kind === 'other') && (
        <CodeMirror
          key={`${nodeId}:${original}`}
          value={text}
          height="calc(100vh - 380px)"
          theme="dark"
          extensions={extensions}
          onChange={setText}
        />
      )}

      {parseError && <span className="field-error">{parseError}</span>}
      <div className="row">
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>Удалить узел</Button>
        <span className="spacer" />
        <Button variant="primary" onClick={apply} disabled={text === original}>Применить</Button>
      </div>

      <Dialog open={confirmOpen} title="Удалить узел" onClose={() => setConfirmOpen(false)}>
        <p>Удалить «{nodeId}» из конфига? Ссылки правил на него останутся и будут подсвечены как предупреждения.</p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Отмена</Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmOpen(false)
              onRemove()
            }}
          >
            Удалить
          </Button>
        </div>
      </Dialog>

      <Dialog open={retagValue !== null} title="Смена тега inbound" onClose={() => setRetagValue(null)}>
        <p>
          К тегу «{oldTag}» в панели привязаны сквады ({(inboundSquads?.[oldTag] ?? []).length}). После смены тега
          панель потеряет привязку — сквады придётся включить заново.
        </p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setRetagValue(null)}>Отмена</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (retagValue) onApply(retagValue)
              setRetagValue(null)
            }}
          >
            Сменить тег
          </Button>
        </div>
      </Dialog>
    </aside>
  )
}
```

В `frontend/src/features/editor/EditorPage.tsx` — в JSX `<NodeInspector ...>` добавить проп `inboundSquads={ctx.inboundSquads}`.

- [ ] **Step 4: PASS всех фронтенд-тестов + typecheck** (существующие node-inspector-тесты обновлены под вкладки).

- [ ] **Step 5: Commit**: `git add frontend/src/features/inspector/InboundForm.tsx frontend/src/features/topology/NodeInspector.tsx frontend/src/features/editor/EditorPage.tsx frontend/test/inbound-form.test.tsx frontend/test/node-inspector.test.tsx && git commit -m "feat(frontend): protocol forms in node inspector with retag guard"`

---

### Task 9: Пресеты в CreateProfileDialog

**Files:**
- Modify: `frontend/src/features/profiles/CreateProfileDialog.tsx`
- Test: обновить `frontend/test/profiles-page.test.tsx` (или создать `frontend/test/create-profile.test.tsx`)

**Interfaces:**
- Consumes: `useRealityKeypair`, `randomShortId` (задача 3), `Select` (задача 2).
- Produces: экспорты `TEMPLATE` (без изменений!) и новый `realityTemplate(privateKey: string, shortId: string)`.

- [ ] **Step 1: Падающий тест** `frontend/test/create-profile.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { TEMPLATE, realityTemplate } from '../src/features/profiles/CreateProfileDialog'

describe('шаблоны профилей', () => {
  it('минимальный шаблон не изменился (A112: минимум один inbound)', () => {
    expect((TEMPLATE.inbounds as unknown[]).length).toBeGreaterThan(0)
  })

  it('reality-шаблон содержит ключ, shortId и security reality', () => {
    const cfg = realityTemplate('PRIVKEY', 'ab12cd34') as {
      inbounds: { streamSettings: { security: string; realitySettings: Record<string, unknown> } }[]
    }
    const rs = cfg.inbounds[0]!.streamSettings.realitySettings
    expect(cfg.inbounds[0]!.streamSettings.security).toBe('reality')
    expect(rs.privateKey).toBe('PRIVKEY')
    expect(rs.shortIds).toEqual(['ab12cd34'])
    expect(rs.serverNames).toEqual(['yahoo.com', 'www.yahoo.com'])
  })
})
```

UI-тест выбора пресета: в тесте с рендером диалога (по образцу profiles-page.test.tsx) выбрать «VLESS Reality Vision», замокать fetch так, чтобы `POST /api/tools/reality-keypair` вернул `{privateKey:'PK', publicKey:'PB'}`, а `POST /api/profiles` — созданный профиль; проверить, что в теле POST /api/profiles конфиг содержит `"privateKey":"PK"`.

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация.** В `CreateProfileDialog.tsx`:

Добавить импорты `useRealityKeypair` из `../../shared/api`, `randomShortId` из `../../entities/xray/generate`, `Select` из shared/ui. После `TEMPLATE` добавить:

```tsx
// Шаблон VLESS + Reality (Vision): ключи и shortId передаются при создании
export function realityTemplate(privateKey: string, shortId: string) {
  return {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        tag: 'vless-reality',
        port: 443,
        protocol: 'vless',
        settings: { clients: [], decryption: 'none' },
        streamSettings: {
          network: 'tcp',
          security: 'reality',
          realitySettings: {
            show: false,
            dest: 'yahoo.com:443',
            xver: 0,
            serverNames: ['yahoo.com', 'www.yahoo.com'],
            privateKey,
            shortIds: [shortId],
          },
        },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
      },
    ],
    outbounds: [
      { tag: 'direct', protocol: 'freedom', settings: {} },
      { tag: 'block', protocol: 'blackhole', settings: {} },
    ],
    routing: { rules: [] },
  }
}
```

В компоненте:

```tsx
type Preset = 'minimal' | 'reality'
// внутри компонента:
const [preset, setPreset] = useState<Preset>('minimal')
const keypair = useRealityKeypair()
const busy = create.isPending || keypair.isPending

async function submit() {
  let config: unknown = TEMPLATE
  if (preset === 'reality') {
    let keys
    try {
      keys = await keypair.mutateAsync()
    } catch {
      return // ошибка показана через keypair.isError
    }
    config = realityTemplate(keys.privateKey, randomShortId())
  }
  create.mutate({ name, config }, { onSuccess: (profile) => navigate(`/profiles/${profile.uuid}`) })
}
```

В JSX между полем имени и кнопками:

```tsx
<label className="field">
  <span className="field-label">Шаблон</span>
  <Select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
    <option value="minimal">Минимальный VLESS (TCP)</option>
    <option value="reality">VLESS Reality Vision</option>
  </Select>
</label>
{preset === 'reality' && (
  <p className="muted">Reality-ключи и короткий ID будут сгенерированы автоматически при создании.</p>
)}
{keypair.isError && <span className="field-error">{(keypair.error as Error).message}</span>}
```

Кнопка «Создать»: `disabled={!NAME_RE.test(name) || busy}`, `onClick={submit}`.

- [ ] **Step 4: PASS + typecheck.**

- [ ] **Step 5: Commit**: `git add frontend/src/features/profiles/CreateProfileDialog.tsx frontend/test/create-profile.test.tsx frontend/test/profiles-page.test.tsx && git commit -m "feat(frontend): profile presets with auto-generated reality keys"`

---

### Task 10: Панель бэкапов

**Files:**
- Create: `frontend/src/features/editor/BackupsDialog.tsx`
- Modify: `frontend/src/features/editor/EditorPage.tsx`
- Test: `frontend/test/backups-dialog.test.tsx`

**Interfaces:**
- Consumes: `useBackups`, `BackupFileData`, `apiFetch` (задача 3 / shared/api), `relativeTime`, `Dialog`, `Button`.
- Produces: `BackupsDialog({ open, profileUuid, onRestore: (configText: string) => void, onClose })`. Восстановление кладёт конфиг в черновик (существующий флоу сохранения/конфликтов не меняется).

- [ ] **Step 1: Падающий тест** `frontend/test/backups-dialog.test.tsx` (обёртка QueryClientProvider + мок fetch по образцу существующих тестов):

```tsx
// сценарии:
// 1) open=true → GET /api/profiles/:uuid/backups; список показывает имя профиля и обе записи
// 2) пустой список → текст «Бэкапов пока нет.»
// 3) клик «В черновик» → GET /api/profiles/:uuid/backups/:file, onRestore вызван
//    с JSON.stringify(config, null, 2) содержимого бэкапа, onClose вызван
// мок-данные:
// backups: [{ file: 'a.json', savedAt: '2026-07-20T10:00:00.000Z', profileName: 'Germany' },
//           { file: 'b.json', savedAt: '2026-07-19T10:00:00.000Z', profileName: 'Germany' }]
// файл: { savedAt: '...', profile: { ...профиль..., config: { inbounds: [] } } }
```

Реализуйте эти три сценария полноценными тестами по паттерну файла `frontend/test/profiles-page.test.tsx`.

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация** `frontend/src/features/editor/BackupsDialog.tsx`:

```tsx
import { useState } from 'react'
import { apiFetch, useBackups, type BackupFileData } from '../../shared/api'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Dialog } from '../../shared/ui'

interface Props {
  open: boolean
  profileUuid: string
  onRestore: (configText: string) => void
  onClose: () => void
}

export function BackupsDialog({ open, profileUuid, onRestore, onClose }: Props) {
  const backups = useBackups(profileUuid, open)
  const [error, setError] = useState<string | null>(null)
  const [busyFile, setBusyFile] = useState<string | null>(null)

  async function restore(file: string) {
    setBusyFile(file)
    setError(null)
    try {
      const data = await apiFetch<BackupFileData>(`/api/profiles/${profileUuid}/backups/${file}`)
      onRestore(JSON.stringify(data.profile.config, null, 2))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyFile(null)
    }
  }

  return (
    <Dialog open={open} title="Бэкапы профиля" onClose={onClose}>
      <p className="muted">
        Бэкап создаётся автоматически перед каждым сохранением в панель. Восстановление кладёт конфиг в
        черновик — панель изменится только после «Сохранить в панель».
      </p>
      {backups.isPending && <p className="muted">Загрузка…</p>}
      {backups.isError && <p className="field-error">{(backups.error as Error).message}</p>}
      {backups.data && backups.data.length === 0 && <p className="muted">Бэкапов пока нет.</p>}
      {backups.data && backups.data.length > 0 && (
        <div className="backup-list">
          {backups.data.map((b) => (
            <div key={b.file} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div>{b.profileName}</div>
                <div className="muted mono" style={{ fontSize: 12 }}>
                  {new Date(b.savedAt).toLocaleString('ru-RU')} · {relativeTime(b.savedAt)}
                </div>
              </div>
              <span className="spacer" />
              <Button disabled={busyFile !== null} onClick={() => restore(b.file)}>
                {busyFile === b.file ? 'Загрузка…' : 'В черновик'}
              </Button>
            </div>
          ))}
        </div>
      )}
      {error && <span className="field-error">{error}</span>}
      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>Закрыть</Button>
      </div>
    </Dialog>
  )
}
```

В `EditorPage.tsx` (внутри `EditorInner`): добавить `const [backupsOpen, setBackupsOpen] = useState(false)`; в строке вкладок добавить кнопку `<Button variant="ghost" onClick={() => setBackupsOpen(true)}>Бэкапы</Button>` ПЕРЕД кнопкой «Сбросить к версии панели»; в конце JSX добавить:

```tsx
<BackupsDialog
  open={backupsOpen}
  profileUuid={profile.uuid}
  onRestore={(configText) => setDraft(profile.uuid, configText, draft?.baseUpdatedAt ?? profile.updatedAt)}
  onClose={() => setBackupsOpen(false)}
/>
```

- [ ] **Step 4: PASS + typecheck.**

- [ ] **Step 5: Commit**: `git add frontend/src/features/editor/BackupsDialog.tsx frontend/src/features/editor/EditorPage.tsx frontend/test/backups-dialog.test.tsx && git commit -m "feat(frontend): backups panel with restore to draft"`

---

### Task 11: Полировка топологии

**Files:**
- Modify: `frontend/src/features/topology/TopologyView.tsx`
- Modify: `frontend/src/entities/graph/buildGraph.ts`
- Modify: `frontend/src/features/profiles/ProfilesPage.tsx`
- Test: обновить `frontend/test/build-graph.test.ts`, `frontend/test/profiles-page.test.tsx`; создать `frontend/test/topology-resync.test.ts`

**Interfaces:**
- Produces: `resyncEdges(prev: Edge[], next: Edge[]): Edge[]` — экспорт из TopologyView.

- [ ] **Step 1: Падающие тесты.**

`frontend/test/topology-resync.test.ts`:

```ts
import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { resyncEdges } from '../src/features/topology/TopologyView'

describe('resyncEdges', () => {
  it('сохраняет выделение существующих рёбер при пересборке', () => {
    const prev: Edge[] = [
      { id: 'e:a', source: 'a', target: 'b', selected: true },
      { id: 'e:b', source: 'b', target: 'c' },
    ]
    const next: Edge[] = [
      { id: 'e:a', source: 'a', target: 'b' },
      { id: 'e:c', source: 'c', target: 'd' },
    ]
    const out = resyncEdges(prev, next)
    expect(out.find((e) => e.id === 'e:a')?.selected).toBe(true)
    expect(out.find((e) => e.id === 'e:c')?.selected).toBeUndefined()
  })
})
```

В `frontend/test/build-graph.test.ts` добавить:

```ts
it('дубликаты тегов не порождают дубликаты id узлов', () => {
  const config = {
    inbounds: [
      { tag: 'dup', protocol: 'vless' },
      { tag: 'dup', protocol: 'trojan' },
    ],
    outbounds: [
      { tag: 'out-dup', protocol: 'freedom' },
      { tag: 'out-dup', protocol: 'blackhole' },
    ],
  }
  const { nodes } = buildGraph(config)
  const ids = nodes.map((n) => n.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids.filter((id) => id === 'in:dup')).toHaveLength(1)
})
```

В `frontend/test/profiles-page.test.tsx` — в существующем тесте удаления профиля: перед подтверждением удаления выполнить `usePositionsStore.getState().setPosition(UUID, 'in:x', { x: 1, y: 2 })`, после — `expect(usePositionsStore.getState().positions[UUID]).toBeUndefined()`.

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация.**

`TopologyView.tsx`: добавить экспортируемую функцию над компонентом и использовать её в ресинке:

```ts
// Пересборка графа заменяет объекты рёбер — переносим флаг выделения по id
export function resyncEdges(prev: Edge[], next: Edge[]): Edge[] {
  const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id))
  return next.map((e) => (selected.has(e.id) ? { ...e, selected: true } : e))
}
```

Заменить `useEffect(() => setEdges(computed.edges), [computed.edges])` на:

```ts
useEffect(() => setEdges((prev) => resyncEdges(prev, computed.edges)), [computed.edges])
```

`buildGraph.ts`: в цикле inbound'ов и outbound'ов пропускать повторные теги (дубликат уже подсвечен analyzeIntegrity как warning; одинаковые id узлов ломают React Flow):

```ts
const seenInboundTags = new Set<string>()
inbounds.forEach((inb, index) => {
  if (seenInboundTags.has(inb.tag)) return
  seenInboundTags.add(inb.tag)
  // ...существующее тело без изменений
})

const seenOutboundTags = new Set<string>()
outbounds.forEach((out, index) => {
  if (seenOutboundTags.has(out.tag)) return
  seenOutboundTags.add(out.tag)
  // ...существующее тело без изменений
})
```

`ProfilesPage.tsx`: импорт `import { usePositionsStore } from '../topology/positionsStore'`; в onSuccess удаления рядом с `clearDraft`:

```ts
usePositionsStore.getState().resetPositions(toDelete.uuid)
```

- [ ] **Step 4: PASS + typecheck.**

- [ ] **Step 5: Commit**: `git add frontend/src/features/topology/TopologyView.tsx frontend/src/entities/graph/buildGraph.ts frontend/src/features/profiles/ProfilesPage.tsx frontend/test/topology-resync.test.ts frontend/test/build-graph.test.ts frontend/test/profiles-page.test.tsx && git commit -m "fix(frontend): edge selection resync, duplicate tags, orphan positions cleanup"`

---

### Task 12: Playwright e2e и документация

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/mocks.ts`, `frontend/e2e/editor.spec.ts`, `frontend/e2e/routing.spec.ts`
- Modify: `frontend/package.json` (devDep `@playwright/test`, скрипт `"e2e": "playwright test"`), `.gitignore` (добавить `frontend/test-results/`, `frontend/playwright-report/`), `README.md`

**Interfaces:**
- Consumes: селекторы React Flow (`.react-flow__node[data-id=...]`, `.react-flow__edge[data-id=...]`), вкладки инспектора («Форма», «JSON узла»), id-контракт графа.

- [ ] **Step 1: Установка**: `npm i -D @playwright/test -w frontend`, затем `npx playwright install chromium` (из корня или frontend). В `frontend/package.json` добавить скрипт `"e2e": "playwright test"`.

- [ ] **Step 2: Конфиг** `frontend/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
```

(vitest эти файлы не подхватит: его include — `test/**/*.test.{ts,tsx}`, спеки лежат в `e2e/*.spec.ts`.)

- [ ] **Step 3: Моки** `frontend/e2e/mocks.ts`:

```ts
import type { Page } from '@playwright/test'

export const UUID = '11111111-1111-4111-8111-111111111111'

export const CONFIG = {
  log: { loglevel: 'warning' },
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
  await page.route(`**/api/profiles/${UUID}/inbounds`, (r) => r.fulfill({ json: { inbounds: [] } }))
  await page.route(`**/api/profiles/${UUID}/backups`, (r) => r.fulfill({ json: { backups: [] } }))
  await page.route(`**/api/profiles/${UUID}`, (r) => r.fulfill({ json: { profile: PROFILE } }))
  await page.route('**/api/profiles', (r) => r.fulfill({ json: { profiles: [PROFILE] } }))
}
```

- [ ] **Step 4: Сценарии.**

`frontend/e2e/routing.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'

test('lazy-роутинг: список профилей → редактор', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  await expect(page.getByText('E2E Profile')).toBeVisible()
  await page.getByText('E2E Profile').click()
  await expect(page).toHaveURL(new RegExp(`/profiles/${UUID}`))
  await expect(page.locator(`.react-flow__node[data-id="in:vless-in"]`)).toBeVisible()
})
```

`frontend/e2e/editor.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
})

test('удаление ребра клавишей Backspace удаляет правило', async ({ page }) => {
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(1)
  await page.locator('.react-flow__edge[data-id="e:rule:0->out:direct"]').click()
  await page.keyboard.press('Backspace')
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(0)
})

test('Backspace на узле ничего не удаляет', async ({ page }) => {
  await page.locator('.react-flow__node[data-id="in:vless-in"]').click()
  await page.keyboard.press('Backspace')
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
})

test('переключение узлов меняет содержимое инспектора без утечки', async ({ page }) => {
  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="in:vless-in"]').click()
  await expect(inspector.getByText('in:vless-in')).toBeVisible()
  await page.locator('.react-flow__node[data-id="out:direct"]').click()
  await expect(inspector.getByText('out:direct')).toBeVisible()
  await expect(inspector.getByLabel('Тег')).toHaveValue('direct')
})

test('форма inbound: выбор flow создаёт черновик', async ({ page }) => {
  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="in:vless-in"]').click()
  await inspector.getByLabel('Flow').selectOption('xtls-rprx-vision')
  await inspector.getByRole('button', { name: 'Применить' }).click()
  await expect(page.getByText('черновик')).toBeVisible()
})
```

- [ ] **Step 5: Запуск**: `npx playwright test` из `frontend/` → все сценарии PASS. При флаках селекторов чинить селекторы/ожидания, НЕ добавлять произвольные sleep.

- [ ] **Step 6: Документация.** В `README.md` добавить раздел «Тестирование»: `npm test -w backend`, `npm test -w frontend`, `npm run e2e -w frontend` (+ `npx playwright install chromium` при первом запуске); в раздел возможностей — формы протоколов, генератор Reality-ключей, пресеты, панель бэкапов. В `.gitignore` — `frontend/test-results/` и `frontend/playwright-report/`.

- [ ] **Step 7: Commit**: `git add frontend/playwright.config.ts frontend/e2e frontend/package.json package-lock.json README.md .gitignore && git commit -m "test(frontend): playwright e2e scenarios for topology and forms"`

---

## Self-Review (выполнен)

- Покрытие: формы всех протоколов Remnawave v2.8.0 (VLESS+Reality/flow, Trojan, SS; outbound freedom/blackhole/wireguard-WARP, остальные — через JSON с подсказкой) — задачи 4–8; Reality-генератор — 1, 3, 6; пресеты — 9; бэкапы — 10; Playwright-сценарии из отложенного списка (edge-delete, node-switch, Backspace no-op, lazy-роутинг) — 12; edge-selection, осиротевшие позиции, дедупликация id, retag-hint, typeof-guard — 8 и 11.
- Типы согласованы: `Obj = Record<string, unknown>` во всех формах; `onChange(next)` всюду отдаёт целый узел/подобъект; `resyncEdges` — единственный новый экспорт TopologyView.
- Все новые CSS-классы сосредоточены в задаче 2 — параллельные задачи не конфликтуют по tokens.css.
