import { useState, type ReactNode } from 'react'
import { Button, TextInput } from '../../shared/ui'

interface KvRow {
  key: string
  value: string
}

// Пары ключ-значение (headers, hosts). Наружу уходят только строки с непустым ключом.
// Локальный буфер строк: значение из пропсов читается только при монтировании —
// внешние изменения требуют remount (key).
export function KeyValueField({
  label,
  hint,
  value,
  onChange,
  keyPlaceholder = 'Ключ',
  valuePlaceholder = 'Значение',
}: {
  label: string
  hint?: string
  value: Record<string, string> | undefined
  onChange: (v: Record<string, string> | undefined) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  const [rows, setRows] = useState<KvRow[]>(() => Object.entries(value ?? {}).map(([key, val]) => ({ key, value: val })))

  const emit = (next: KvRow[]) => {
    setRows(next)
    const entries = next.filter((r) => r.key.trim() !== '')
    onChange(entries.length > 0 ? Object.fromEntries(entries.map((r) => [r.key.trim(), r.value])) : undefined)
  }

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="kv-rows">
        {rows.map((row, i) => (
          <div key={i} className="kv-row">
            <TextInput
              value={row.key}
              placeholder={keyPlaceholder}
              onChange={(e) => emit(rows.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r)))}
            />
            <TextInput
              value={row.value}
              placeholder={valuePlaceholder}
              onChange={(e) => emit(rows.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r)))}
            />
            <button
              type="button"
              className="chip-x"
              aria-label={`Удалить пару ${i + 1}`}
              onClick={() => emit(rows.filter((_, idx) => idx !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <Button onClick={() => setRows([...rows, { key: '', value: '' }])}>+ Пара</Button>
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}

// Повторяемые карточки объектов (fallbacks, peers, certificates, dns-серверы).
// Полностью controlled: рендер идёт от value из пропсов, буфера нет.
export function ListEditor<T extends object>({
  label,
  hint,
  value,
  onChange,
  createItem,
  addLabel,
  renderItem,
}: {
  label: string
  hint?: string
  value: T[] | undefined
  onChange: (v: T[] | undefined) => void
  createItem: () => T
  addLabel: string
  renderItem: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode
}) {
  const items = value ?? []
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="list-editor">
        {items.map((item, i) => (
          <div key={i} className="list-editor-card">
            <div className="list-editor-body">
              {renderItem(item, (patch) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it))), i)}
            </div>
            <button
              type="button"
              className="chip-x"
              aria-label={`Удалить элемент ${i + 1}`}
              onClick={() => {
                const next = items.filter((_, idx) => idx !== i)
                onChange(next.length > 0 ? next : undefined)
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <Button onClick={() => onChange([...items, createItem()])}>{addLabel}</Button>
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}
