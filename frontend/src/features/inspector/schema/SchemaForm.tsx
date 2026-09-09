// Рекурсивный рендерер формы по схеме. Один на три ядра: он не знает, что
// рисует, — знает схема. Каждая правка уходит писателю ОДНОЙ операцией по
// абсолютному пути; форма никогда не отдаёт наружу целое значение.
//
// Три правила честности, ради которых он написан:
// 1) ключ, которого нет в схеме, виден на чтение и не скрывается никогда;
// 2) значение не той формы (строка вместо объекта) — на чтение с объяснением;
// 3) замок писателя — на чтение с его причиной.

import { useId, type ReactNode } from 'react'
import {
  deprecatedAt,
  isRecord,
  unknownKeys,
  visibleFields,
  type DocOp,
  type DocWriter,
  type FieldSchema,
  type RefKind,
  type SchemaPath,
} from '../../../shared/schema'
import { Button, CollapsibleSection, TextInput, type SelectOption } from '../../../shared/ui'
import { KeyValueField } from '../collections'
import {
  MultiSelectField,
  NumberField,
  SelectField,
  StringListField,
  TextField,
  TriStateField,
} from '../fields'
import { NOT_SET, SHAPE_NOTE, UNKNOWN_KEY_NOTE, deprecatedNote, moreFieldsTitle } from './labels'

export interface SchemaFormProps {
  fields: FieldSchema[]
  value: Record<string, unknown>
  /** Абсолютный путь объекта `value` в документе — операции строятся от него */
  path: SchemaPath
  writer: DocWriter
  /** Ключи, которые уже нарисовал вызывающий: второй раз их не рисуем */
  skip?: string[]
  /** Теги документа для полей со ссылкой */
  refs?: Partial<Record<RefKind, string[]>>
  /** Рисовать ли ключи панели (panelKey) */
  showPanelKeys?: boolean
}

/**
 * Поле на чтение: JSON значения и причина, почему оно не правится здесь.
 * `doc` (описание из словаря) и `note` (причина отказа) — РАЗНЫЕ узлы, а не
 * одна склеенная строка: замок писателя обязан показать голый текст причины
 * («Заполняет панель.»), и совпадение целиком, а не «где-то внутри», —
 * то, что отличает объяснение от текста, в который эта причина просто
 * затесалась.
 */
function ReadOnly({ label, doc, note, value }: { label: string; doc?: string; note: string; value: unknown }) {
  const id = useId()
  return (
    <div className="field">
      <div className="field-control">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        <TextInput id={id} readOnly value={JSON.stringify(value ?? null)} />
      </div>
      {doc ? <span className="field-hint">{doc}</span> : null}
      <span className="field-hint">{note}</span>
    </div>
  )
}

/** Текущее значение вне списка — собственный пункт: молча подменять его первым нельзя */
function withCurrent(options: SelectOption[], current: string): SelectOption[] {
  if (current === '' || options.some((o) => o.value === current)) return options
  return [options[0]!, { value: current, label: current }, ...options.slice(1)]
}

/** То же самое для множественного выбора — несколько текущих значений сразу */
function withCurrentAll(options: SelectOption[], current: string[]): SelectOption[] {
  const all = [...options]
  for (const c of current) if (!all.some((o) => o.value === c)) all.push({ value: c, label: c })
  return all
}

function shapeFits(field: FieldSchema, value: unknown): boolean {
  if (value === undefined) return true
  switch (field.kind) {
    case 'string':
    case 'enum':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'boolean':
      return typeof value === 'boolean'
    case 'list':
      return Array.isArray(value)
    case 'object':
    case 'map':
      return isRecord(value)
  }
}

function isFilled(value: unknown): boolean {
  return value !== undefined
}

interface FieldSetProps extends SchemaFormProps {
  /**
   * Заводить ли крышку «Ещё поля» вокруг незаполненных. Включена только у
   * ВЕРХНЕГО вызова: вложенный вызов рисует поля объекта или карточки
   * элемента списка, которые пользователь только что сам раскрыл, — второй
   * слой прятки поверх первого только мешал бы добраться до содержимого.
   */
  wrapRest: boolean
}

