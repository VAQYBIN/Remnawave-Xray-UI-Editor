import { useState, type ReactNode } from 'react'
import { Button, Checkbox, Select, TextInput } from '../../shared/ui'

export interface Option {
  value: string
  label: string
}

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
  // hint вынесен за <label>: внутри label его текст приклеился бы к accessible-имени
  // контрола (getByLabelText/скринридер видели бы «лейбл + подсказка»)
  return (
    <div className={mono ? 'field field-mono' : 'field'}>
      <label className="field-control">
        <span className="field-label">{label}</span>
        {children}
      </label>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}

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

// Порт может быть числом или строкой-диапазоном ("443-500") — числовые строки приводим к number
// Локальный текст для сохранения значения во время набора; наружу уходит очищенное значение.
// Значение из пропсов читается только при монтировании — внешние изменения требуют remount (key).
export function PortField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | string | undefined
  onChange: (v: number | string | undefined) => void
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  return (
    <Field label={label}>
      <TextInput
        value={text}
        placeholder="443"
        onChange={(e) => {
          setText(e.target.value)
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

// Локальный текст, чтобы не терять пустые строки во время набора; наружу уходит очищенный список.
// Значение из пропсов читается только при монтировании — внешние изменения требуют remount (key).
export function StringListField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  value: string[] | undefined
  onChange: (v: string[] | undefined) => void
  placeholder?: string
}) {
  const [text, setText] = useState((value ?? []).join('\n'))
  return (
    <Field label={label} hint={hint} mono>
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
