// Форма набора правил sing-box: тег, откуда берётся, формат, ссылка и выход
// загрузки руками; путь, интервал и правила встроенного набора — из схемы.

import { RULE_SET_FIELDS, type SingboxRuleSet } from '../../entities/singbox'
import { visibleFields, type DocWriter, type RefKind, type SchemaPath } from '../../shared/schema'
import { SelectField, TextField } from './fields'
import { SchemaForm } from './schema/SchemaForm'
import { typeOptions } from './schema/typeSelect'

const SHOWN = ['tag', 'type', 'format', 'url', 'download_detour']
const enumOf = (key: string) => RULE_SET_FIELDS.find((f) => f.key === key)?.enum ?? []

export function SingboxRuleSetForm({ value, path, writer, refs }: {
  value: SingboxRuleSet
  path: SchemaPath
  writer: DocWriter
  refs: Partial<Record<RefKind, string[]>>
}) {
  const type = typeof value.type === 'string' ? value.type : ''
  const format = typeof value.format === 'string' ? value.format : ''
  const detour = typeof value.download_detour === 'string' ? value.download_detour : ''
  const visible = new Set(visibleFields(RULE_SET_FIELDS, value).map((f) => f.key))
  const setOrRemove = (key: string, next: unknown) =>
    writer.apply([next === undefined || next === '' ? { op: 'remove', path: [...path, key] } : { op: 'set', path: [...path, key], value: next }])

  return (
    <>
      <TextField label="Тег" hint="Имя набора: по нему на набор ссылаются правила." value={value.tag} onChange={(v) => writer.apply([{ op: 'set', path: [...path, 'tag'], value: v ?? '' }])} />
      <SelectField label="Откуда берётся" value={type} options={typeOptions(enumOf('type'), type, true)} onChange={(v) => setOrRemove('type', v)} />
      {visible.has('format') && (
        <SelectField label="Формат" hint="binary (.srs) или source (.json)." value={format} options={typeOptions(enumOf('format'), format, true)} onChange={(v) => setOrRemove('format', v)} />
      )}
      {visible.has('url') && (
        <TextField label="Ссылка" value={typeof value.url === 'string' ? value.url : undefined} onChange={(v) => setOrRemove('url', v)} />
      )}
      {visible.has('download_detour') && (
        <SelectField
          label="Скачивать через выход"
          hint="Тег выхода, через который клиент загрузит набор. Устарело с 1.14: там это http_client."
          value={detour}
          options={typeOptions((refs.outbound ?? []).map((value) => ({ value })), detour, true)}
          onChange={(v) => setOrRemove('download_detour', v)}
        />
      )}
      <SchemaForm fields={RULE_SET_FIELDS} value={value as Record<string, unknown>} path={path} writer={writer} refs={refs} skip={SHOWN} />
    </>
  )
}
