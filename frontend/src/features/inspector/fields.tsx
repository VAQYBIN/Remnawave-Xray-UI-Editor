import { useId, useState, type ReactNode } from 'react'
import { Checkbox, Select, TextInput, type SelectOption } from '../../shared/ui'

export type Option = SelectOption

export function Field({
  label,
  hint,
  mono,
  controlId,
  children,
}: {
  label: string
  hint?: string
  mono?: boolean
  /** Связать лейбл с контролом по id вместо обёртки. Нужно контролам, у которых
   *  значение лежит в текстовом содержимом (кастомный select): внутри <label>
   *  оно приклеилось бы к accessible-имени («Протокол vless» вместо «Протокол»). */
  controlId?: string
  children: ReactNode
}) {
  // hint вынесен за <label>: внутри label его текст приклеился бы к accessible-имени
  // контрола (getByLabelText/скринридер видели бы «лейбл + подсказка»)
  return (
    <div className={mono ? 'field field-mono' : 'field'}>
      {controlId ? (
        <div className="field-control">
          <label className="field-label" htmlFor={controlId}>
            {label}
          </label>
          {children}
        </div>
      ) : (
        <label className="field-control">
          <span className="field-label">{label}</span>
          {children}
        </label>
      )}
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

/**
 * Число. По умолчанию — неотрицательное целое (порты, счётчики): именно так
 * читались все прежние поля. Схема может разрешить дробное (`integer: false`)
 * и отрицательное (`min < 0`); ввод ниже `min` не пишется — форма не подменяет
 * набранное, она его просто не принимает.
 *
 * Локальный текстовый буфер, как у `PortField`: промежуточные состояния при
 * наборе отрицательного или дробного числа («-», «-2.») не совпадают с
 * итоговым паттерном и потому не коммитятся через onChange. Без буфера
 * контролируемый инпут откатывал бы такой символ сразу после нажатия — React
 * возвращает DOM к prop `value`, если onChange не вызван, — и набрать «-2.5»
 * посимвольно было бы физически невозможно: каждая следующая цифра печаталась
 * бы в уже очищенное поле. Значение из пропсов читается только при
 * монтировании — внешние изменения требуют remount (key).
 */
export function NumberField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  integer = true,
  min,
}: {
  label: string
  hint?: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  placeholder?: string
  integer?: boolean
  min?: number
}) {
  const allowNegative = min !== undefined && min < 0
  const pattern = integer
    ? allowNegative ? /^-?\d+$/ : /^\d+$/
    : allowNegative ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/
  const [text, setText] = useState(value === undefined ? '' : String(value))
  return (
    <Field label={label} hint={hint}>
      <TextInput
        value={text}
        placeholder={placeholder}
        inputMode={integer && !allowNegative ? 'numeric' : 'decimal'}
        onChange={(e) => {
          const raw = e.target.value
          setText(raw)
          const t = raw.trim()
          if (t === '') return onChange(undefined)
          if (!pattern.test(t)) return
          const n = Number(t)
          if (min !== undefined && n < min) return
          onChange(n)
        }}
      />
    </Field>
  )
}

/**
 * Булево поле с ТРЕМЯ состояниями. `CheckboxField` снимает ключ на false — для
 * форм Xray это верно (false там всегда умолчание), а у sing-box явное
 * `set_system_proxy: false` или `auto_route: false` — реальные значения, и
 * снять ключ значило бы записать другое. Стиль — сегменты, как у переключателя
 * «Форма / JSON узла».
 */
export function TriStateField({
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
  const states: { v: boolean | undefined; text: string }[] = [
    { v: undefined, text: 'не задано' },
    { v: true, text: 'да' },
    { v: false, text: 'нет' },
  ]
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented tristate" role="group" aria-label={label}>
        {states.map((s) => (
          <button
            key={s.text}
            type="button"
            className="btn"
            aria-pressed={value === s.v}
            onClick={() => onChange(s.v)}
          >
            {s.text}
          </button>
        ))}
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
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
  const id = useId()
  return (
    <Field label={label} hint={hint} controlId={id}>
      <Select id={id} value={value} options={options} onChange={onChange} />
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

// Список коротких значений чипами: удаление крестиком, кнопки добавления/генерации
// передаются через actions. Пустая строка — валидное значение (например пустой
// shortId у Reality) и показывается плейсхолдером emptyLabel, а не пустым чипом.
export function TagListField({
  label,
  hint,
  value,
  onChange,
  actions,
  emptyLabel = '(пусто)',
}: {
  label: string
  hint?: string
  value: string[] | undefined
  onChange: (v: string[] | undefined) => void
  actions: ReactNode
  emptyLabel?: string
}) {
  const items = value ?? []
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="row-wrap">
        {items.map((s, i) => (
          <span key={`${s}:${i}`} className="taglist-item">
            {s === '' ? <span className="muted">{emptyLabel}</span> : s}
            <button
              type="button"
              className="chip-x"
              aria-label={`Удалить ${s || emptyLabel}`}
              onClick={() => {
                const next = items.filter((_, idx) => idx !== i)
                onChange(next.length > 0 ? next : undefined)
              }}
            >
              ✕
            </button>
          </span>
        ))}
        {actions}
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
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
