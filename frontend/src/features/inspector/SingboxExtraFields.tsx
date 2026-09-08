// Поля секции по словарю: всё, чему не нашлось места в основной форме.
//
// Форма не прячет то, чего не умеет: значение вложенного отображения или списка
// объектов показывается на чтение с названной причиной. Спрятать значило бы
// соврать, что его нет, а вписать наугад — испортить документ.
//
// Правка идёт по модели, а не по тексту: у sing-box нет ни якорей, ни
// комментария-маркера, ради которых у Mihomo заводились сплайсы, поэтому и
// механики отказов `lockOf` здесь нет — причин «форме некуда вписать ключ» не
// бывает.

import { SINGBOX_SECTIONS, type SingboxField, type SingboxSectionName } from '../../entities/singbox'
import { CollapsibleSection, TextInput } from '../../shared/ui'
import { CheckboxField, Field, NumberField, SelectField, StringListField, TextField } from './fields'

const READ_ONLY_NOTE = 'Значение — вложенная структура; правится на вкладке JSON.'

/** Виды, которые форма умеет выразить полем. Остальное — только на чтение */
function isScalarField(field: SingboxField): boolean {
  return (
    field.type === 'string' || field.type === 'number' || field.type === 'boolean' || field.type === 'strings'
  )
}

export function SingboxExtraFields({
  section,
  value,
  skip,
  onChange,
}: {
  section: SingboxSectionName
  value: Record<string, unknown>
  /** Ключи, которые уже показаны основной формой: второй раз их рисовать незачем */
  skip: string[]
  onChange: (next: Record<string, unknown>) => void
}) {
  const skipped = new Set(skip)
  // Составные ключи (`remnawave.includeProxies`) в этот список не идут: их
  // показывает форма своего отображения, а здесь они читались бы как ключ с
  // точкой в имени
  const fields = SINGBOX_SECTIONS[section].filter((f) => !skipped.has(f.key) && !f.key.includes('.'))
  const filled = fields.filter((f) => value[f.key] !== undefined)
  const rest = fields.filter((f) => value[f.key] === undefined)

  const patch = (key: string, next: unknown) => {
    const copy = structuredClone(value)
    if (next === undefined || next === '') delete copy[key]
    else copy[key] = next
    onChange(copy)
  }

  const row = (field: SingboxField) => {
    const current = value[field.key]
    if (!isScalarField(field)) {
      return (
        <Field key={field.key} label={field.key} hint={`${field.doc} ${READ_ONLY_NOTE}`}>
          <TextInput readOnly value={JSON.stringify(current ?? null)} />
        </Field>
      )
    }
    // Список проверяется ДО enum: у `network` варианты есть, но лежат они
    // списком, и Select записал бы туда строку — документ, которого ядро не ждёт
    if (field.type === 'strings') {
      return (
        <StringListField
          key={field.key}
          label={field.key}
          hint={field.doc}
          value={Array.isArray(current) ? (current as string[]) : undefined}
          onChange={(v) => patch(field.key, v)}
        />
      )
    }
    if (field.enum) {
      return (
        <SelectField
          key={field.key}
          label={field.key}
          hint={field.doc}
          value={typeof current === 'string' ? current : ''}
          options={[
            { value: '', label: '(не задано)' },
            ...field.enum.map((e) => ({ value: e.value, label: e.value })),
          ]}
          onChange={(v) => patch(field.key, v === '' ? undefined : v)}
        />
      )
    }
    if (field.type === 'boolean') {
      return (
        <CheckboxField
          key={field.key}
          label={field.key}
          hint={field.doc}
          value={typeof current === 'boolean' ? current : undefined}
          onChange={(v) => patch(field.key, v)}
        />
      )
    }
    if (field.type === 'number') {
      return (
        <NumberField
          key={field.key}
          label={field.key}
          value={typeof current === 'number' ? current : undefined}
          onChange={(v) => patch(field.key, v)}
        />
      )
    }
    return (
      <TextField
        key={field.key}
        label={field.key}
        hint={field.doc}
        value={typeof current === 'string' ? current : undefined}
        onChange={(v) => patch(field.key, v)}
      />
    )
  }

  return (
    <>
      {filled.map(row)}
      {rest.length > 0 && (
        <CollapsibleSection title={`Ещё поля (${rest.length})`}>{rest.map(row)}</CollapsibleSection>
      )}
    </>
  )
}
