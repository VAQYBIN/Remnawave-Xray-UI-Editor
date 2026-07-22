# План 2 «Маршрутизация»: RuleForm, порядок правил, диалог «Настройки конфига»

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Полный UI правил маршрутизации: форма правила в инспекторе вместо голого JSON, перестановка правил вверх/вниз с сохранением выбора узла, глобальный диалог «Настройки конфига» для `routing.domainStrategy`/`domainMatcher` и секции `log`.

**Architecture:** Три независимых блока. (1) `entities/graph/mutations.ts` получает чистую мутацию `moveRule` — перестановка правил живёт рядом с остальными мутациями графа. (2) `features/inspector/RuleForm.tsx` — новая форма в стиле InboundForm/OutboundForm (value/onChange поверх `Record<string, unknown>`, `structuredClone`-patch), подключается в `NodeInspector` через новый kind `rule`; списки тегов inbound/outbound форма получает пропсами из конфига. (3) `features/editor/ConfigSettingsDialog.tsx` — модальный диалог с секциями «Маршрутизация» и «Лог», правки применяются в черновик сразу (диалог модален, параллельных правок конфига при открытом диалоге не бывает). Номер правила в узле графа уже есть (`RuleNode` рендерит «правило #N») — граф не трогаем.

**Tech Stack:** React 19, vitest (jsdom) + @testing-library/react + userEvent, zustand (draftStore — без изменений), CSS в `tokens.css`. Примитивы плана 1: `CheckboxField`, `MultiSelectField`, `CollapsibleSection`, `Field` с `hint`. Схемы плана 1: `RoutingRuleSchema` (с `source`), `RoutingSchema` (`domainStrategy`/`domainMatcher`), `LogSchema`.

**Спека:** `docs/superpowers/specs/2026-07-22-full-xray-ui-coverage-design.md` (секция 3 «Маршрутизация»).

## Global Constraints

- Язык UI-текстов и подсказок — русский; коммиты — английский conventional style (`feat(frontend): ...`) с трейлером `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Никаких новых npm-зависимостей и новых примитивов форм — только существующие: `Field`(+`hint`), `TextField`, `PortField`, `NumberField`, `SelectField`, `StringListField`, `TagListField`, `CheckboxField`, `MultiSelectField`, `KeyValueField`, `ListEditor`, `CollapsibleSection`. Единственное разрешённое расширение — прокинуть уже существующий `hint`-проп `Field` через `TextField`/`SelectField`/`StringListField` (Task 2, с тестом).
- CSS: акцент проекта — переменная `--in` (циан), НЕ `--accent`. Доступные токены: `--bg/--surface/--surface-2/--border/--text/--muted/--in/--out/--danger/--ok`. Новые классы дописываются в конец `frontend/src/shared/ui/tokens.css`.
- Rule-узлы адресуются позиционно (`rule:{index}`): любая операция, меняющая порядок/число правил, обязана согласовать `selectedNode` (паттерн `nextSelection`/`setSelectedNode(null)` в `EditorPage`). При перестановке правила выбор должен «переехать» вместе с правилом (Task 6).
- Формы не удаляют неизвестные поля: patch через `structuredClone(value)` + точечная мутация; `undefined` → `delete` ключа.
- boolean-поля: `false` → `undefined` (уже зашито в `CheckboxField`).
- Mount-only поля (`PortField`, `StringListField`, `KeyValueField`) читают value при монтировании; внешняя замена значения требует remount через `key`. В этом плане массовых замен значений внутри форм нет (перестановка правил меняет `selectedNode` → `NodeInspector` remount'ится по `key={selectedNode}` в `EditorPage`), поэтому доп. key-механика не нужна.
- Тесты — vitest (jsdom), файлы `frontend/test/*.test.{ts,tsx}`; запуск из каталога `frontend`: `npx vitest run test/<файл>`. Playwright e2e — вне этого плана (сводный e2e — план 4).

---

### Task 1: Мутация `moveRule`

**Files:**
- Modify: `frontend/src/entities/graph/mutations.ts`
- Test: `frontend/test/graph-mutations.test.ts` (дополнить)

**Interfaces:**
- Consumes: `XrayConfig`, локальный `clone()` из `mutations.ts`.
- Produces: `moveRule(config: XrayConfig, index: number, dir: -1 | 1): XrayConfig` — переставляет правило `index` на позицию `index + dir`; на границах списка / при отсутствии правила возвращает **тот же** объект `config` (строгое `===`, чтобы вызывающий код мог дёшево понять «ничего не изменилось»). Task 6 строит на этом кнопки вверх/вниз.

- [ ] **Step 1: Написать падающий тест**

Дополнить `frontend/test/graph-mutations.test.ts`: расширить импорт из `../src/entities/graph/mutations` именем `moveRule` и добавить в конец файла:

```ts
describe('moveRule', () => {
  const rulesCfg = () => ({
    routing: {
      rules: [
        { type: 'field', outboundTag: 'a' },
        { type: 'field', outboundTag: 'b' },
        { type: 'field', outboundTag: 'c' },
      ],
    },
  })

  it('переставляет правило вниз и вверх', () => {
    const down = moveRule(rulesCfg(), 0, 1)
    expect(down.routing!.rules!.map((r) => r.outboundTag)).toEqual(['b', 'a', 'c'])
    const up = moveRule(rulesCfg(), 2, -1)
    expect(up.routing!.rules!.map((r) => r.outboundTag)).toEqual(['a', 'c', 'b'])
  })

  it('на границах возвращает исходный config (тот же объект)', () => {
    const cfg = rulesCfg()
    expect(moveRule(cfg, 0, -1)).toBe(cfg)
    expect(moveRule(cfg, 2, 1)).toBe(cfg)
  })

  it('без routing/rules и с несуществующим индексом возвращает исходный config', () => {
    const empty = {}
    expect(moveRule(empty, 0, 1)).toBe(empty)
    const cfg = rulesCfg()
    expect(moveRule(cfg, 5, -1)).toBe(cfg)
  })

  it('не мутирует входной конфиг', () => {
    const cfg = rulesCfg()
    const snapshot = structuredClone(cfg)
    moveRule(cfg, 0, 1)
    expect(cfg).toEqual(snapshot)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/graph-mutations.test.ts`
Ожидание: FAIL — `moveRule` не экспортируется из `mutations.ts` (ошибка импорта).

- [ ] **Step 3: Реализация**

В `frontend/src/entities/graph/mutations.ts` добавить после `addRule`:

```ts
// Переставляет правило index на index+dir (-1 — выше/раньше, +1 — ниже/позже).
// Правила срабатывают сверху вниз, поэтому порядок значим.
// На границах списка и при отсутствии правила возвращает ТОТ ЖЕ объект config —
// вызывающий код проверяет `=== config`, чтобы не делать пустых правок черновика.
export function moveRule(config: XrayConfig, index: number, dir: -1 | 1): XrayConfig {
  const rules = config.routing?.rules
  const target = index + dir
  if (!rules || index < 0 || index >= rules.length || target < 0 || target >= rules.length) {
    return config
  }
  const next = clone(config)
  const list = next.routing!.rules!
  const [moved] = list.splice(index, 1)
  list.splice(target, 0, moved!)
  return next
}
```

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/graph-mutations.test.ts` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/graph/mutations.ts frontend/test/graph-mutations.test.ts
git commit -m "feat(frontend): moveRule mutation for routing rules" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `hint` у `TextField`, `SelectField`, `StringListField`

**Files:**
- Modify: `frontend/src/features/inspector/fields.tsx`
- Test: `frontend/test/inspector-fields.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `Field` уже принимает `hint?: string` (план 1) — но `TextField`/`SelectField`/`StringListField` его не пробрасывают.
- Produces: те же три компонента с опциональным пропом `hint?: string`, отображаемым под контролом. Нужен для шпаргалок RuleForm (Task 3–4) и подсказок диалога настроек (Task 7–8). Новых примитивов нет.

- [ ] **Step 1: Написать падающий тест**

В `frontend/test/inspector-fields.test.tsx` расширить импорт из `../src/features/inspector/fields` именем `SelectField` и добавить в конец файла:

```tsx
describe('hint у полей на базе Field', () => {
  it('TextField, SelectField и StringListField показывают подсказку', () => {
    render(
      <>
        <TextField label="A" hint="подсказка-текст" value={undefined} onChange={() => {}} />
        <SelectField label="B" hint="подсказка-селект" value="" options={[{ value: '', label: '—' }]} onChange={() => {}} />
        <StringListField label="C" hint="подсказка-список" value={undefined} onChange={() => {}} />
      </>,
    )
    expect(screen.getByText('подсказка-текст')).toBeInTheDocument()
    expect(screen.getByText('подсказка-селект')).toBeInTheDocument()
    expect(screen.getByText('подсказка-список')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/inspector-fields.test.tsx`
Ожидание: FAIL — ошибки типов TS (`hint` нет в пропсах) и/или `getByText` не находит подсказки.

- [ ] **Step 3: Реализация**

В `frontend/src/features/inspector/fields.tsx`:

Заменить `TextField` на:

```tsx
export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string
  hint?: string
  value: string | undefined
  onChange: (v: string | undefined) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <Field label={label} hint={hint} mono={mono}>
      <TextInput
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      />
    </Field>
  )
}
```

Заменить `SelectField` на:

```tsx
export function SelectField({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  options: Option[]
  onChange: (v: string) => void
}) {
  return (
    <Field label={label} hint={hint}>
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
```

В `StringListField` добавить проп `hint?: string` (после `label` в сигнатуре и типе) и заменить `<Field label={label} mono>` на `<Field label={label} hint={hint} mono>`. Остальное тело без изменений.

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/inspector-fields.test.tsx test/inbound-form.test.tsx test/outbound-form.test.tsx test/stream-form.test.tsx` — PASS (проп опционален, существующие формы не задеты).

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/fields.tsx frontend/test/inspector-fields.test.tsx
git commit -m "feat(frontend): hint support for text, select and string list fields" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: RuleForm — базовые поля (outboundTag, inboundTag, network, protocol, user, source)

**Files:**
- Create: `frontend/src/features/inspector/RuleForm.tsx`
- Test: `frontend/test/rule-form.test.tsx` (создать)

**Interfaces:**
- Consumes: `MultiSelectField`, `SelectField`, `StringListField`, `Option` из `fields.tsx`; `CollapsibleSection` из `shared/ui`.
- Produces: `RuleForm({ value: Record<string, unknown>, onChange: (next) => void, inboundTags: string[], outboundTags: string[] })` — форма правила целиком, patch-паттерн как в InboundForm/OutboundForm. Битые ссылки на несуществующие теги остаются видимыми опциями (их можно снять, но они не пропадают молча). Task 5 подключает форму к инспектору.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/rule-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RuleForm } from '../src/features/inspector/RuleForm'

const TAGS = { inboundTags: ['vless-in', 'ss-in'], outboundTags: ['direct', 'warp'] }

// Эхо-обёртка как в реальном приложении: onChange возвращается в value через useState
function StatefulRuleForm({ initial }: { initial: Record<string, unknown> }) {
  const [value, setValue] = useState(initial)
  return <RuleForm value={value} onChange={setValue} {...TAGS} />
}

describe('RuleForm — базовые поля', () => {
  it('outboundTag выбирается из существующих outbound, посторонние поля сохраняются', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field', custom: 1 }} onChange={onChange} {...TAGS} />)
    await userEvent.selectOptions(screen.getByLabelText('Outbound (куда отправить)'), 'warp')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field', custom: 1, outboundTag: 'warp' })
  })

  it('сброс outboundTag в «— не задан —» удаляет ключ', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field', outboundTag: 'direct' }} onChange={onChange} {...TAGS} />)
    await userEvent.selectOptions(screen.getByLabelText('Outbound (куда отправить)'), '')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field' })
  })

  it('битая ссылка outboundTag видна как выбранная опция', () => {
    render(<RuleForm value={{ type: 'field', outboundTag: 'ghost' }} onChange={vi.fn()} {...TAGS} />)
    expect(screen.getByLabelText('Outbound (куда отправить)')).toHaveValue('ghost')
  })

  it('inboundTag — чипы: клик добавляет, снятие последнего удаляет ключ', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<RuleForm value={{ type: 'field' }} onChange={onChange} {...TAGS} />)
    await userEvent.click(screen.getByRole('button', { name: 'ss-in' }))
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field', inboundTag: ['ss-in'] })
    rerender(<RuleForm value={{ type: 'field', inboundTag: ['ss-in'] }} onChange={onChange} {...TAGS} />)
    await userEvent.click(screen.getByRole('button', { name: 'ss-in' }))
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field' })
  })

  it('битый inboundTag из правила присутствует чипом и снимается', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field', inboundTag: ['ghost-in'] }} onChange={onChange} {...TAGS} />)
    await userEvent.click(screen.getByRole('button', { name: 'ghost-in' }))
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field' })
  })

  it('network выбирается, protocol переключается чипами', async () => {
    render(<StatefulRuleForm initial={{ type: 'field' }} />)
    await userEvent.selectOptions(screen.getByLabelText('Сеть (network)'), 'tcp,udp')
    await userEvent.click(screen.getByRole('button', { name: 'bittorrent' }))
    expect(screen.getByLabelText('Сеть (network)')).toHaveValue('tcp,udp')
    expect(screen.getByRole('button', { name: 'bittorrent' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('user и source — в «Продвинутых», по умолчанию скрыты', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field' }} onChange={onChange} {...TAGS} />)
    expect(screen.queryByLabelText('IP источника (source)')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые/ }))
    await userEvent.type(screen.getByLabelText('IP источника (source)'), '10.0.0.1')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field', source: ['10.0.0.1'] })
  })

  it('подсказки про порядок правил и sniffing на месте', () => {
    render(<RuleForm value={{ type: 'field' }} onChange={vi.fn()} {...TAGS} />)
    expect(screen.getByText(/сверху вниз/)).toBeInTheDocument()
    expect(screen.getByText(/включённом sniffing/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/rule-form.test.tsx`
Ожидание: FAIL — модуль `RuleForm.tsx` не существует.

- [ ] **Step 3: Реализация**

Создать `frontend/src/features/inspector/RuleForm.tsx`:

```tsx
import { CollapsibleSection } from '../../shared/ui'
import { MultiSelectField, SelectField, StringListField, type Option } from './fields'

type Obj = Record<string, unknown>

const NETWORKS: Option[] = [
  { value: '', label: 'любая' },
  { value: 'tcp', label: 'tcp' },
  { value: 'udp', label: 'udp' },
  { value: 'tcp,udp', label: 'tcp,udp' },
]

// Протоколы, которые определяет sniffing на inbound
const SNIFF_PROTOCOLS: Option[] = ['http', 'tls', 'quic', 'bittorrent'].map((v) => ({ value: v, label: v }))

interface Props {
  value: Obj // правило целиком
  onChange: (next: Obj) => void
  inboundTags: string[]
  outboundTags: string[]
}

// Опции тегов: теги конфига + значения из самого правила — битая ссылка должна
// быть видима и снимаема из формы, а не пропадать молча
function tagOptions(configTags: string[], selected: string[]): Option[] {
  const all = [...configTags]
  for (const t of selected) if (!all.includes(t)) all.push(t)
  return all.map((v) => ({ value: v, label: v }))
}

export function RuleForm({ value, onChange, inboundTags, outboundTags }: Props) {
  const selectedInbounds = (value.inboundTag as string[] | undefined) ?? []
  const outboundTag = (value.outboundTag as string) ?? ''

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        Правила проверяются сверху вниз — срабатывает первое совпавшее.
      </p>
      <SelectField
        label="Outbound (куда отправить)"
        value={outboundTag}
        options={[
          { value: '', label: '— не задан —' },
          ...tagOptions(outboundTags, outboundTag === '' ? [] : [outboundTag]),
        ]}
        onChange={(v) => patch((n) => { if (v === '') delete n.outboundTag; else n.outboundTag = v })}
      />
      <MultiSelectField
        label="Inbound (откуда трафик)"
        hint="Пусто — правило действует на трафик всех inbound"
        options={tagOptions(inboundTags, selectedInbounds)}
        value={value.inboundTag as string[] | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.inboundTag; else n.inboundTag = v })}
      />
      <SelectField
        label="Сеть (network)"
        value={(value.network as string) ?? ''}
        options={NETWORKS}
        onChange={(v) => patch((n) => { if (v === '') delete n.network; else n.network = v })}
      />
      <MultiSelectField
        label="Протокол трафика"
        hint="Работает только при включённом sniffing на inbound"
        options={SNIFF_PROTOCOLS}
        value={value.protocol as string[] | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.protocol; else n.protocol = v })}
      />
      <CollapsibleSection title="Продвинутые">
        <StringListField
          label="Пользователи (user)"
          hint="Email пользователей уровня Xray — панель Remnawave генерирует их сама"
          placeholder="user@example.com"
          value={value.user as string[] | undefined}
          onChange={(v) => patch((n) => { if (v === undefined) delete n.user; else n.user = v })}
        />
        <StringListField
          label="IP источника (source)"
          hint="IP или CIDR клиента"
          placeholder={'192.168.0.0/24\n10.0.0.1'}
          value={value.source as string[] | undefined}
          onChange={(v) => patch((n) => { if (v === undefined) delete n.source; else n.source = v })}
        />
      </CollapsibleSection>
    </>
  )
}
```

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/rule-form.test.tsx` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/RuleForm.tsx frontend/test/rule-form.test.tsx
git commit -m "feat(frontend): rule form with tag, network and protocol fields" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: RuleForm — домены/IP со шпаргалкой префиксов, порты с валидацией

**Files:**
- Modify: `frontend/src/features/inspector/RuleForm.tsx`
- Modify: `frontend/src/shared/ui/tokens.css` (дописать в конец)
- Test: `frontend/test/rule-form.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `PortField`, `StringListField` (с `hint` из Task 2).
- Produces: экспортируемые из `RuleForm.tsx` хелперы `DOMAIN_PREFIXES: string[]`, `keywordEntries(items: string[] | undefined): string[]`, `portSpecError(value: string | number | undefined): string | null`; поля `domain`, `ip`, `port` в основной части формы, `sourcePort` — в «Продвинутых». `portSpecError` переиспользуется планом 4 в `analyzeIntegrity` (импорт оттуда или перенос в entities — решение плана 4). CSS-класс `.field-warning` (цвет `--out`).

- [ ] **Step 1: Написать падающий тест**

Дополнить `frontend/test/rule-form.test.tsx`: расширить импорт из `../src/features/inspector/RuleForm` именами `keywordEntries`, `portSpecError` и добавить в конец файла:

```tsx
describe('portSpecError', () => {
  it('валидные форматы: одиночный порт, диапазон, список', () => {
    expect(portSpecError(undefined)).toBeNull()
    expect(portSpecError(443)).toBeNull()
    expect(portSpecError('1000-2000')).toBeNull()
    expect(portSpecError('443,1000-2000,8443')).toBeNull()
  })

  it('невалидные форматы дают русское сообщение', () => {
    expect(portSpecError('70000')).toMatch(/вне диапазона/)
    expect(portSpecError('2000-1000')).toMatch(/больше конца/)
    expect(portSpecError('abc')).toMatch(/Некорректный формат/)
    expect(portSpecError('443,,80')).toMatch(/Пустой элемент/)
  })
})

describe('keywordEntries', () => {
  it('отделяет строки без известного префикса', () => {
    expect(keywordEntries(['geosite:openai', 'domain:a.com', 'example', 'full:b.com'])).toEqual(['example'])
    expect(keywordEntries(undefined)).toEqual([])
  })
})

describe('RuleForm — домены, IP, порты', () => {
  it('редактирование доменов даёт массив; шпаргалка префиксов видна', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field' }} onChange={onChange} {...TAGS} />)
    expect(screen.getByText(/geosite: \(категория\)/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Домены'), 'geosite:openai\ndomain:a.com')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field', domain: ['geosite:openai', 'domain:a.com'] })
  })

  it('домен без префикса подсвечивается предупреждением о keyword-матчинге', () => {
    render(<RuleForm value={{ type: 'field', domain: ['geosite:openai', 'example'] }} onChange={vi.fn()} {...TAGS} />)
    expect(screen.getByText(/keyword-матчинг по подстроке: example/)).toBeInTheDocument()
  })

  it('редактирование IP даёт массив', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field' }} onChange={onChange} {...TAGS} />)
    await userEvent.type(screen.getByLabelText('IP назначения'), 'geoip:private')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field', ip: ['geoip:private'] })
  })

  it('битый порт показывает ошибку, валидный — нет', () => {
    const { rerender } = render(<RuleForm value={{ type: 'field', port: '2000-1000' }} onChange={vi.fn()} {...TAGS} />)
    expect(screen.getByText(/больше конца/)).toBeInTheDocument()
    rerender(<RuleForm value={{ type: 'field', port: '1000-2000' }} onChange={vi.fn()} {...TAGS} />)
    expect(screen.queryByText(/больше конца/)).not.toBeInTheDocument()
  })

  it('ввод порта уходит числом, диапазон — строкой', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field' }} onChange={onChange} {...TAGS} />)
    const port = screen.getByLabelText('Порт назначения')
    await userEvent.type(port, '443')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field', port: 443 })
    await userEvent.type(port, '-500')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field', port: '443-500' })
  })

  it('sourcePort — в «Продвинутых»', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field' }} onChange={onChange} {...TAGS} />)
    expect(screen.queryByLabelText('Порт источника (sourcePort)')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые/ }))
    await userEvent.type(screen.getByLabelText('Порт источника (sourcePort)'), '53')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field', sourcePort: 53 })
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/rule-form.test.tsx`
Ожидание: FAIL — `keywordEntries`/`portSpecError` не экспортируются (ошибка импорта).

- [ ] **Step 3: Реализация**

Заменить содержимое `frontend/src/features/inspector/RuleForm.tsx` на:

```tsx
import { CollapsibleSection } from '../../shared/ui'
import { MultiSelectField, PortField, SelectField, StringListField, type Option } from './fields'

type Obj = Record<string, unknown>

const NETWORKS: Option[] = [
  { value: '', label: 'любая' },
  { value: 'tcp', label: 'tcp' },
  { value: 'udp', label: 'udp' },
  { value: 'tcp,udp', label: 'tcp,udp' },
]

// Протоколы, которые определяет sniffing на inbound
const SNIFF_PROTOCOLS: Option[] = ['http', 'tls', 'quic', 'bittorrent'].map((v) => ({ value: v, label: v }))

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

interface Props {
  value: Obj // правило целиком
  onChange: (next: Obj) => void
  inboundTags: string[]
  outboundTags: string[]
}

// Опции тегов: теги конфига + значения из самого правила — битая ссылка должна
// быть видима и снимаема из формы, а не пропадать молча
function tagOptions(configTags: string[], selected: string[]): Option[] {
  const all = [...configTags]
  for (const t of selected) if (!all.includes(t)) all.push(t)
  return all.map((v) => ({ value: v, label: v }))
}

export function RuleForm({ value, onChange, inboundTags, outboundTags }: Props) {
  const selectedInbounds = (value.inboundTag as string[] | undefined) ?? []
  const outboundTag = (value.outboundTag as string) ?? ''
  const domainKeywords = keywordEntries(value.domain as string[] | undefined)
  const portError = portSpecError(value.port as string | number | undefined)
  const sourcePortError = portSpecError(value.sourcePort as string | number | undefined)

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        Правила проверяются сверху вниз — срабатывает первое совпавшее.
      </p>
      <SelectField
        label="Outbound (куда отправить)"
        value={outboundTag}
        options={[
          { value: '', label: '— не задан —' },
          ...tagOptions(outboundTags, outboundTag === '' ? [] : [outboundTag]),
        ]}
        onChange={(v) => patch((n) => { if (v === '') delete n.outboundTag; else n.outboundTag = v })}
      />
      <MultiSelectField
        label="Inbound (откуда трафик)"
        hint="Пусто — правило действует на трафик всех inbound"
        options={tagOptions(inboundTags, selectedInbounds)}
        value={value.inboundTag as string[] | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.inboundTag; else n.inboundTag = v })}
      />
      <StringListField
        label="Домены"
        hint="Префиксы: geosite: (категория), domain: (домен и поддомены), full: (точное совпадение), regexp: (рег. выражение)"
        placeholder={'geosite:category-ads-all\ndomain:example.com'}
        value={value.domain as string[] | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.domain; else n.domain = v })}
      />
      {domainKeywords.length > 0 && (
        <span className="field-warning">
          Без префикса — keyword-матчинг по подстроке: {domainKeywords.join(', ')}
        </span>
      )}
      <StringListField
        label="IP назначения"
        hint="IP, CIDR (10.0.0.0/8) или geoip:ru, geoip:private"
        placeholder={'geoip:private\n10.0.0.0/8'}
        value={value.ip as string[] | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.ip; else n.ip = v })}
      />
      <PortField
        label="Порт назначения"
        value={value.port as number | string | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.port; else n.port = v })}
      />
      {portError && <span className="field-error">{portError}</span>}
      <SelectField
        label="Сеть (network)"
        value={(value.network as string) ?? ''}
        options={NETWORKS}
        onChange={(v) => patch((n) => { if (v === '') delete n.network; else n.network = v })}
      />
      <MultiSelectField
        label="Протокол трафика"
        hint="Работает только при включённом sniffing на inbound"
        options={SNIFF_PROTOCOLS}
        value={value.protocol as string[] | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.protocol; else n.protocol = v })}
      />
      <CollapsibleSection title="Продвинутые">
        <PortField
          label="Порт источника (sourcePort)"
          value={value.sourcePort as number | string | undefined}
          onChange={(v) => patch((n) => { if (v === undefined) delete n.sourcePort; else n.sourcePort = v })}
        />
        {sourcePortError && <span className="field-error">{sourcePortError}</span>}
        <StringListField
          label="Пользователи (user)"
          hint="Email пользователей уровня Xray — панель Remnawave генерирует их сама"
          placeholder="user@example.com"
          value={value.user as string[] | undefined}
          onChange={(v) => patch((n) => { if (v === undefined) delete n.user; else n.user = v })}
        />
        <StringListField
          label="IP источника (source)"
          hint="IP или CIDR клиента"
          placeholder={'192.168.0.0/24\n10.0.0.1'}
          value={value.source as string[] | undefined}
          onChange={(v) => patch((n) => { if (v === undefined) delete n.source; else n.source = v })}
        />
      </CollapsibleSection>
    </>
  )
}
```

В конец `frontend/src/shared/ui/tokens.css` дописать:

```css
.field-warning { font-size: 12px; color: var(--out); }
```

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/rule-form.test.tsx` — PASS (в том числе тесты Task 3 — порядок полей изменился, но лейблы и поведение прежние).

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/inspector/RuleForm.tsx frontend/src/shared/ui/tokens.css frontend/test/rule-form.test.tsx
git commit -m "feat(frontend): rule form domain, ip and port fields with hints" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Подключение RuleForm к NodeInspector (kind `rule`)

**Files:**
- Modify: `frontend/src/features/topology/NodeInspector.tsx`
- Test: `frontend/test/node-inspector.test.tsx` (изменить + дополнить)

**Interfaces:**
- Consumes: `RuleForm` из Task 3–4; `config.inbounds`/`config.outbounds` для списков тегов.
- Produces: `NodeInspector` различает kind `'inbound' | 'outbound' | 'rule' | 'other'`; для `rule:`-узлов появляются вкладки «Форма | JSON узла» с формой по умолчанию. Публичные пропсы не меняются.

- [ ] **Step 1: Написать падающий тест**

В `frontend/test/node-inspector.test.tsx`:

1. Заменить тест `'для rule:/dns узлов вкладок нет — сразу JSON'` на:

```tsx
  it('для dns узла вкладок нет — сразу JSON', () => {
    const dnsConfig = { ...config, dns: { servers: ['8.8.8.8'] } }
    wrap(
      <NodeInspector config={dnsConfig} nodeId="dns" onApply={() => {}} onRemove={() => {}} onClose={() => {}} />,
    )
    expect(screen.queryByText('Форма')).not.toBeInTheDocument()
    expect(screen.queryByText('JSON узла')).not.toBeInTheDocument()
    expect(document.querySelector('.cm-content')).toBeInTheDocument()
  })
```

2. Добавить после определения `config` общий фикстур-конфиг и новые тесты:

```tsx
const ruleConfig = {
  inbounds: [{ tag: 'vless-in', port: 443, protocol: 'vless' }],
  outbounds: [
    { tag: 'direct', protocol: 'freedom' },
    { tag: 'warp', protocol: 'wireguard' },
  ],
  routing: { rules: [{ type: 'field', inboundTag: ['vless-in'], outboundTag: 'direct' }] },
}
```

```tsx
describe('NodeInspector — rule-узлы', () => {
  it('для rule: узла по умолчанию открыта вкладка «Форма» с RuleForm', () => {
    wrap(
      <NodeInspector config={ruleConfig} nodeId="rule:0" onApply={() => {}} onRemove={() => {}} onClose={() => {}} />,
    )
    expect(screen.getByText('Форма')).toBeInTheDocument()
    expect(screen.getByLabelText('Outbound (куда отправить)')).toHaveValue('direct')
    expect(screen.getByRole('button', { name: 'vless-in' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('правка правила формой применяется через «Применить»', async () => {
    const onApply = vi.fn()
    wrap(
      <NodeInspector config={ruleConfig} nodeId="rule:0" onApply={onApply} onRemove={() => {}} onClose={() => {}} />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Outbound (куда отправить)'), 'warp')
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(onApply).toHaveBeenCalledWith({ type: 'field', inboundTag: ['vless-in'], outboundTag: 'warp' })
  })

  it('вкладка «JSON узла» доступна для правила', async () => {
    wrap(
      <NodeInspector config={ruleConfig} nodeId="rule:0" onApply={() => {}} onRemove={() => {}} onClose={() => {}} />,
    )
    await userEvent.click(screen.getByText('JSON узла'))
    expect(document.querySelector('.cm-content')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/node-inspector.test.tsx`
Ожидание: FAIL — для `rule:0` вкладок нет (kind `other`), `getByLabelText('Outbound (куда отправить)')` не находит элемент.

- [ ] **Step 3: Реализация**

В `frontend/src/features/topology/NodeInspector.tsx`:

Добавить импорт после `OutboundForm`:

```tsx
import { RuleForm } from '../inspector/RuleForm'
```

Заменить строку вычисления `kind`:

```tsx
  const kind = nodeId.startsWith('in:')
    ? 'inbound'
    : nodeId.startsWith('out:')
      ? 'outbound'
      : nodeId.startsWith('rule:')
        ? 'rule'
        : 'other'
```

В блок формы (после рендера `OutboundForm`) добавить:

```tsx
          {parsedNode !== null && kind === 'rule' && (
            <RuleForm
              value={parsedNode}
              onChange={(next) => setText(JSON.stringify(next, null, 2))}
              inboundTags={(config.inbounds ?? []).map((i) => i.tag)}
              outboundTags={(config.outbounds ?? []).map((o) => o.tag)}
            />
          )}
```

Больше ничего менять не нужно: вкладки и JSON-редактор уже управляются условиями `kind !== 'other'` / `kind === 'other'`, а логика retag срабатывает только для `kind === 'inbound'`.

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/node-inspector.test.tsx test/rule-form.test.tsx` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/topology/NodeInspector.tsx frontend/test/node-inspector.test.tsx
git commit -m "feat(frontend): wire rule form into node inspector" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Порядок правил — кнопки вверх/вниз, выбор следует за правилом

**Files:**
- Modify: `frontend/src/features/topology/NodeInspector.tsx`
- Modify: `frontend/src/features/editor/EditorPage.tsx`
- Test: `frontend/test/node-inspector.test.tsx` (дополнить)
- Test: `frontend/test/editor-logic.test.ts` (дополнить)

**Interfaces:**
- Consumes: `moveRule` из Task 1; `key={selectedNode}` на `NodeInspector` в `EditorPage` (перестановка меняет `selectedNode` → инспектор remount'ится с новым правилом — mount-only поля не рассинхронизируются).
- Produces: `NodeInspector` получает опциональный проп `onMoveRule?: (dir: -1 | 1) => void`; для rule-узлов рендерится строка «порядок: N из M» с кнопками ↑/↓ (disabled на границах и при неприменённых правках — иначе правки потерялись бы молча при remount). `EditorPage` экспортирует чистый хелпер `moveSelectedRule(config, selected, dir): { config; selected } | null` и передаёт `onMoveRule` в инспектор. Номер правила в узле графа уже есть (`RuleNode`: «правило #N») — не трогаем.

- [ ] **Step 1: Написать падающие тесты**

1. В `frontend/test/node-inspector.test.tsx` добавить в `describe('NodeInspector — rule-узлы', ...)`:

```tsx
  const twoRulesConfig = {
    ...ruleConfig,
    routing: {
      rules: [
        { type: 'field', inboundTag: ['vless-in'], outboundTag: 'direct' },
        { type: 'field', outboundTag: 'warp' },
      ],
    },
  }

  it('кнопки порядка: у первого правила «выше» недоступна, «ниже» вызывает onMoveRule(1)', async () => {
    const onMoveRule = vi.fn()
    wrap(
      <NodeInspector
        config={twoRulesConfig}
        nodeId="rule:0"
        onMoveRule={onMoveRule}
        onApply={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('порядок: 1 из 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Переместить правило выше' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Переместить правило ниже' }))
    expect(onMoveRule).toHaveBeenCalledWith(1)
  })

  it('у последнего правила «ниже» недоступна, «выше» вызывает onMoveRule(-1)', async () => {
    const onMoveRule = vi.fn()
    wrap(
      <NodeInspector
        config={twoRulesConfig}
        nodeId="rule:1"
        onMoveRule={onMoveRule}
        onApply={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Переместить правило ниже' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Переместить правило выше' }))
    expect(onMoveRule).toHaveBeenCalledWith(-1)
  })

  it('кнопки порядка блокируются при неприменённых правках', async () => {
    wrap(
      <NodeInspector
        config={twoRulesConfig}
        nodeId="rule:0"
        onMoveRule={vi.fn()}
        onApply={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Outbound (куда отправить)'), 'warp')
    expect(screen.getByRole('button', { name: 'Переместить правило ниже' })).toBeDisabled()
  })

  it('без onMoveRule кнопок порядка нет', () => {
    wrap(
      <NodeInspector config={twoRulesConfig} nodeId="rule:0" onApply={() => {}} onRemove={() => {}} onClose={() => {}} />,
    )
    expect(screen.queryByRole('button', { name: 'Переместить правило выше' })).not.toBeInTheDocument()
  })
```

2. В `frontend/test/editor-logic.test.ts` расширить импорт из `../src/features/editor/EditorPage` именем `moveSelectedRule` и добавить:

```ts
describe('moveSelectedRule', () => {
  const cfg = {
    routing: { rules: [{ type: 'field' }, { type: 'field', outboundTag: 'x' }] },
  }

  it('переставляет правило и переносит выбор на новую позицию', () => {
    const moved = moveSelectedRule(cfg, 'rule:0', 1)!
    expect(moved.selected).toBe('rule:1')
    expect(moved.config.routing!.rules![1]).toEqual({ type: 'field' })
    expect(moved.config.routing!.rules![0]).toEqual({ type: 'field', outboundTag: 'x' })
  })

  it('null на границе, для не-rule узлов и без выбора', () => {
    expect(moveSelectedRule(cfg, 'rule:0', -1)).toBeNull()
    expect(moveSelectedRule(cfg, 'rule:1', 1)).toBeNull()
    expect(moveSelectedRule(cfg, 'in:a', 1)).toBeNull()
    expect(moveSelectedRule(cfg, null, 1)).toBeNull()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/node-inspector.test.tsx test/editor-logic.test.ts`
Ожидание: FAIL — TS не знает проп `onMoveRule`, кнопок нет; `moveSelectedRule` не экспортируется.

- [ ] **Step 3: Реализация**

1. В `frontend/src/features/topology/NodeInspector.tsx`:

В интерфейс `Props` добавить после `onRemove: () => void`:

```ts
  /** Перестановка правила (только для rule-узлов); dir: -1 — выше, +1 — ниже */
  onMoveRule?: (dir: -1 | 1) => void
```

В сигнатуре компонента добавить `onMoveRule` в деструктуризацию:

```tsx
export function NodeInspector({ config, nodeId, inboundSquads, onApply, onRemove, onClose, onMoveRule }: Props) {
```

После вычисления `oldTag` добавить:

```tsx
  const ruleIndex = kind === 'rule' ? Number(nodeId.slice(5)) : -1
  const ruleCount = config.routing?.rules?.length ?? 0
```

В JSX после блока вкладок (`{kind !== 'other' && (...)}`) добавить:

```tsx
      {kind === 'rule' && onMoveRule && (
        <div className="row">
          <span className="muted">порядок: {ruleIndex + 1} из {ruleCount}</span>
          <span className="spacer" />
          {/* Перестановка меняет selectedNode → инспектор remount'ится; при
              неприменённых правках они потерялись бы молча — блокируем кнопки */}
          <Button
            variant="ghost"
            disabled={ruleIndex <= 0 || text !== original}
            aria-label="Переместить правило выше"
            onClick={() => onMoveRule(-1)}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            disabled={ruleIndex >= ruleCount - 1 || text !== original}
            aria-label="Переместить правило ниже"
            onClick={() => onMoveRule(1)}
          >
            ↓
          </Button>
        </div>
      )}
```

2. В `frontend/src/features/editor/EditorPage.tsx`:

Расширить импорт мутаций:

```ts
import { applyNodeJson, getNodeJson, moveRule, removeNode } from '../../entities/graph/mutations'
```

Добавить после `nextSelection` экспортируемый хелпер:

```ts
// Перестановка выбранного правила: конфиг меняется, а позиционный id выбора
// должен «переехать» вместе с правилом — иначе rule:N укажет на соседа
export function moveSelectedRule(
  config: XrayConfig,
  selected: string | null,
  dir: -1 | 1,
): { config: XrayConfig; selected: string } | null {
  if (!selected || !selected.startsWith('rule:')) return null
  const from = Number(selected.slice(5))
  const next = moveRule(config, from, dir)
  if (next === config) return null
  return { config: next, selected: `rule:${from + dir}` }
}
```

В JSX `EditorInner` в вызов `<NodeInspector ...>` добавить проп после `onApply`:

```tsx
              onMoveRule={(dir) => {
                const moved = moveSelectedRule(parsedConfig, selectedNode, dir)
                if (!moved) return
                changeConfig(moved.config)
                // Перекрывает nextSelection из changeConfig: число правил не изменилось,
                // но правило переехало — выбор следует за ним
                setSelectedNode(moved.selected)
              }}
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/node-inspector.test.tsx test/editor-logic.test.ts test/graph-mutations.test.ts` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/topology/NodeInspector.tsx frontend/src/features/editor/EditorPage.tsx frontend/test/node-inspector.test.tsx frontend/test/editor-logic.test.ts
git commit -m "feat(frontend): rule reorder buttons with selection follow" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Диалог «Настройки конфига» — секция «Маршрутизация» + кнопка в тулбаре

**Files:**
- Create: `frontend/src/features/editor/ConfigSettingsDialog.tsx`
- Modify: `frontend/src/features/editor/EditorPage.tsx`
- Test: `frontend/test/config-settings-dialog.test.tsx` (создать)

**Interfaces:**
- Consumes: `Dialog`, `Button` из `shared/ui`; `SelectField` из `features/inspector/fields` (кросс-feature импорт — прецедент уже есть: editor → topology → inspector); `XrayConfig`.
- Produces: `ConfigSettingsDialog({ open, config: XrayConfig, onChange: (next: XrayConfig) => void, onClose })` — правки применяются в черновик сразу (диалог модален, конфликт с другими правками невозможен); пустая секция (`routing`/`log` без ключей) удаляется из конфига целиком. Кнопка «Настройки конфига» в тулбаре `EditorPage`, недоступна при невалидном конфиге. Task 8 доращивает секцию «Лог».

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/config-settings-dialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfigSettingsDialog } from '../src/features/editor/ConfigSettingsDialog'

describe('ConfigSettingsDialog — маршрутизация', () => {
  it('выбор domainStrategy создаёт routing, остальной конфиг не задет', async () => {
    const onChange = vi.fn()
    render(<ConfigSettingsDialog open config={{ inbounds: [] }} onChange={onChange} onClose={() => {}} />)
    await userEvent.selectOptions(screen.getByLabelText('Стратегия доменов (domainStrategy)'), 'IPIfNonMatch')
    expect(onChange).toHaveBeenLastCalledWith({ inbounds: [], routing: { domainStrategy: 'IPIfNonMatch' } })
  })

  it('сброс единственного поля удаляет routing целиком', async () => {
    const onChange = vi.fn()
    render(
      <ConfigSettingsDialog open config={{ routing: { domainStrategy: 'AsIs' } }} onChange={onChange} onClose={() => {}} />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Стратегия доменов (domainStrategy)'), '')
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('rules и неизвестные поля routing сохраняются при правке domainMatcher', async () => {
    const onChange = vi.fn()
    const config = { routing: { rules: [{ type: 'field' }], custom: 1 } }
    render(<ConfigSettingsDialog open config={config} onChange={onChange} onClose={() => {}} />)
    await userEvent.selectOptions(screen.getByLabelText('Матчер доменов (domainMatcher)'), 'linear')
    expect(onChange).toHaveBeenLastCalledWith({
      routing: { rules: [{ type: 'field' }], custom: 1, domainMatcher: 'linear' },
    })
  })

  it('кнопка «Закрыть настройки» вызывает onClose', async () => {
    const onClose = vi.fn()
    render(<ConfigSettingsDialog open config={{}} onChange={vi.fn()} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть настройки' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/config-settings-dialog.test.tsx`
Ожидание: FAIL — модуль `ConfigSettingsDialog.tsx` не существует.

- [ ] **Step 3: Реализация**

Создать `frontend/src/features/editor/ConfigSettingsDialog.tsx`:

```tsx
import type { XrayConfig } from '../../entities/xray'
import { Button, Dialog } from '../../shared/ui'
import { SelectField, type Option } from '../inspector/fields'

type Obj = Record<string, unknown>

// Пояснения зашиты в лейблы опций — отдельные hint'ы не нужны
const DOMAIN_STRATEGIES: Option[] = [
  { value: '', label: 'не задана (AsIs)' },
  { value: 'AsIs', label: 'AsIs — матчить только по домену, без резолва' },
  { value: 'IPIfNonMatch', label: 'IPIfNonMatch — резолвить в IP, если домен не совпал ни с одним правилом' },
  { value: 'IPOnDemand', label: 'IPOnDemand — резолвить сразу при первом ip-условии в правилах' },
]

const DOMAIN_MATCHERS: Option[] = [
  { value: '', label: 'не задан (hybrid)' },
  { value: 'hybrid', label: 'hybrid — быстрый (по умолчанию)' },
  { value: 'mph', label: 'mph — синоним hybrid' },
  { value: 'linear', label: 'linear — линейный перебор (для отладки)' },
]

interface Props {
  open: boolean
  config: XrayConfig
  onChange: (next: XrayConfig) => void
  onClose: () => void
}

// Глобальные настройки конфига (routing, log) — не узел графа, поэтому диалог.
// Правки применяются в черновик сразу (как в формах инспектора): диалог модален,
// параллельных правок конфига при открытом диалоге не бывает.
export function ConfigSettingsDialog({ open, config, onChange, onClose }: Props) {
  const routing = (config.routing as Obj | undefined) ?? {}

  // Ставшая пустой секция удаляется целиком — не оставляем в JSON висящие "{}"
  function patchSection(key: 'routing' | 'log', mut: (s: Obj) => void) {
    const next = structuredClone(config)
    const section = ((next as Obj)[key] as Obj | undefined) ?? {}
    mut(section)
    if (Object.keys(section).length === 0) delete (next as Obj)[key]
    else (next as Obj)[key] = section
    onChange(next)
  }

  return (
    <Dialog open={open} title="Настройки конфига" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Глобальные настройки применяются к черновику сразу.
      </p>
      <h3>Маршрутизация</h3>
      <SelectField
        label="Стратегия доменов (domainStrategy)"
        hint="Как резолвить домены при сопоставлении с ip-правилами"
        value={(routing.domainStrategy as string) ?? ''}
        options={DOMAIN_STRATEGIES}
        onChange={(v) =>
          patchSection('routing', (r) => { if (v === '') delete r.domainStrategy; else r.domainStrategy = v })
        }
      />
      <SelectField
        label="Матчер доменов (domainMatcher)"
        hint="Алгоритм сопоставления доменных правил"
        value={(routing.domainMatcher as string) ?? ''}
        options={DOMAIN_MATCHERS}
        onChange={(v) =>
          patchSection('routing', (r) => { if (v === '') delete r.domainMatcher; else r.domainMatcher = v })
        }
      />
      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose} aria-label="Закрыть настройки">
          Закрыть
        </Button>
      </div>
    </Dialog>
  )
}
```

В `frontend/src/features/editor/EditorPage.tsx`:

1. Добавить импорт после `BackupsDialog`:

```ts
import { ConfigSettingsDialog } from './ConfigSettingsDialog'
```

2. Рядом с `const [backupsOpen, setBackupsOpen] = useState(false)` добавить:

```ts
  const [settingsOpen, setSettingsOpen] = useState(false)
```

3. В тулбар перед кнопкой `Бэкапы` добавить:

```tsx
        <Button variant="ghost" disabled={parsedConfig === undefined} onClick={() => setSettingsOpen(true)}>
          Настройки конфига
        </Button>
```

4. Перед `<BackupsDialog ... />` добавить:

```tsx
      {parsedConfig !== undefined && (
        <ConfigSettingsDialog
          open={settingsOpen}
          config={parsedConfig}
          onChange={changeConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}
```

- [ ] **Step 4: Тесты зелёные (включая регрессию)**

Run: `npx vitest run test/config-settings-dialog.test.tsx test/editor-logic.test.ts test/app.test.tsx` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/editor/ConfigSettingsDialog.tsx frontend/src/features/editor/EditorPage.tsx frontend/test/config-settings-dialog.test.tsx
git commit -m "feat(frontend): config settings dialog with routing options" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Диалог «Настройки конфига» — секция «Лог»

**Files:**
- Modify: `frontend/src/features/editor/ConfigSettingsDialog.tsx`
- Test: `frontend/test/config-settings-dialog.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `patchSection` из Task 7; `TextField`, `CheckboxField` из `fields.tsx`; поля `LogSchema` (`loglevel`, `access`, `error`, `dnsLog`).
- Produces: секция «Лог» в том же диалоге; `dnsLog: false` → ключ удаляется (`CheckboxField`), пустой `log` удаляется целиком.

- [ ] **Step 1: Написать падающий тест**

Дополнить `frontend/test/config-settings-dialog.test.tsx`:

```tsx
describe('ConfigSettingsDialog — лог', () => {
  it('выбор loglevel создаёт log', async () => {
    const onChange = vi.fn()
    render(<ConfigSettingsDialog open config={{}} onChange={onChange} onClose={() => {}} />)
    await userEvent.selectOptions(screen.getByLabelText('Уровень лога (loglevel)'), 'debug')
    expect(onChange).toHaveBeenLastCalledWith({ log: { loglevel: 'debug' } })
  })

  it('правка access не трогает остальные поля log', async () => {
    const onChange = vi.fn()
    render(
      <ConfigSettingsDialog
        open
        config={{ log: { loglevel: 'warning', access: '/var/log/a.log' } }}
        onChange={onChange}
        onClose={() => {}}
      />,
    )
    await userEvent.type(screen.getByLabelText('Файл access-лога'), '2')
    expect(onChange).toHaveBeenLastCalledWith({ log: { loglevel: 'warning', access: '/var/log/a.log2' } })
  })

  it('dnsLog: включение даёт true, выключение удаляет ключ и пустой log', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ConfigSettingsDialog open config={{}} onChange={onChange} onClose={() => {}} />,
    )
    await userEvent.click(screen.getByLabelText('Логировать DNS-запросы (dnsLog)'))
    expect(onChange).toHaveBeenLastCalledWith({ log: { dnsLog: true } })
    rerender(<ConfigSettingsDialog open config={{ log: { dnsLog: true } }} onChange={onChange} onClose={() => {}} />)
    await userEvent.click(screen.getByLabelText('Логировать DNS-запросы (dnsLog)'))
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('сброс loglevel в «не задан» при других полях log сохраняет их', async () => {
    const onChange = vi.fn()
    render(
      <ConfigSettingsDialog open config={{ log: { loglevel: 'error', dnsLog: true } }} onChange={onChange} onClose={() => {}} />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Уровень лога (loglevel)'), '')
    expect(onChange).toHaveBeenLastCalledWith({ log: { dnsLog: true } })
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/config-settings-dialog.test.tsx`
Ожидание: FAIL — полей секции «Лог» нет в разметке.

- [ ] **Step 3: Реализация**

В `frontend/src/features/editor/ConfigSettingsDialog.tsx`:

1. Расширить импорт полей:

```ts
import { CheckboxField, SelectField, TextField, type Option } from '../inspector/fields'
```

2. Добавить константу после `DOMAIN_MATCHERS`:

```ts
const LOG_LEVELS: Option[] = [
  { value: '', label: 'не задан (warning)' },
  { value: 'debug', label: 'debug — максимально подробно' },
  { value: 'info', label: 'info' },
  { value: 'warning', label: 'warning (по умолчанию)' },
  { value: 'error', label: 'error' },
  { value: 'none', label: 'none — ничего не логировать' },
]
```

3. В компоненте после `const routing = ...` добавить:

```ts
  const log = (config.log as Obj | undefined) ?? {}
```

4. В JSX перед закрывающей строкой с кнопкой «Закрыть» добавить:

```tsx
      <h3 style={{ marginTop: 16 }}>Лог</h3>
      <SelectField
        label="Уровень лога (loglevel)"
        value={(log.loglevel as string) ?? ''}
        options={LOG_LEVELS}
        onChange={(v) => patchSection('log', (l) => { if (v === '') delete l.loglevel; else l.loglevel = v })}
      />
      <TextField
        label="Файл access-лога"
        mono
        hint="Путь к файлу; none — отключить; пусто — stdout"
        placeholder="/var/log/xray/access.log"
        value={log.access as string | undefined}
        onChange={(v) => patchSection('log', (l) => { if (v === undefined) delete l.access; else l.access = v })}
      />
      <TextField
        label="Файл error-лога"
        mono
        hint="Путь к файлу; none — отключить; пусто — stderr"
        placeholder="/var/log/xray/error.log"
        value={log.error as string | undefined}
        onChange={(v) => patchSection('log', (l) => { if (v === undefined) delete l.error; else l.error = v })}
      />
      <CheckboxField
        label="Логировать DNS-запросы (dnsLog)"
        value={log.dnsLog as boolean | undefined}
        onChange={(v) => patchSection('log', (l) => { if (v === undefined) delete l.dnsLog; else l.dnsLog = v })}
      />
```

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/config-settings-dialog.test.tsx` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/editor/ConfigSettingsDialog.tsx frontend/test/config-settings-dialog.test.tsx
git commit -m "feat(frontend): log section in config settings dialog" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Финальная проверка плана

**Files:** нет новых — только запуск проверок.

**Interfaces:**
- Consumes: всё из задач 1–8.
- Produces: зелёный полный прогон — маршрутизация закрыта, планы 3–4 могут строиться дальше.

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

## Self-Review (сверка со спекой, секция 3)

**Покрытие требований спеки:**

- ✅ `RuleForm` для `rule:`-узлов: `outboundTag` (select из существующих outbound — Task 3), `inboundTag` (multi-select из существующих inbound — Task 3), `domain`/`ip` (StringListField со шпаргалкой префиксов `geosite:/geoip:/domain:/full:/regexp:` и предупреждением «без префикса = keyword-подстрока» — Task 4), `port`/`sourcePort` (валидация `443` / `1000-2000` / списки — Task 4), `network` (tcp/udp/tcp,udp — Task 3), `protocol` (multi-select http/tls/quic/bittorrent + подсказка про sniffing — Task 3), `user`, `source` (Task 3). Подключение к инспектору с вкладками «Форма | JSON узла» — Task 5.
- ✅ Порядок правил: кнопки вверх/вниз (Task 1 — мутация, Task 6 — UI + выбор следует за правилом), UI явно сообщает «правила проверяются сверху вниз, побеждает первое совпавшее» (текст в RuleForm, Task 3). Номер правила в узле графа — уже реализован в `RuleNode` («правило #N», `frontend/src/features/topology/nodes.tsx`), план его сознательно не дублирует.
- ✅ Диалог «Настройки конфига»: кнопка в тулбаре (Task 7), `routing.domainStrategy` (AsIs/IPIfNonMatch/IPOnDemand с пояснениями в лейблах опций), `domainMatcher` (hybrid/mph/linear) — Task 7; секция log (`loglevel`, `access`, `error`, `dnsLog`) — Task 8. Не узел графа — модальный диалог.
- ➡️ Вне плана (по спеке): balancers (остаются в JSON), `attrs` правил (JSON), расширение `analyzeIntegrity` (домен без префикса как warning в IssueList, битые порты) — план 4; `portSpecError`/`keywordEntries` экспортированы из RuleForm именно под это переиспользование. Playwright e2e сценарий редактирования правила — план 4.

**Консистентность типов/имён:** `moveRule` живёт рядом с `addRule`/`removeNode` в `entities/graph/mutations.ts` и повторяет их контракт (чистая функция, clone, вход не мутируется); `RuleForm` повторяет паттерн `InboundForm`/`OutboundForm` (`value: Record<string, unknown>`, `onChange(next)`, `structuredClone`-patch, `delete` при `undefined`); `ConfigSettingsDialog` повторяет стиль `SaveDialog`/`BackupsDialog` (проп `open`, `Dialog` из shared/ui). Опции селектов с «пусто = ключ удалён» — как `DOMAIN_STRATEGIES` в OutboundForm. Схемы не меняются — все поля (`source`, `domainStrategy`, `domainMatcher`, `LogSchema`) уже добавлены планом 1.

**Позиционные id правил:** перестановка не меняет число правил, поэтому `nextSelection` сам по себе оставил бы выбор на чужом правиле — Task 6 решает это явным `setSelectedNode(moved.selected)` после `changeConfig`, а remount инспектора гарантирован `key={selectedNode}` в `EditorPage`. Кнопки перестановки блокируются при неприменённых правках формы — иначе правки терялись бы молча при remount.

**Плейсхолдеры:** отсутствуют — каждый шаг с изменением кода содержит полный код или точную замену «заменить X на Y»; команды запуска и ожидания указаны в каждом шаге.

**CSS:** только существующие токены (`--out` для `.field-warning`), новые классы дописаны в конец `tokens.css`; `--accent` нигде не используется.

**Новые зависимости:** нет. Новые примитивы: нет (только проброс уже существующего `hint` в три поля — Task 2, с тестом).