/** Общая реализация: и верхний экспортируемый `SchemaForm`, и рекурсия внутри него */
function FieldSet({
  fields,
  value,
  path,
  writer,
  skip = [],
  refs = {},
  showPanelKeys = false,
  wrapRest,
}: FieldSetProps) {
  const skipped = new Set(skip)
  const shown = visibleFields(fields, value).filter((f) => !skipped.has(f.key) && (showPanelKeys || !f.panelKey))
  // Условное поле, показавшееся из-за значения соседа, — уже само по себе сигнал,
  // а не умолчание: прятать его за «Ещё поля» значило бы заставлять искать то,
  // что пользователь только что открыл своим вводом.
  const isPromoted = (f: FieldSchema) => isFilled(value[f.key]) || f.when !== undefined
  const filled = shown.filter(isPromoted)
  const rest = shown.filter((f) => !isPromoted(f))
  const unknown = unknownKeys(fields, value).filter((k) => !skipped.has(k))
  const deprecated = new Map(deprecatedAt(fields, value).map((d) => [d.key, d.deprecation]))

  const emit = (op: DocOp) => writer.apply([op])
  const at = (key: string): SchemaPath => [...path, key]
  const setOrRemove = (key: string, next: unknown) => {
    const empty = next === undefined || next === '' || (Array.isArray(next) && next.length === 0)
    emit(empty ? { op: 'remove', path: at(key) } : { op: 'set', path: at(key), value: next })
  }

  function hintOf(field: FieldSchema): string {
    const d = deprecated.get(field.key) ?? field.deprecated
    return d === undefined ? field.doc : `${field.doc} ${deprecatedNote(d)}`
  }

  function listRow(field: FieldSchema, current: unknown, hint: string): ReactNode {
    const item = field.item ?? { kind: 'string' as const }
    const list = Array.isArray(current) ? current : []

    if (item.kind === 'object') {
      const key = field.key
      return (
        <div key={key} className="field" role="group" aria-label={key}>
          <span className="field-label">{key}</span>
          <div className="list-editor">
            {list.map((entry, i) => (
              <div key={i} className="list-editor-card">
                <div className="list-editor-body">
                  <span className="eyebrow">{item.label?.(entry, i) ?? `${key} #${i + 1}`}</span>
                  <FieldSet
                    fields={item.fields ?? []}
                    value={isRecord(entry) ? entry : {}}
                    path={[...at(key), i]}
                    writer={writer}
                    refs={refs}
                    showPanelKeys={showPanelKeys}
                    wrapRest={false}
                  />
                </div>
                <div className="list-editor-order">
                  <button
                    type="button"
                    className="chip-x"
                    aria-label={`Переместить элемент ${i + 1} выше`}
                    disabled={i === 0}
                    onClick={() => emit({ op: 'move', path: at(key), from: i, to: i - 1 })}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="chip-x"
                    aria-label={`Переместить элемент ${i + 1} ниже`}
                    disabled={i === list.length - 1}
                    onClick={() => emit({ op: 'move', path: at(key), from: i, to: i + 1 })}
                  >
                    ↓
                  </button>
                </div>
                <button
                  type="button"
                  className="chip-x"
                  aria-label={`Удалить элемент ${i + 1}`}
                  onClick={() => emit({ op: 'remove', path: [...at(key), i] })}
                >
                  ✕
                </button>
              </div>
            ))}
            <Button onClick={() => emit({ op: 'insert', path: at(key), index: list.length, value: item.starter?.() ?? {} })}>
              + Добавить
            </Button>
          </div>
          <span className="field-hint">{hint}</span>
        </div>
      )
    }

    if (item.kind === 'number') {
      return (
        <StringListField
          key={field.key}
          label={field.key}
          hint={hint}
          value={list.length > 0 ? list.map((v) => String(v)) : undefined}
          onChange={(v) => setOrRemove(field.key, v?.map((s) => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s)))}
        />
      )
    }

    if (item.enum !== undefined) {
      const options = withCurrentAll(item.enum.map((e) => ({ value: e.value, label: e.value })), list.map(String))
      return (
        <MultiSelectField
          key={field.key}
          label={field.key}
          hint={hint}
          options={options}
          value={list.length > 0 ? list.map(String) : undefined}
          onChange={(v) => setOrRemove(field.key, v)}
        />
      )
    }

    // Список строк-ссылок (теги других записей документа: outbound, inbound, rule-set…).
    // Текущие значения ВНЕ списка тегов проброшены пунктами — тег, который подставит
    // панель, или опечатка автора не должны молча исчезнуть из списка при открытии формы.
    if (item.kind === 'string' && item.ref !== undefined) {
      const tags = refs[item.ref] ?? []
      const current = list.map(String)
      if (tags.length > 0 || current.length > 0) {
        const options = withCurrentAll(tags.map((t) => ({ value: t, label: t })), current)
        return (
          <MultiSelectField
            key={field.key}
            label={field.key}
            hint={hint}
            options={options}
            value={current.length > 0 ? current : undefined}
            onChange={(v) => setOrRemove(field.key, v)}
          />
        )
      }
      // Выбирать не из чего и печатать пока нечего — падаем в обычный текстовый список ниже
    }

    return (
      <StringListField
        key={field.key}
        label={field.key}
        hint={hint}
        value={list.length > 0 ? list.map(String) : undefined}
        onChange={(v) => setOrRemove(field.key, v)}
      />
    )
  }

  function row(field: FieldSchema): ReactNode {
    const current = value[field.key]
    const lock = writer.lockAt(at(field.key))
    if (lock !== null) {
      return <ReadOnly key={field.key} label={field.key} doc={field.doc} note={lock.reason} value={current} />
    }
    if (!shapeFits(field, current)) {
      return <ReadOnly key={field.key} label={field.key} doc={field.doc} note={SHAPE_NOTE} value={current} />
    }
    const hint = hintOf(field)

    switch (field.kind) {
      case 'string': {
        if (field.ref !== undefined) {
          const tags = refs[field.ref] ?? []
          const cur = typeof current === 'string' ? current : ''
          return (
            <SelectField
              key={field.key}
              label={field.key}
              hint={hint}
              value={cur}
              options={withCurrent([{ value: '', label: NOT_SET }, ...tags.map((t) => ({ value: t, label: t }))], cur)}
              onChange={(v) => setOrRemove(field.key, v)}
            />
          )
        }
        return (
          <TextField
            key={field.key}
            label={field.key}
            hint={hint}
            value={typeof current === 'string' ? current : undefined}
            onChange={(v) => setOrRemove(field.key, v)}
          />
        )
      }
      case 'number':
        return (
          <NumberField
            key={field.key}
            label={field.key}
            hint={hint}
            value={typeof current === 'number' ? current : undefined}
            integer={field.integer}
            min={field.min}
            onChange={(v) => setOrRemove(field.key, v)}
          />
        )
      case 'boolean':
        return (
          <TriStateField
            key={field.key}
            label={field.key}
            hint={hint}
            value={typeof current === 'boolean' ? current : undefined}
            onChange={(v) =>
              v === undefined
                ? emit({ op: 'remove', path: at(field.key) })
                : emit({ op: 'set', path: at(field.key), value: v })
            }
          />
        )
      case 'enum': {
        const cur = typeof current === 'string' ? current : ''
        const options = [{ value: '', label: NOT_SET }, ...(field.enum ?? []).map((e) => ({ value: e.value, label: e.value }))]
        return (
          <SelectField
            key={field.key}
            label={field.key}
            hint={hint}
            value={cur}
            options={withCurrent(options, cur)}
            onChange={(v) => setOrRemove(field.key, v)}
          />
        )
      }
      case 'map': {
        const map = isRecord(current) ? (current as Record<string, string>) : undefined
        return (
          <KeyValueField
            key={field.key}
            label={field.key}
            hint={hint}
            value={map}
            onChange={(v) => setOrRemove(field.key, v)}
          />
        )
      }
      case 'list':
        return listRow(field, current, hint)
      case 'object': {
        const inner = isRecord(current) ? current : {}
        return (
          <CollapsibleSection key={field.key} title={field.key} defaultOpen={isFilled(current)}>
            <p className="muted" style={{ margin: '0 0 8px' }}>
              {hint}
            </p>
            <FieldSet
              fields={field.fields ?? []}
              value={inner}
              path={at(field.key)}
              writer={writer}
              refs={refs}
              showPanelKeys={showPanelKeys}
              wrapRest={false}
            />
          </CollapsibleSection>
        )
      }
      default:
        return null
    }
  }

  return (
    <>
      {filled.map(row)}
      {unknown.map((key) => (
        <ReadOnly key={`unknown:${key}`} label={key} note={UNKNOWN_KEY_NOTE} value={value[key]} />
      ))}
      {wrapRest
        ? rest.length > 0 && (
            <CollapsibleSection title={moreFieldsTitle(rest.length)}>{rest.map(row)}</CollapsibleSection>
          )
        : rest.map(row)}
    </>
  )
}

export function SchemaForm(props: SchemaFormProps) {
  return <FieldSet {...props} wrapRest />
}
