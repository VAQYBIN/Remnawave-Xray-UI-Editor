# План 2: Ядро фронтенда — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** React SPA: логин, список конфиг-профилей Remnawave, raw-JSON редактор с Zod-валидацией, diff-превью и обработкой конфликтов; сборка фронта в Docker-образ.

**Architecture:** Пакет `frontend/` (Vite 7 + React 19 + TypeScript) в существующем npm-workspaces монорепо. SPA ходит только в свой бэкенд (`/api/*`, cookie-сессия); в dev — vite proxy на `localhost:3000`. Единый источник правды конфига — текст черновика в Zustand-сторе (persist в localStorage), Zod-модель Xray с passthrough гарантирует «ничего не теряется». Docker получает стадию сборки фронта; бэкенд раздаёт `frontend/dist`.

**Tech Stack:** Vite 7, React 19, TypeScript 5.8, zod 3, Zustand 5, TanStack Query 5, react-router-dom 7, @uiw/react-codemirror 4 (+@codemirror/lang-json, lint, merge), @fontsource/ibm-plex-{sans,mono}, vitest 3 + jsdom + Testing Library.

**Спека:** `docs/superpowers/specs/2026-07-20-xray-ui-editor-design.md`. Это план 2 из 3 (план 1 — бэкенд, готов; план 3 — визуальный редактор топологии).

## Global Constraints

- Весь UI, подсказки и сообщения об ошибках — на русском; активный залог («Войти», «Сохранить в панель», «Создать профиль»).
- Дизайн-токены (обязательные значения, файл `frontend/src/shared/ui/tokens.css`):
  фон `#0F1317`, поверхности `#151B21` и `#1C242C`, граница `#27313B`, текст `#E9EEF3`, приглушённый `#8D99A6`, входящий-акцент `#5AC8D8`, исходящий-акцент `#E8A33D`, опасность `#E36055`, успех `#7BC97F`; радиусы 8px/6px; шрифты IBM Plex Sans (400/600) и IBM Plex Mono (400/500) только через @fontsource (никаких CDN).
- Сигнатурный элемент — компонент `Chip`: моноширинный чип с цветовой точкой направления (`in` циан / `out` янтарь / `none` без точки).
- Passthrough-инвариант: Zod-схемы Xray нигде не отбрасывают неизвестные поля (`.passthrough()` на каждом объекте); round-trip «parse → результат deep-equal входу» покрыт тестами.
- Бэкенд-контракты (план 1, не менять): `POST /api/auth/login {password}` → cookie; `GET /api/auth/me` → `{authenticated:true}` | 401 `{message:'Требуется вход'}`; `GET /api/profiles` → `{profiles: ConfigProfile[]}`; `GET /api/profiles/:uuid` → `{profile}`; `POST /api/profiles {name, config}` → 201 `{profile}`; `PATCH /api/profiles/:uuid {config?, name?, expectedUpdatedAt}` → `{profile}` | 409 `{message, current}`; `DELETE /api/profiles/:uuid` → `{ok:true}`; `GET /api/profiles/:uuid/backups` → `{backups}`; `GET /api/nodes` → `{nodes}`; `ConfigProfile = {uuid, viewPosition, name, config, inbounds:[{uuid,tag,type,network,security,port,...}], nodes:[{uuid,name,countryCode}], createdAt, updatedAt}`. Имя профиля: 2–30, `^[A-Za-z0-9_\s-]+$`.
- Все fetch — с `credentials: 'include'`; на 401 (кроме /api/auth/*) — редирект на `/login`.
- Тесты: `npm test --workspace frontend`; typecheck: `npm run typecheck --workspace frontend`. Коммит после каждой задачи.
- Node 24, ESM. Не трогать `backend/` (кроме задачи 10: Dockerfile/compose/README в корне).

## Зависимости задач (для параллельного исполнения)

- Задача 1 — база для всех.
- Задачи 2, 3, 5, 8 зависят только от задачи 1 (файлово не пересекаются — можно параллельно в worktree).
- Задача 4 — после 3 (тот же каталог entities/xray).
- Задача 6 — после 2 и 5. Задача 7 — после 6. Задача 9 — после 4, 6, 8 (и 7 — общий App-роутинг). Задача 10 — последняя.

---

### Task 1: Каркас фронтенда

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/vitest.config.ts`, `frontend/tsconfig.json`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/test/setup.ts`
- Modify: `package.json` (корень: workspaces + скрипты)
- Test: `frontend/test/app.test.tsx`

**Interfaces:**
- Produces: рабочий Vite-проект; `App` — корневой компонент (пока заглушка, задача 6 заменит содержимое); vitest с jsdom и Testing Library; dev-proxy `/api` → `http://localhost:3000`.

- [ ] **Step 1: Создать файлы каркаса**

`frontend/package.json`:

```json
{
  "name": "@xray-ui-editor/frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@codemirror/lang-json": "^6.0.1",
    "@codemirror/lint": "^6.8.5",
    "@codemirror/merge": "^6.10.0",
    "@fontsource/ibm-plex-mono": "^5.2.5",
    "@fontsource/ibm-plex-sans": "^5.2.5",
    "@tanstack/react-query": "^5.80.0",
    "@uiw/react-codemirror": "^4.23.12",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^7.6.0",
    "zod": "^3.25.0",
    "zustand": "^5.0.5"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.6.0",
    "jsdom": "^26.1.0",
    "typescript": "^5.8.0",
    "vite": "^7.0.0",
    "vitest": "^3.1.0"
  }
}
```

`frontend/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
```

`frontend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    css: false,
  },
})
```

`frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "test"]
}
```

`frontend/index.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Xray UI Editor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`frontend/src/App.tsx`:

```tsx
export function App() {
  return <main>Xray UI Editor</main>
}
```

`frontend/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

В корневом `package.json` заменить workspaces и добавить скрипты фронта:

```json
{
  "name": "xray-ui-editor",
  "private": true,
  "workspaces": ["backend", "frontend"],
  "scripts": {
    "test": "npm test --workspace backend && npm test --workspace frontend",
    "dev": "npm run dev --workspace backend",
    "dev:frontend": "npm run dev --workspace frontend",
    "build": "npm run build --workspace backend && npm run build --workspace frontend"
  }
}
```

- [ ] **Step 2: Установить зависимости**

Run: `npm install`
Expected: без ошибок, lock-файл обновлён.

- [ ] **Step 3: Написать падающий тест**

`frontend/test/app.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../src/App'

describe('App', () => {
  it('рендерится', () => {
    render(<App />)
    expect(screen.getByText('Xray UI Editor')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Прогнать тест (сначала до создания App он падал бы; после Step 1 — проходит)**

Run: `npm test --workspace frontend`
Expected: PASS (1 тест). Если создавали файлы в ином порядке — убедиться, что тест реально выполнялся.

- [ ] **Step 5: Проверить типы и сборку**

Run: `npm run typecheck --workspace frontend && npm run build --workspace frontend`
Expected: без ошибок; каталог `frontend/dist` создан.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json frontend
git commit -m "feat(frontend): vite react scaffolding with vitest"
```

---

### Task 2: Дизайн-токены и UI-кит

**Files:**
- Create: `frontend/src/shared/ui/tokens.css`, `frontend/src/shared/ui/Button.tsx`, `frontend/src/shared/ui/TextInput.tsx`, `frontend/src/shared/ui/Card.tsx`, `frontend/src/shared/ui/Chip.tsx`, `frontend/src/shared/ui/Dialog.tsx`, `frontend/src/shared/ui/EmptyState.tsx`, `frontend/src/shared/ui/index.ts`
- Modify: `frontend/src/main.tsx` (импорт шрифтов и tokens.css)
- Test: `frontend/test/ui-kit.test.tsx`

**Interfaces:**
- Produces:
  - `Button({variant?: 'primary'|'ghost'|'danger', ...props})`, `TextInput(props)` (форвардит ref), `Card({children, onClick?, className?})`, `Chip({dir: 'in'|'out'|'none', children})`, `Dialog({open, title, onClose, children})` (на нативном `<dialog>`), `EmptyState({title, hint?, action?})`.
  - CSS-классы: `.btn .btn-primary .btn-ghost .btn-danger`, `.input`, `.card`, `.chip .chip-in .chip-out`, `.dialog`, `.empty`.

- [ ] **Step 1: Написать падающие тесты**

`frontend/test/ui-kit.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button, Chip, EmptyState } from '../src/shared/ui'

describe('UI-кит', () => {
  it('Chip с направлением in получает класс chip-in и точку направления', () => {
    render(<Chip dir="in">vless-in :443</Chip>)
    const chip = screen.getByText('vless-in :443')
    expect(chip).toHaveClass('chip', 'chip-in')
    expect(chip.querySelector('.chip-dot')).not.toBeNull()
  })

  it('Chip без направления не имеет точки', () => {
    render(<Chip dir="none">freedom</Chip>)
    expect(screen.getByText('freedom').querySelector('.chip-dot')).toBeNull()
  })

  it('Button рендерит вариант danger', () => {
    render(<Button variant="danger">Удалить</Button>)
    expect(screen.getByRole('button', { name: 'Удалить' })).toHaveClass('btn', 'btn-danger')
  })

  it('EmptyState показывает заголовок и подсказку', () => {
    render(<EmptyState title="Профилей пока нет" hint="Создайте первый" />)
    expect(screen.getByText('Профилей пока нет')).toBeInTheDocument()
    expect(screen.getByText('Создайте первый')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace frontend`
Expected: FAIL — модуль `shared/ui` не найден.

- [ ] **Step 3: Реализовать токены и компоненты**

`frontend/src/shared/ui/tokens.css`:

```css
:root {
  --bg: #0f1317;
  --surface: #151b21;
  --surface-2: #1c242c;
  --border: #27313b;
  --text: #e9eef3;
  --muted: #8d99a6;
  --in: #5ac8d8;
  --out: #e8a33d;
  --danger: #e36055;
  --ok: #7bc97f;
  --font-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
  --radius: 8px;
  --radius-sm: 6px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.45;
}

h1, h2, h3 { font-weight: 600; margin: 0; }
h1 { font-size: 20px; }
h2 { font-size: 16px; }

:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--in) 60%, transparent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}

.btn {
  font: inherit;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 7px 14px;
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
  transition: border-color 120ms, background 120ms;
}
.btn:hover { border-color: var(--muted); }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-primary { background: var(--in); border-color: var(--in); color: #0b2a30; font-weight: 600; }
.btn-primary:hover { border-color: var(--in); filter: brightness(1.08); }
.btn-danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); background: transparent; }
.btn-ghost { background: transparent; }

.input {
  font: inherit;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  background: var(--bg);
  color: var(--text);
}
.input::placeholder { color: var(--muted); }

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  transition: border-color 120ms;
}
.card[data-clickable='true'] { cursor: pointer; }
.card[data-clickable='true']:hover { border-color: var(--muted); }

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text);
  white-space: nowrap;
}
.chip-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.chip-in .chip-dot { background: var(--in); }
.chip-in { color: color-mix(in srgb, var(--in) 80%, var(--text)); }
.chip-out .chip-dot { background: var(--out); }
.chip-out { color: color-mix(in srgb, var(--out) 80%, var(--text)); }

.dialog {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0;
  min-width: 360px;
  max-width: min(720px, 92vw);
}
.dialog::backdrop { background: rgb(0 0 0 / 0.55); }
.dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--border);
}
.dialog-body { padding: 16px; }

.empty {
  text-align: center;
  color: var(--muted);
  padding: 48px 16px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
}
.empty h2 { color: var(--text); margin-bottom: 6px; }

.field { display: grid; gap: 6px; margin-bottom: 14px; }
.field-label { font-size: 12px; color: var(--muted); }
.field-error { font-size: 12px; color: var(--danger); }
.row { display: flex; gap: 8px; align-items: center; }
.row-wrap { display: flex; gap: 6px; flex-wrap: wrap; }
.spacer { flex: 1; }
.mono { font-family: var(--font-mono); }
.muted { color: var(--muted); }
```

`frontend/src/shared/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
}

export function Button({ variant, className, ...rest }: Props) {
  const cls = ['btn', variant ? `btn-${variant}` : '', className ?? ''].filter(Boolean).join(' ')
  return <button type="button" {...rest} className={cls} />
}
```

`frontend/src/shared/ui/TextInput.tsx`:

```tsx
import { forwardRef, type InputHTMLAttributes } from 'react'

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...rest }, ref) {
    return <input ref={ref} {...rest} className={['input', className ?? ''].filter(Boolean).join(' ')} />
  },
)
```

`frontend/src/shared/ui/Card.tsx`:

```tsx
import type { HTMLAttributes } from 'react'

export function Card({ className, onClick, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      onClick={onClick}
      data-clickable={onClick ? 'true' : undefined}
      className={['card', className ?? ''].filter(Boolean).join(' ')}
    />
  )
}
```

`frontend/src/shared/ui/Chip.tsx`:

```tsx
import type { ReactNode } from 'react'

export function Chip({ dir, children }: { dir: 'in' | 'out' | 'none'; children: ReactNode }) {
  const cls = ['chip', dir === 'in' ? 'chip-in' : '', dir === 'out' ? 'chip-out' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <span className={cls}>
      {dir !== 'none' && <span className="chip-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}
```

`frontend/src/shared/ui/Dialog.tsx`:

```tsx
import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

export function Dialog({ open, title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-label={title}>
      <div className="dialog-header">
        <h2>{title}</h2>
        <Button variant="ghost" onClick={onClose} aria-label="Закрыть">
          ✕
        </Button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  )
}
```

`frontend/src/shared/ui/EmptyState.tsx`:

```tsx
import type { ReactNode } from 'react'

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  )
}
```

`frontend/src/shared/ui/index.ts`:

```ts
export { Button } from './Button'
export { TextInput } from './TextInput'
export { Card } from './Card'
export { Chip } from './Chip'
export { Dialog } from './Dialog'
export { EmptyState } from './EmptyState'
```

В `frontend/src/main.tsx` добавить импорты ПЕРЕД импортом App:

```tsx
import '@fontsource/ibm-plex-sans/cyrillic-400.css'
import '@fontsource/ibm-plex-sans/cyrillic-600.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/cyrillic-400.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './shared/ui/tokens.css'
```

Примечание для jsdom: нативный `<dialog>` в jsdom 26 поддерживает showModal; если тест Dialog понадобится позже — вызывать через open-проп.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src frontend/test
git commit -m "feat(frontend): design tokens and ui kit"
```

---

### Task 3: Zod-модель Xray — транспорты и inbounds

**Files:**
- Create: `frontend/src/entities/xray/stream.ts`, `frontend/src/entities/xray/inbounds.ts`
- Test: `frontend/test/xray-inbounds.test.ts`

**Interfaces:**
- Produces (используется задачей 4):
  - `StreamSettingsSchema` (zod, passthrough): `network?: 'tcp'|'ws'|'grpc'|'httpupgrade'|'xhttp'|string`, `security?: 'none'|'tls'|'reality'|string`, `realitySettings?`, `tlsSettings?`, `wsSettings?`, `grpcSettings?` и т.д. — все объекты `.passthrough()`.
  - `InboundSchema` (passthrough): `{ tag: string; port?: number|string; listen?: string; protocol: string; settings?: object; streamSettings?; sniffing? }` + дискриминированные уточнения `VlessInboundSettingsSchema`, `TrojanInboundSettingsSchema`, `ShadowsocksInboundSettingsSchema`.
  - Тип `Inbound = z.infer<typeof InboundSchema>`.

- [ ] **Step 1: Написать падающие тесты**

`frontend/test/xray-inbounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { InboundSchema } from '../src/entities/xray/inbounds'

const vlessRealityInbound = {
  tag: 'vless-in',
  port: 443,
  listen: '0.0.0.0',
  protocol: 'vless',
  settings: {
    clients: [],
    decryption: 'none',
  },
  streamSettings: {
    network: 'tcp',
    security: 'reality',
    realitySettings: {
      show: false,
      dest: 'example.com:443',
      serverNames: ['example.com'],
      privateKey: 'KEY',
      shortIds: ['0123abcd'],
      customField: 'сохранить как есть',
    },
  },
  sniffing: { enabled: true, destOverride: ['http', 'tls'] },
  unknownTopLevel: { keep: true },
}

describe('InboundSchema', () => {
  it('парсит VLESS+Reality inbound и сохраняет неизвестные поля (passthrough round-trip)', () => {
    const parsed = InboundSchema.parse(vlessRealityInbound)
    expect(parsed).toEqual(vlessRealityInbound)
  })

  it('отклоняет inbound без tag', () => {
    const { tag: _omit, ...rest } = vlessRealityInbound
    expect(InboundSchema.safeParse(rest).success).toBe(false)
  })

  it('отклоняет нечисловой и нестроковый port', () => {
    expect(InboundSchema.safeParse({ ...vlessRealityInbound, port: { a: 1 } }).success).toBe(false)
  })

  it('парсит trojan и shadowsocks inbound', () => {
    const trojan = { tag: 't-in', port: 8443, protocol: 'trojan', settings: { clients: [] } }
    const ss = {
      tag: 'ss-in',
      port: 8388,
      protocol: 'shadowsocks',
      settings: { method: 'chacha20-ietf-poly1305', password: 'p' },
    }
    expect(InboundSchema.parse(trojan)).toEqual(trojan)
    expect(InboundSchema.parse(ss)).toEqual(ss)
  })

  it('незнакомый протокол проходит как passthrough', () => {
    const dokodemo = { tag: 'dok-in', port: 1234, protocol: 'dokodemo-door', settings: { address: '1.1.1.1' } }
    expect(InboundSchema.parse(dokodemo)).toEqual(dokodemo)
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace frontend`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать схемы**

`frontend/src/entities/xray/stream.ts`:

```ts
import { z } from 'zod'

const obj = () => z.object({}).passthrough()

export const RealitySettingsSchema = z
  .object({
    show: z.boolean().optional(),
    dest: z.union([z.string(), z.number()]).optional(),
    target: z.union([z.string(), z.number()]).optional(),
    xver: z.number().optional(),
    serverNames: z.array(z.string()).optional(),
    privateKey: z.string().optional(),
    publicKey: z.string().optional(),
    shortIds: z.array(z.string()).optional(),
    fingerprint: z.string().optional(),
    spiderX: z.string().optional(),
  })
  .passthrough()

export const TlsSettingsSchema = z
  .object({
    serverName: z.string().optional(),
    alpn: z.array(z.string()).optional(),
    certificates: z.array(obj()).optional(),
    minVersion: z.string().optional(),
    fingerprint: z.string().optional(),
  })
  .passthrough()

export const StreamSettingsSchema = z
  .object({
    network: z.string().optional(),
    security: z.string().optional(),
    realitySettings: RealitySettingsSchema.optional(),
    tlsSettings: TlsSettingsSchema.optional(),
    tcpSettings: obj().optional(),
    wsSettings: z
      .object({ path: z.string().optional(), host: z.string().optional(), headers: obj().optional() })
      .passthrough()
      .optional(),
    grpcSettings: z
      .object({ serviceName: z.string().optional(), multiMode: z.boolean().optional() })
      .passthrough()
      .optional(),
    httpupgradeSettings: z
      .object({ path: z.string().optional(), host: z.string().optional() })
      .passthrough()
      .optional(),
    xhttpSettings: obj().optional(),
    sockopt: obj().optional(),
  })
  .passthrough()

export const SniffingSchema = z
  .object({
    enabled: z.boolean().optional(),
    destOverride: z.array(z.string()).optional(),
    routeOnly: z.boolean().optional(),
  })
  .passthrough()
```

`frontend/src/entities/xray/inbounds.ts`:

```ts
import { z } from 'zod'
import { SniffingSchema, StreamSettingsSchema } from './stream'

const obj = () => z.object({}).passthrough()

export const VlessClientSchema = z
  .object({ id: z.string().optional(), email: z.string().optional(), flow: z.string().optional() })
  .passthrough()

export const VlessInboundSettingsSchema = z
  .object({
    clients: z.array(VlessClientSchema).optional(),
    decryption: z.string().optional(),
    fallbacks: z.array(obj()).optional(),
  })
  .passthrough()

export const TrojanInboundSettingsSchema = z
  .object({ clients: z.array(obj()).optional(), fallbacks: z.array(obj()).optional() })
  .passthrough()

export const ShadowsocksInboundSettingsSchema = z
  .object({
    method: z.string().optional(),
    password: z.string().optional(),
    clients: z.array(obj()).optional(),
    network: z.string().optional(),
  })
  .passthrough()

export const InboundSchema = z
  .object({
    tag: z.string({ required_error: 'У inbound должен быть tag' }),
    port: z.union([z.number(), z.string()]).optional(),
    listen: z.string().optional(),
    protocol: z.string({ required_error: 'У inbound должен быть protocol' }),
    settings: obj().optional(),
    streamSettings: StreamSettingsSchema.optional(),
    sniffing: SniffingSchema.optional(),
    allocate: obj().optional(),
  })
  .passthrough()
  .superRefine((inb, ctx) => {
    const settingsSchema =
      inb.protocol === 'vless'
        ? VlessInboundSettingsSchema
        : inb.protocol === 'trojan'
          ? TrojanInboundSettingsSchema
          : inb.protocol === 'shadowsocks'
            ? ShadowsocksInboundSettingsSchema
            : null
    if (settingsSchema && inb.settings !== undefined) {
      const res = settingsSchema.safeParse(inb.settings)
      if (!res.success) {
        for (const issue of res.error.issues) {
          ctx.addIssue({ ...issue, path: ['settings', ...issue.path] })
        }
      }
    }
  })

export type Inbound = z.infer<typeof InboundSchema>
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entities frontend/test
git commit -m "feat(frontend): xray zod schemas for transports and inbounds"
```

---

### Task 4: Zod-модель Xray — outbounds, routing, полный конфиг и валидация

**Files:**
- Create: `frontend/src/entities/xray/outbounds.ts`, `frontend/src/entities/xray/routing.ts`, `frontend/src/entities/xray/config.ts`, `frontend/src/entities/xray/index.ts`
- Test: `frontend/test/xray-config.test.ts`

**Interfaces:**
- Consumes: схемы задачи 3.
- Produces (используется задачей 9 и планом 3):
  - `OutboundSchema`, `RoutingSchema`, `XrayConfigSchema` (все passthrough).
  - `interface ValidationIssue { path: string; message: string; level: 'error' | 'warning' }`
  - `validateXrayConfig(text: string): { ok: boolean; config?: unknown; issues: ValidationIssue[] }` — парсит JSON-текст; ошибки JSON и схемы → level 'error' (русские сообщения «Некорректный JSON: …», по схеме — путь + сообщение), проблемы целостности → 'warning'.
  - `analyzeIntegrity(config: XrayConfig): ValidationIssue[]` — дубликаты тегов inbound/outbound; правила routing со ссылкой на несуществующий outboundTag/inboundTag; повторяющиеся порты inbound.

- [ ] **Step 1: Написать падающие тесты**

`frontend/test/xray-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateXrayConfig, XrayConfigSchema } from '../src/entities/xray'

const fullConfig = {
  log: { loglevel: 'warning' },
  inbounds: [
    {
      tag: 'vless-in',
      port: 443,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: { network: 'tcp', security: 'reality', realitySettings: { dest: 'x.com:443' } },
    },
  ],
  outbounds: [
    { tag: 'direct', protocol: 'freedom', settings: {} },
    { tag: 'block', protocol: 'blackhole', settings: {} },
    {
      tag: 'warp-out',
      protocol: 'wireguard',
      settings: { secretKey: 'KEY', address: ['172.16.0.2/32'], peers: [{ publicKey: 'PK', endpoint: 'e:2408' }] },
    },
  ],
  routing: {
    rules: [
      { type: 'field', inboundTag: ['vless-in'], domain: ['geosite:openai'], outboundTag: 'warp-out' },
      { type: 'field', protocol: ['bittorrent'], outboundTag: 'block' },
    ],
  },
  dns: { servers: ['1.1.1.1', { address: '8.8.8.8', unknownOpt: true }] },
  policy: { levels: { '0': { handshake: 4 } } },
  unknownSection: { anything: [1, 2, 3] },
}

describe('XrayConfigSchema', () => {
  it('passthrough round-trip: parse возвращает deep-equal объект', () => {
    expect(XrayConfigSchema.parse(fullConfig)).toEqual(fullConfig)
  })
})

describe('validateXrayConfig', () => {
  it('валидный конфиг — ok без ошибок', () => {
    const res = validateXrayConfig(JSON.stringify(fullConfig))
    expect(res.ok).toBe(true)
    expect(res.issues.filter((i) => i.level === 'error')).toHaveLength(0)
    expect(res.config).toEqual(fullConfig)
  })

  it('битый JSON — ошибка на русском', () => {
    const res = validateXrayConfig('{ "inbounds": [ }')
    expect(res.ok).toBe(false)
    expect(res.issues[0]!.level).toBe('error')
    expect(res.issues[0]!.message).toMatch(/Некорректный JSON/)
  })

  it('inbound без tag — ошибка схемы с путём', () => {
    const bad = { ...fullConfig, inbounds: [{ port: 1, protocol: 'vless' }] }
    const res = validateXrayConfig(JSON.stringify(bad))
    expect(res.ok).toBe(false)
    expect(res.issues.some((i) => i.path.startsWith('inbounds.0') && i.level === 'error')).toBe(true)
  })

  it('дубликат тега и висячая ссылка правила — предупреждения', () => {
    const cfg = {
      inbounds: [
        { tag: 'a', port: 1, protocol: 'vless' },
        { tag: 'a', port: 2, protocol: 'trojan' },
      ],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{ type: 'field', outboundTag: 'missing-out' }] },
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(res.ok).toBe(true) // warnings не блокируют
    const w = res.issues.filter((i) => i.level === 'warning')
    expect(w.some((i) => i.message.includes('Дубликат тега'))).toBe(true)
    expect(w.some((i) => i.message.includes('missing-out'))).toBe(true)
  })

  it('повторяющийся порт inbound — предупреждение', () => {
    const cfg = {
      inbounds: [
        { tag: 'a', port: 443, protocol: 'vless' },
        { tag: 'b', port: 443, protocol: 'trojan' },
      ],
      outbounds: [],
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(res.issues.some((i) => i.level === 'warning' && i.message.includes('443'))).toBe(true)
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace frontend`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`frontend/src/entities/xray/outbounds.ts`:

```ts
import { z } from 'zod'
import { StreamSettingsSchema } from './stream'

const obj = () => z.object({}).passthrough()

export const OutboundSchema = z
  .object({
    tag: z.string({ required_error: 'У outbound должен быть tag' }),
    protocol: z.string({ required_error: 'У outbound должен быть protocol' }),
    settings: obj().optional(),
    streamSettings: StreamSettingsSchema.optional(),
    proxySettings: obj().optional(),
    sendThrough: z.string().optional(),
    mux: obj().optional(),
  })
  .passthrough()

export type Outbound = z.infer<typeof OutboundSchema>
```

`frontend/src/entities/xray/routing.ts`:

```ts
import { z } from 'zod'

const obj = () => z.object({}).passthrough()

export const RoutingRuleSchema = z
  .object({
    type: z.string().optional(),
    inboundTag: z.array(z.string()).optional(),
    outboundTag: z.string().optional(),
    balancerTag: z.string().optional(),
    domain: z.array(z.string()).optional(),
    ip: z.array(z.string()).optional(),
    port: z.union([z.string(), z.number()]).optional(),
    sourcePort: z.union([z.string(), z.number()]).optional(),
    network: z.string().optional(),
    protocol: z.array(z.string()).optional(),
    user: z.array(z.string()).optional(),
  })
  .passthrough()

export const RoutingSchema = z
  .object({
    domainStrategy: z.string().optional(),
    domainMatcher: z.string().optional(),
    rules: z.array(RoutingRuleSchema).optional(),
    balancers: z.array(obj()).optional(),
  })
  .passthrough()
```

`frontend/src/entities/xray/config.ts`:

```ts
import { z } from 'zod'
import { InboundSchema } from './inbounds'
import { OutboundSchema } from './outbounds'
import { RoutingSchema } from './routing'

const obj = () => z.object({}).passthrough()

export const XrayConfigSchema = z
  .object({
    log: obj().optional(),
    dns: obj().optional(),
    inbounds: z.array(InboundSchema).optional(),
    outbounds: z.array(OutboundSchema).optional(),
    routing: RoutingSchema.optional(),
    policy: obj().optional(),
    transport: obj().optional(),
    stats: obj().optional(),
    reverse: obj().optional(),
    fakedns: z.union([obj(), z.array(obj())]).optional(),
    observatory: obj().optional(),
    burstObservatory: obj().optional(),
    api: obj().optional(),
  })
  .passthrough()

export type XrayConfig = z.infer<typeof XrayConfigSchema>

export interface ValidationIssue {
  path: string
  message: string
  level: 'error' | 'warning'
}

export function analyzeIntegrity(config: XrayConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const inbounds = config.inbounds ?? []
  const outbounds = config.outbounds ?? []

  const seenTags = new Map<string, string>()
  inbounds.forEach((inb, i) => {
    const key = `inbound:${inb.tag}`
    if (seenTags.has(key)) {
      issues.push({ path: `inbounds.${i}.tag`, message: `Дубликат тега inbound «${inb.tag}»`, level: 'warning' })
    }
    seenTags.set(key, inb.tag)
  })
  outbounds.forEach((out, i) => {
    const key = `outbound:${out.tag}`
    if (seenTags.has(key)) {
      issues.push({ path: `outbounds.${i}.tag`, message: `Дубликат тега outbound «${out.tag}»`, level: 'warning' })
    }
    seenTags.set(key, out.tag)
  })

  const seenPorts = new Map<string, string>()
  inbounds.forEach((inb, i) => {
    if (inb.port === undefined) return
    const port = String(inb.port)
    const prev = seenPorts.get(port)
    if (prev) {
      issues.push({
        path: `inbounds.${i}.port`,
        message: `Порт ${port} уже занят inbound «${prev}»`,
        level: 'warning',
      })
    } else {
      seenPorts.set(port, inb.tag)
    }
  })

  const inboundTags = new Set(inbounds.map((x) => x.tag))
  const outboundTags = new Set(outbounds.map((x) => x.tag))
  const rules = config.routing?.rules ?? []
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
  })

  return issues
}

export function validateXrayConfig(text: string): {
  ok: boolean
  config?: unknown
  issues: ValidationIssue[]
} {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      issues: [
        {
          path: '',
          message: `Некорректный JSON: ${err instanceof Error ? err.message : String(err)}`,
          level: 'error',
        },
      ],
    }
  }

  const parsed = XrayConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      config: raw,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        level: 'error' as const,
      })),
    }
  }

  return { ok: true, config: raw, issues: analyzeIntegrity(parsed.data) }
}
```

Важно: `validateXrayConfig` возвращает в `config` ИСХОДНЫЙ `raw`-объект (не результат parse) — сохранение в панель всегда шлёт ровно то, что ввёл пользователь.

`frontend/src/entities/xray/index.ts`:

```ts
export * from './stream'
export * from './inbounds'
export * from './outbounds'
export * from './routing'
export * from './config'
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entities frontend/test
git commit -m "feat(frontend): full xray config schema with integrity validation"
```

---

### Task 5: API-клиент и React Query хуки

**Files:**
- Create: `frontend/src/shared/api/types.ts`, `frontend/src/shared/api/client.ts`, `frontend/src/shared/api/hooks.ts`, `frontend/src/shared/api/index.ts`
- Test: `frontend/test/api-client.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts
export interface PanelInboundView { uuid: string; tag: string; type: string; network: string | null; security: string | null; port: number | null }
export interface PanelNodeRef { uuid: string; name: string; countryCode: string }
export interface Profile { uuid: string; viewPosition: number; name: string; config: unknown; inbounds: PanelInboundView[]; nodes: PanelNodeRef[]; createdAt: string; updatedAt: string }
```

  (Тип `BackupEntry` появится в плане 3 вместе с UI бэкапов.)

  - `class ApiError extends Error { status: number; details?: unknown }`
  - `class ConflictError extends ApiError { current: Profile }` (status 409)
  - `class AuthError extends ApiError {}` (status 401)
  - `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` — credentials include, JSON, ошибки маппит в классы выше, message берёт из тела `{message}`.
  - Хуки: `useMe()`, `useLogin()`, `useLogout()`, `useProfiles()`, `useProfile(uuid)`, `useCreateProfile()`, `useDeleteProfile()`, `useSaveProfile(uuid)` (PATCH: `{config?, name?, expectedUpdatedAt}`). (`useBackups` появится в плане 3 вместе с UI бэкапов — здесь не создавать.)

- [ ] **Step 1: Написать падающие тесты**

`frontend/test/api-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, ApiError, AuthError, ConflictError } from '../src/shared/api'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('apiFetch', () => {
  it('возвращает JSON и передаёт credentials', async () => {
    const fn = mockFetch(200, { profiles: [] })
    const res = await apiFetch<{ profiles: unknown[] }>('/api/profiles')
    expect(res.profiles).toEqual([])
    expect(fn.mock.calls[0]![1]).toMatchObject({ credentials: 'include' })
  })

  it('401 → AuthError с сообщением сервера', async () => {
    mockFetch(401, { message: 'Требуется вход' })
    const err = await apiFetch('/api/profiles').catch((e) => e)
    expect(err).toBeInstanceOf(AuthError)
    expect(err.message).toBe('Требуется вход')
  })

  it('409 → ConflictError с current', async () => {
    const current = { uuid: 'u1', name: 'P', updatedAt: 'T' }
    mockFetch(409, { message: 'Профиль был изменён в панели после открытия', current })
    const err = await apiFetch('/api/profiles/u1', { method: 'PATCH' }).catch((e) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.current.uuid).toBe('u1')
  })

  it('500 → ApiError; сетевые сбои → ApiError со status 0 и русским текстом', async () => {
    mockFetch(500, { message: 'Внутренняя ошибка' })
    const err = await apiFetch('/api/profiles').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(500)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed') }))
    const err2 = await apiFetch('/api/profiles').catch((e) => e)
    expect(err2).toBeInstanceOf(ApiError)
    expect(err2.status).toBe(0)
    expect(err2.message).toBe('Сервер недоступен')
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace frontend`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`frontend/src/shared/api/types.ts` — ровно как в блоке Interfaces выше.

`frontend/src/shared/api/client.ts`:

```ts
import type { Profile } from './types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class AuthError extends ApiError {}

export class ConflictError extends ApiError {
  constructor(
    message: string,
    public current: Profile,
  ) {
    super(409, message)
    this.name = 'ConflictError'
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })
  } catch {
    throw new ApiError(0, 'Сервер недоступен')
  }

  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = undefined
  }

  if (!res.ok) {
    const message =
      (body as { message?: string } | undefined)?.message ?? `Ошибка сервера (${res.status})`
    if (res.status === 401) throw new AuthError(401, message)
    if (res.status === 409) {
      const current = (body as { current?: Profile } | undefined)?.current
      if (current) throw new ConflictError(message, current)
    }
    throw new ApiError(res.status, message, body)
  }

  return body as T
}
```

`frontend/src/shared/api/hooks.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { Profile } from './types'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<{ authenticated: boolean }>('/api/auth/me'),
    retry: false,
    staleTime: 60_000,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (password: string) =>
      apiFetch<{ ok: boolean }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => qc.clear(),
  })
}

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: () => apiFetch<{ profiles: Profile[] }>('/api/profiles').then((r) => r.profiles),
  })
}

export function useProfile(uuid: string) {
  return useQuery({
    queryKey: ['profiles', uuid],
    queryFn: () => apiFetch<{ profile: Profile }>(`/api/profiles/${uuid}`).then((r) => r.profile),
  })
}

export function useCreateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; config: unknown }) =>
      apiFetch<{ profile: Profile }>('/api/profiles', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((r) => r.profile),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  })
}

export function useDeleteProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (uuid: string) => apiFetch<{ ok: boolean }>(`/api/profiles/${uuid}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  })
}

export function useSaveProfile(uuid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { config?: unknown; name?: string; expectedUpdatedAt: string }) =>
      apiFetch<{ profile: Profile }>(`/api/profiles/${uuid}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then((r) => r.profile),
    onSuccess: (profile) => {
      qc.setQueryData(['profiles', uuid], profile)
      qc.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
}
```

`frontend/src/shared/api/index.ts`:

```ts
export * from './types'
export * from './client'
export * from './hooks'
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/api frontend/test
git commit -m "feat(frontend): api client and react-query hooks"
```

---

### Task 6: Роутинг, сессия и экран входа

**Files:**
- Create: `frontend/src/features/auth/LoginPage.tsx`, `frontend/src/features/auth/RequireAuth.tsx`
- Modify: `frontend/src/App.tsx` (роутер + провайдеры; страницы-заглушки для / и /profiles/:uuid)
- Test: `frontend/test/login.test.tsx`

**Interfaces:**
- Consumes: UI-кит (задача 2), api-хуки (задача 5).
- Produces:
  - `App`: `QueryClientProvider` + `BrowserRouter`; маршруты: `/login` → `LoginPage`; `/` и `/profiles/:uuid` — внутри `RequireAuth` (пока `<ProfilesPagePlaceholder/>` и `<EditorPagePlaceholder/>` — их заменят задачи 7 и 9; плейсхолдер — просто `<main>Загрузка…</main>`-подобные заглушки с говорящим текстом «Профили» / «Редактор»).
  - `RequireAuth({children})`: `useMe()`; пока загрузка — «Проверка сессии…»; при ошибке — `<Navigate to="/login"/>`.
  - `LoginPage`: центрированная карточка, заголовок «Xray UI Editor» (моно, с точкой-акцентом `--in`), поле «Пароль» (type=password, autoFocus), кнопка «Войти» (primary, disabled пока пусто/мутация), ошибка мутации красным под полем; успех → navigate('/').

- [ ] **Step 1: Написать падающие тесты**

`frontend/test/login.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LoginPage } from '../src/features/auth/LoginPage'

function renderLogin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('LoginPage', () => {
  it('кнопка выключена при пустом пароле', () => {
    renderLogin()
    expect(screen.getByRole('button', { name: 'Войти' })).toBeDisabled()
  })

  it('показывает русскую ошибку при неверном пароле', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'Неверный пароль' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    renderLogin()
    await userEvent.type(screen.getByLabelText('Пароль'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByText('Неверный пароль')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace frontend`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`frontend/src/features/auth/LoginPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLogin } from '../../shared/api'
import { Button, TextInput } from '../../shared/ui'

export function LoginPage() {
  const [password, setPassword] = useState('')
  const login = useLogin()
  const navigate = useNavigate()

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    login.mutate(password, { onSuccess: () => navigate('/') })
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <form onSubmit={onSubmit} className="card" style={{ width: 340 }}>
        <h1 className="mono" style={{ marginBottom: 4 }}>
          Xray UI Editor<span style={{ color: 'var(--in)' }}>_</span>
        </h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
          Редактор конфигов Remnawave
        </p>
        <div className="field">
          <label className="field-label" htmlFor="password">
            Пароль
          </label>
          <TextInput
            id="password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {login.isError && <span className="field-error">{(login.error as Error).message}</span>}
        </div>
        <Button type="submit" variant="primary" disabled={!password || login.isPending} style={{ width: '100%' }}>
          Войти
        </Button>
      </form>
    </main>
  )
}
```

`frontend/src/features/auth/RequireAuth.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useMe } from '../../shared/api'

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe()
  if (me.isPending) {
    return <main style={{ padding: 24 }} className="muted">Проверка сессии…</main>
  }
  if (me.isError) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}
```

`frontend/src/App.tsx` (полная замена):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { LoginPage } from './features/auth/LoginPage'
import { RequireAuth } from './features/auth/RequireAuth'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

function ProfilesPagePlaceholder() {
  return <main style={{ padding: 24 }}>Профили</main>
}

function EditorPagePlaceholder() {
  return <main style={{ padding: 24 }}>Редактор</main>
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <ProfilesPagePlaceholder />
              </RequireAuth>
            }
          />
          <Route
            path="/profiles/:uuid"
            element={
              <RequireAuth>
                <EditorPagePlaceholder />
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
```

Обновить `frontend/test/app.test.tsx` — App теперь требует fetch (useMe); заменить тест на проверку страницы логина:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../src/App'

afterEach(() => vi.unstubAllGlobals())

describe('App', () => {
  it('без сессии показывает экран входа', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'Требуется вход' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    window.history.pushState({}, '', '/')
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace frontend`
Expected: PASS (включая обновлённый app.test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src frontend/test
git commit -m "feat(frontend): routing, session guard and login screen"
```

---

### Task 7: Список профилей

**Files:**
- Create: `frontend/src/features/profiles/ProfilesPage.tsx`, `frontend/src/features/profiles/CreateProfileDialog.tsx`, `frontend/src/shared/lib/relativeTime.ts`
- Modify: `frontend/src/App.tsx` (заменить ProfilesPagePlaceholder на ProfilesPage)
- Test: `frontend/test/profiles-page.test.tsx`, `frontend/test/relative-time.test.ts`

**Interfaces:**
- Consumes: `useProfiles`, `useCreateProfile`, `useDeleteProfile`, `useLogout`, UI-кит, тип `Profile`.
- Produces:
  - `ProfilesPage`: шапка (заголовок «Конфиг-профили», spacer, кнопка «Создать профиль» primary, кнопка «Выйти» ghost); грид карточек (`display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px`).
  - Карточка профиля: имя (h2), ряд чипов inbound'ов (`Chip dir="in"`, текст `{tag} :{port}` — без порта просто tag; максимум 4, дальше чип `none` «+N»), строка нод (`{countryCode} {name}` через запятую, muted; если пусто — «Нет привязанных нод»), футер: «обновлён {relativeTime}» + кнопка «Удалить» (danger ghost, с confirm-диалогом «Удалить профиль «{name}»? Это действие нельзя отменить» / кнопки «Удалить» danger, «Отмена» ghost). Клик по карточке → navigate(`/profiles/{uuid}`).
  - `CreateProfileDialog({open, onClose})`: поле «Имя профиля» с live-валидацией (`/^[A-Za-z0-9_\s-]{2,30}$/`, ошибка «Имя: 2–30 символов, латиница, цифры, пробел, - и _»), создаёт с конфигом-шаблоном `{ log: { loglevel: 'warning' }, inbounds: [], outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }], routing: { rules: [] } }`, после успеха → navigate к новому профилю.
  - `relativeTime(iso: string, now?: Date): string` — «только что» (<60с), «N мин назад», «N ч назад», «N дн назад», иначе локальная дата (`toLocaleDateString('ru-RU')`).
  - EmptyState: «Профилей пока нет» / «Создайте первый профиль — он сразу появится в панели Remnawave» + кнопка создания.

- [ ] **Step 1: Написать падающие тесты**

`frontend/test/relative-time.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { relativeTime } from '../src/shared/lib/relativeTime'

const now = new Date('2026-07-20T12:00:00Z')

describe('relativeTime', () => {
  it('форматирует по-русски', () => {
    expect(relativeTime('2026-07-20T11:59:30Z', now)).toBe('только что')
    expect(relativeTime('2026-07-20T11:55:00Z', now)).toBe('5 мин назад')
    expect(relativeTime('2026-07-20T09:00:00Z', now)).toBe('3 ч назад')
    expect(relativeTime('2026-07-18T12:00:00Z', now)).toBe('2 дн назад')
    expect(relativeTime('2026-01-01T00:00:00Z', now)).toBe(new Date('2026-01-01T00:00:00Z').toLocaleDateString('ru-RU'))
  })
})
```

`frontend/test/profiles-page.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProfilesPage } from '../src/features/profiles/ProfilesPage'

const profile = {
  uuid: 'u1',
  viewPosition: 0,
  name: 'Germany',
  config: {},
  inbounds: [{ uuid: 'i1', tag: 'vless-in', type: 'vless', network: 'tcp', security: 'reality', port: 443 }],
  nodes: [{ uuid: 'n1', name: 'DE-1', countryCode: 'DE' }],
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
}

function renderPage(profiles: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ profiles }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  )
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProfilesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('ProfilesPage', () => {
  it('показывает карточку профиля с чипом inbound и нодой', async () => {
    renderPage([profile])
    expect(await screen.findByText('Germany')).toBeInTheDocument()
    expect(screen.getByText('vless-in :443')).toBeInTheDocument()
    expect(screen.getByText(/DE-1/)).toBeInTheDocument()
  })

  it('пустой список — empty state с призывом создать', async () => {
    renderPage([])
    expect(await screen.findByText('Профилей пока нет')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace frontend`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`frontend/src/shared/lib/relativeTime.ts`:

```ts
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const sec = Math.floor((now.getTime() - then.getTime()) / 1000)
  if (sec < 60) return 'только что'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} мин назад`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} дн назад`
  return then.toLocaleDateString('ru-RU')
}
```

`frontend/src/features/profiles/CreateProfileDialog.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateProfile } from '../../shared/api'
import { Button, Dialog, TextInput } from '../../shared/ui'

const NAME_RE = /^[A-Za-z0-9_\s-]{2,30}$/
const TEMPLATE = {
  log: { loglevel: 'warning' },
  inbounds: [],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
}

export function CreateProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const create = useCreateProfile()
  const navigate = useNavigate()
  const invalid = name.length > 0 && !NAME_RE.test(name)

  function submit() {
    create.mutate(
      { name, config: TEMPLATE },
      { onSuccess: (profile) => navigate(`/profiles/${profile.uuid}`) },
    )
  }

  return (
    <Dialog open={open} title="Создать профиль" onClose={onClose}>
      <div className="field">
        <label className="field-label" htmlFor="profile-name">
          Имя профиля
        </label>
        <TextInput
          id="profile-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Germany 1"
        />
        {invalid && <span className="field-error">Имя: 2–30 символов, латиница, цифры, пробел, - и _</span>}
        {create.isError && <span className="field-error">{(create.error as Error).message}</span>}
      </div>
      <div className="row">
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="primary" disabled={!NAME_RE.test(name) || create.isPending} onClick={submit}>
          Создать
        </Button>
      </div>
    </Dialog>
  )
}
```

`frontend/src/features/profiles/ProfilesPage.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDeleteProfile, useLogout, useProfiles, type Profile } from '../../shared/api'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Card, Chip, Dialog, EmptyState } from '../../shared/ui'
import { CreateProfileDialog } from './CreateProfileDialog'

const MAX_CHIPS = 4

function ProfileCard({ profile, onDelete }: { profile: Profile; onDelete: () => void }) {
  const navigate = useNavigate()
  const shown = profile.inbounds.slice(0, MAX_CHIPS)
  const hidden = profile.inbounds.length - shown.length

  return (
    <Card onClick={() => navigate(`/profiles/${profile.uuid}`)}>
      <h2 style={{ marginBottom: 10 }}>{profile.name}</h2>
      <div className="row-wrap" style={{ marginBottom: 10 }}>
        {shown.map((inb) => (
          <Chip key={inb.uuid} dir="in">
            {inb.port != null ? `${inb.tag} :${inb.port}` : inb.tag}
          </Chip>
        ))}
        {hidden > 0 && <Chip dir="none">+{hidden}</Chip>}
        {profile.inbounds.length === 0 && <span className="muted">Нет inbound'ов</span>}
      </div>
      <p className="muted" style={{ margin: '0 0 10px' }}>
        {profile.nodes.length > 0
          ? profile.nodes.map((n) => `${n.countryCode} ${n.name}`).join(', ')
          : 'Нет привязанных нод'}
      </p>
      <div className="row">
        <span className="muted">обновлён {relativeTime(profile.updatedAt)}</span>
        <span className="spacer" />
        <Button
          variant="danger"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          Удалить
        </Button>
      </div>
    </Card>
  )
}

export function ProfilesPage() {
  const profiles = useProfiles()
  const del = useDeleteProfile()
  const logout = useLogout()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [toDelete, setToDelete] = useState<Profile | null>(null)

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 20 }}>
        <h1>Конфиг-профили</h1>
        <span className="spacer" />
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          Создать профиль
        </Button>
        <Button
          variant="ghost"
          onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}
        >
          Выйти
        </Button>
      </div>

      {profiles.isPending && <p className="muted">Загрузка профилей…</p>}
      {profiles.isError && <p className="field-error">{(profiles.error as Error).message}</p>}

      {profiles.data && profiles.data.length === 0 && (
        <EmptyState
          title="Профилей пока нет"
          hint="Создайте первый профиль — он сразу появится в панели Remnawave"
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              Создать профиль
            </Button>
          }
        />
      )}

      {profiles.data && profiles.data.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {profiles.data.map((p) => (
            <ProfileCard key={p.uuid} profile={p} onDelete={() => setToDelete(p)} />
          ))}
        </div>
      )}

      <CreateProfileDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <Dialog open={toDelete !== null} title="Удалить профиль" onClose={() => setToDelete(null)}>
        <p>
          Удалить профиль «{toDelete?.name}»? Это действие нельзя отменить — профиль исчезнет из панели
          Remnawave.
        </p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setToDelete(null)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            disabled={del.isPending}
            onClick={() => {
              if (toDelete) del.mutate(toDelete.uuid, { onSuccess: () => setToDelete(null) })
            }}
          >
            Удалить
          </Button>
        </div>
      </Dialog>
    </main>
  )
}
```

В `frontend/src/App.tsx`: удалить `ProfilesPagePlaceholder`, импортировать и подставить `ProfilesPage`.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src frontend/test
git commit -m "feat(frontend): profiles list with create and delete"
```

---

### Task 8: Zustand-стор черновиков

**Files:**
- Create: `frontend/src/features/editor/draftStore.ts`
- Test: `frontend/test/draft-store.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Draft { text: string; baseUpdatedAt: string; savedAt: string }
export const useDraftStore: UseBoundStore<...> // zustand + persist('xui-drafts')
// состояние: { drafts: Record<string, Draft> }
// действия:
//   setDraft(uuid: string, text: string, baseUpdatedAt: string): void  // savedAt = new Date().toISOString()
//   clearDraft(uuid: string): void
//   getDraft(uuid: string): Draft | undefined  // селектор-хелпер (не хук)
```

- [ ] **Step 1: Написать падающие тесты**

`frontend/test/draft-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useDraftStore } from '../src/features/editor/draftStore'

beforeEach(() => {
  localStorage.clear()
  useDraftStore.setState({ drafts: {} })
})

describe('draftStore', () => {
  it('сохраняет и читает черновик', () => {
    useDraftStore.getState().setDraft('u1', '{"a":1}', '2026-07-20T10:00:00Z')
    const d = useDraftStore.getState().drafts['u1']
    expect(d?.text).toBe('{"a":1}')
    expect(d?.baseUpdatedAt).toBe('2026-07-20T10:00:00Z')
    expect(d?.savedAt).toMatch(/^\d{4}-/)
  })

  it('clearDraft удаляет черновик', () => {
    useDraftStore.getState().setDraft('u1', 'x', 't')
    useDraftStore.getState().clearDraft('u1')
    expect(useDraftStore.getState().drafts['u1']).toBeUndefined()
  })

  it('персистит в localStorage под ключом xui-drafts', () => {
    useDraftStore.getState().setDraft('u1', 'x', 't')
    const raw = localStorage.getItem('xui-drafts')
    expect(raw).toContain('"u1"')
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace frontend`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`frontend/src/features/editor/draftStore.ts`:

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Draft {
  text: string
  baseUpdatedAt: string
  savedAt: string
}

interface DraftState {
  drafts: Record<string, Draft>
  setDraft: (uuid: string, text: string, baseUpdatedAt: string) => void
  clearDraft: (uuid: string) => void
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (uuid, text, baseUpdatedAt) =>
        set((s) => ({
          drafts: {
            ...s.drafts,
            [uuid]: { text, baseUpdatedAt, savedAt: new Date().toISOString() },
          },
        })),
      clearDraft: (uuid) =>
        set((s) => {
          const { [uuid]: _removed, ...rest } = s.drafts
          return { drafts: rest }
        }),
    }),
    { name: 'xui-drafts' },
  ),
)
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/editor frontend/test
git commit -m "feat(frontend): persistent draft store"
```

---

### Task 9: Страница редактора JSON

**Files:**
- Create: `frontend/src/features/editor/EditorPage.tsx`, `frontend/src/features/editor/SaveDialog.tsx`, `frontend/src/features/editor/IssueList.tsx`
- Modify: `frontend/src/App.tsx` (EditorPagePlaceholder → EditorPage)
- Test: `frontend/test/editor-logic.test.ts`

**Interfaces:**
- Consumes: `useProfile`, `useSaveProfile`, `ConflictError`, `validateXrayConfig`, `ValidationIssue`, `useDraftStore`, UI-кит, `@uiw/react-codemirror`, `@codemirror/lang-json`, `@codemirror/merge` (MergeView), `relativeTime`.
- Produces:
  - `formatConfig(config: unknown): string` — `JSON.stringify(config, null, 2)` (экспорт из EditorPage-модуля для тестов).
  - `EditorPage` (маршрут `/profiles/:uuid`):
    - Шапка: кнопка «← Профили» (ghost, navigate('/')), имя профиля (h1), чипы: `Chip in` для каждого inbound из `profile.inbounds` (`{tag} :{port}`), справа — статус: чип `none` «черновик» если dirty; «обновлён {relativeTime(updatedAt)}».
    - CodeMirror-редактор JSON: значение = черновик из стора, если есть; иначе `formatConfig(profile.config)`. onChange → `setDraft(uuid, text, profile.updatedAt)`. Тема: `EditorView.theme` на токенах (фон `--surface`, шрифт `--font-mono` 13px, высота `calc(100vh - 190px)`), расширения: `json()`, `lintGutter()`, linter на `validateXrayConfig` (error → severity 'error', warning → 'warning'; позиции по path не вычисляем — маркер на первой строке допустим, в сообщении полный путь).
    - Панель под редактором: список issues (`IssueList issues={...}`) — каждая строка: точка цвета (`--danger`/`--out`), `path` в mono, message; если пусто — «Конфиг валиден» цветом `--ok`.
    - Кнопки: «Сохранить в панель» (primary; disabled если JSON с ошибками уровня error или не dirty), «Сбросить к версии панели» (ghost; confirm-диалог, затем clearDraft), «Выйти к списку» нет (есть ← в шапке).
    - `SaveDialog({open, onClose, original, modified, issues, busy, onConfirm})`: заголовок «Сохранить в панель», MergeView (readonly diff: original = конфиг панели formatted, modified = черновик) в контейнере `max-height: 50vh; overflow:auto`, ниже — предупреждения (если есть warnings: список + текст «Панель — финальный арбитр: можно сохранить с предупреждениями»), кнопки «Отмена» ghost / «Сохранить» primary (текст «Сохранить всё равно», если есть warnings).
    - Поток сохранения: click → открыть SaveDialog → onConfirm → `useSaveProfile.mutate({config: parsed, expectedUpdatedAt: draft.baseUpdatedAt})`; success → clearDraft, закрыть диалог; `ConflictError` → закрыть SaveDialog, открыть ConflictDialog: текст «Профиль был изменён в панели после открытия ({relativeTime(current.updatedAt)})», кнопки: «Загрузить версию панели» (заменить черновик на formatConfig(current.config) с baseUpdatedAt = current.updatedAt; фактически setDraft + invalidate) и «Перезаписать» (повторить mutate с expectedUpdatedAt = current.updatedAt).
    - MergeView интеграция: `useEffect` создаёт `new MergeView({ a: {doc: original, extensions}, b: {doc: modified, extensions}, parent: ref.current })`, destroy в cleanup; extensions: `[json(), EditorView.editable.of(false), тема]`.
- Тесты — только чистая логика (`formatConfig`, выбор источника значения редактора) — JSDOM не тянет CodeMirror-рендер; компонентные тесты редактора не пишем (закроется Playwright-смоуком в плане 3 — зафиксировано в спеке §6).

- [ ] **Step 1: Написать падающие тесты**

`frontend/test/editor-logic.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatConfig, resolveEditorText } from '../src/features/editor/EditorPage'

describe('editor logic', () => {
  it('formatConfig — JSON с отступом 2', () => {
    expect(formatConfig({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('resolveEditorText: черновик приоритетнее конфига панели', () => {
    expect(resolveEditorText({ text: 'draft', baseUpdatedAt: 't', savedAt: 's' }, { a: 1 })).toBe('draft')
    expect(resolveEditorText(undefined, { a: 1 })).toBe('{\n  "a": 1\n}')
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace frontend`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`frontend/src/features/editor/IssueList.tsx`:

```tsx
import type { ValidationIssue } from '../../entities/xray'

export function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) {
    return <p style={{ color: 'var(--ok)', margin: '8px 0' }}>Конфиг валиден</p>
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0', display: 'grid', gap: 4 }}>
      {issues.map((issue, i) => (
        <li key={i} className="row" style={{ alignItems: 'baseline' }}>
          <span
            className="chip-dot"
            style={{ background: issue.level === 'error' ? 'var(--danger)' : 'var(--out)' }}
          />
          {issue.path && <span className="mono muted">{issue.path}</span>}
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  )
}
```

`frontend/src/features/editor/SaveDialog.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { MergeView } from '@codemirror/merge'
import { json } from '@codemirror/lang-json'
import { EditorView } from '@uiw/react-codemirror'
import type { ValidationIssue } from '../../entities/xray'
import { Button, Dialog } from '../../shared/ui'
import { IssueList } from './IssueList'

const diffTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg)', fontSize: '12px' },
  '.cm-content': { fontFamily: 'var(--font-mono)' },
})

interface Props {
  open: boolean
  onClose: () => void
  original: string
  modified: string
  issues: ValidationIssue[]
  busy: boolean
  onConfirm: () => void
}

export function SaveDialog({ open, onClose, original, modified, issues, busy, onConfirm }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const warnings = issues.filter((i) => i.level === 'warning')

  useEffect(() => {
    if (!open || !ref.current) return
    const view = new MergeView({
      a: { doc: original, extensions: [json(), EditorView.editable.of(false), diffTheme] },
      b: { doc: modified, extensions: [json(), EditorView.editable.of(false), diffTheme] },
      parent: ref.current,
    })
    return () => view.destroy()
  }, [open, original, modified])

  return (
    <Dialog open={open} title="Сохранить в панель" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Слева — версия панели, справа — ваш черновик.
      </p>
      <div ref={ref} style={{ maxHeight: '50vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }} />
      {warnings.length > 0 && (
        <>
          <IssueList issues={warnings} />
          <p className="muted">Панель — финальный арбитр: можно сохранить с предупреждениями.</p>
        </>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          {warnings.length > 0 ? 'Сохранить всё равно' : 'Сохранить'}
        </Button>
      </div>
    </Dialog>
  )
}
```

`frontend/src/features/editor/EditorPage.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint'
import { useQueryClient } from '@tanstack/react-query'
import { ConflictError, useProfile, useSaveProfile, type Profile } from '../../shared/api'
import { validateXrayConfig } from '../../entities/xray'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Chip, Dialog } from '../../shared/ui'
import { useDraftStore, type Draft } from './draftStore'
import { IssueList } from './IssueList'
import { SaveDialog } from './SaveDialog'

export function formatConfig(config: unknown): string {
  return JSON.stringify(config, null, 2)
}

export function resolveEditorText(draft: Draft | undefined, panelConfig: unknown): string {
  return draft ? draft.text : formatConfig(panelConfig)
}

const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', fontSize: '13px' },
  '.cm-content': { fontFamily: 'var(--font-mono)' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', borderRight: '1px solid var(--border)' },
})

function xrayLinter() {
  return linter((view) => {
    const res = validateXrayConfig(view.state.doc.toString())
    return res.issues.map(
      (issue): Diagnostic => ({
        from: 0,
        to: 0,
        severity: issue.level === 'error' ? 'error' : 'warning',
        message: issue.path ? `${issue.path}: ${issue.message}` : issue.message,
      }),
    )
  })
}

function EditorInner({ profile }: { profile: Profile }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { drafts, setDraft, clearDraft } = useDraftStore()
  const draft = drafts[profile.uuid]
  const text = resolveEditorText(draft, profile.config)
  const panelText = useMemo(() => formatConfig(profile.config), [profile.config])
  const dirty = draft !== undefined && draft.text !== panelText

  const validation = useMemo(() => validateXrayConfig(text), [text])
  const hasErrors = validation.issues.some((i) => i.level === 'error')

  const save = useSaveProfile(profile.uuid)
  const [saveOpen, setSaveOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [conflict, setConflict] = useState<Profile | null>(null)

  function doSave(expectedUpdatedAt: string) {
    save.mutate(
      { config: validation.config, expectedUpdatedAt },
      {
        onSuccess: () => {
          clearDraft(profile.uuid)
          setSaveOpen(false)
          setConflict(null)
        },
        onError: (err) => {
          if (err instanceof ConflictError) {
            setSaveOpen(false)
            setConflict(err.current)
          }
        },
      },
    )
  }

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <Button variant="ghost" onClick={() => navigate('/')}>
          ← Профили
        </Button>
        <h1>{profile.name}</h1>
        <div className="row-wrap">
          {profile.inbounds.map((inb) => (
            <Chip key={inb.uuid} dir="in">
              {inb.port != null ? `${inb.tag} :${inb.port}` : inb.tag}
            </Chip>
          ))}
        </div>
        <span className="spacer" />
        {dirty && <Chip dir="none">черновик</Chip>}
        <span className="muted">обновлён {relativeTime(profile.updatedAt)}</span>
      </div>

      <CodeMirror
        value={text}
        height="calc(100vh - 240px)"
        theme="dark"
        extensions={[json(), lintGutter(), xrayLinter(), editorTheme]}
        onChange={(value) => setDraft(profile.uuid, value, draft?.baseUpdatedAt ?? profile.updatedAt)}
      />

      <IssueList issues={validation.issues} />

      <div className="row">
        <Button variant="primary" disabled={hasErrors || !dirty || save.isPending} onClick={() => setSaveOpen(true)}>
          Сохранить в панель
        </Button>
        <Button variant="ghost" disabled={!dirty} onClick={() => setResetOpen(true)}>
          Сбросить к версии панели
        </Button>
        {save.isError && !(save.error instanceof ConflictError) && (
          <span className="field-error">{(save.error as Error).message}</span>
        )}
      </div>

      <SaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        original={panelText}
        modified={text}
        issues={validation.issues}
        busy={save.isPending}
        onConfirm={() => doSave(draft?.baseUpdatedAt ?? profile.updatedAt)}
      />

      <Dialog open={resetOpen} title="Сбросить черновик" onClose={() => setResetOpen(false)}>
        <p>Отменить все локальные правки и вернуться к версии из панели?</p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setResetOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              clearDraft(profile.uuid)
              setResetOpen(false)
            }}
          >
            Сбросить
          </Button>
        </div>
      </Dialog>

      <Dialog open={conflict !== null} title="Конфликт версий" onClose={() => setConflict(null)}>
        <p>
          Профиль был изменён в панели после открытия
          {conflict && <> (обновлён {relativeTime(conflict.updatedAt)})</>}. Выберите, что делать:
        </p>
        <div className="row">
          <span className="spacer" />
          <Button
            variant="ghost"
            onClick={() => {
              if (!conflict) return
              clearDraft(profile.uuid)
              qc.setQueryData(['profiles', profile.uuid], conflict)
              setConflict(null)
            }}
          >
            Загрузить версию панели
          </Button>
          <Button
            variant="danger"
            disabled={save.isPending}
            onClick={() => {
              if (conflict) doSave(conflict.updatedAt)
            }}
          >
            Перезаписать
          </Button>
        </div>
      </Dialog>
    </main>
  )
}

export function EditorPage() {
  const { uuid } = useParams<{ uuid: string }>()
  const profile = useProfile(uuid!)

  if (profile.isPending) return <main style={{ padding: 24 }} className="muted">Загрузка профиля…</main>
  if (profile.isError) return <main style={{ padding: 24 }} className="field-error">{(profile.error as Error).message}</main>
  return <EditorInner profile={profile.data} />
}
```

В `frontend/src/App.tsx`: удалить `EditorPagePlaceholder`, подключить `EditorPage`.

- [ ] **Step 4: Убедиться, что тесты и сборка проходят**

Run: `npm test --workspace frontend && npm run build --workspace frontend`
Expected: PASS; сборка без ошибок (проверяет реальную компиляцию CodeMirror-интеграции).

- [ ] **Step 5: Ручной смоук (обязательный, требует Docker или запущенного бэкенда)**

Поднять бэкенд: `docker compose up -d` (с заполненным `.env`) ЛИБО `npm run dev` в одном терминале; фронт: `npm run dev:frontend`. Открыть `http://localhost:5173`: войти, открыть профиль, изменить порт, увидеть diff при сохранении. Если панели Remnawave нет — хотя бы: страница логина открывается, неверный пароль показывает русскую ошибку, после верного пароля виден список (может быть ошибка «Панель Remnawave недоступна» — это корректное поведение). Зафиксировать результат в отчёте.

- [ ] **Step 6: Commit**

```bash
git add frontend/src frontend/test
git commit -m "feat(frontend): json editor with diff preview and conflict handling"
```

---

### Task 10: Docker со сборкой фронта и README

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `README.md`

**Interfaces:**
- Produces: образ, в котором бэкенд раздаёт собранный фронт; `STATIC_DIR=/app/frontend/dist`.

- [ ] **Step 1: Обновить Dockerfile**

Полное новое содержимое `Dockerfile`:

```dockerfile
FROM node:24-alpine AS backend-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --workspace backend
COPY backend backend
RUN npm run build --workspace backend

FROM node:24-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
RUN npm ci --workspace frontend
COPY frontend frontend
RUN npm run build --workspace frontend

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --workspace backend --omit=dev
COPY --from=backend-build /app/backend/dist backend/dist
COPY --from=frontend-build /app/frontend/dist frontend/dist
WORKDIR /app/backend
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Обновить docker-compose.yml**

В `environment:` заменить `STATIC_DIR: /app/backend/public` на `STATIC_DIR: /app/frontend/dist`.

- [ ] **Step 3: Обновить README.md**

В раздел «Разработка» добавить после существующих команд:

```markdown
npm run dev:frontend   # dev-сервер фронтенда (http://localhost:5173, проксирует /api на :3000)
```

И абзац: «Для локальной разработки запустите бэкенд (`npm run dev`, нужен `.env`) и фронтенд (`npm run dev:frontend`) в двух терминалах.»

- [ ] **Step 4: Верификация**

Run: `docker compose build`
Expected: обе стадии собираются.

Смоук: `.env` с валидными тестовыми значениями → `docker compose up -d` → `curl http://localhost:3000/` (или PORT из .env) должен вернуть HTML с `<div id="root">` (а не старую заглушку); `curl http://localhost:3000/health` → `{"status":"ok"}` → `docker compose down`, удалить временный `.env` если создавался.

Run: `npm test --workspace backend && npm test --workspace frontend`
Expected: все зелёные.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml README.md
git commit -m "feat: build frontend into docker image"
```

---

## Что дальше (вне этого плана)

- **План 3 — визуальный редактор**: топология React Flow (Сквады → Inbounds → Routing → Outbounds), формы протоколов с генератором Reality-ключей, пресеты, панель бэкапов в UI, Playwright-смоук. Дизайн-язык (токены, Chip) уже заложен здесь.
