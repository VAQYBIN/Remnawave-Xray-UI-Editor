// Форма DNS-сервера sing-box: тег, транспорт, адрес и выход руками; всё по
// типу — из схемы. Старый формат (address без type) не скрывается: схема
// показывает его поля с пометкой устаревшего.

import { DNS_SERVER_FIELDS, DNS_SERVER_TYPE_VALUES } from '../../entities/singbox'
import { visibleFields, type DocWriter, type RefKind, type SchemaPath } from '../../shared/schema'
import { SelectField, TextField } from './fields'
import { SchemaForm } from './schema/SchemaForm'
import { typeHint, typeOptions } from './schema/typeSelect'

const SHOWN = ['tag', 'type', 'server', 'detour']

export function SingboxDnsServerForm({ value, path, writer, refs }: {
  value: Record<string, unknown>
  path: SchemaPath
  writer: DocWriter
  refs: Partial<Record<RefKind, string[]>>
}) {
  const type = typeof value.type === 'string' ? value.type : ''
  const detour = typeof value.detour === 'string' ? value.detour : ''
  const visible = new Set(visibleFields(DNS_SERVER_FIELDS, value).map((f) => f.key))
  const setOrRemove = (key: string, next: unknown) =>
    writer.apply([next === undefined || next === '' ? { op: 'remove', path: [...path, key] } : { op: 'set', path: [...path, key], value: next }])

  return (
    <>
      <TextField label="Тег" hint="Имя сервера: по нему на него ссылаются правила DNS." value={typeof value.tag === 'string' ? value.tag : undefined} onChange={(v) => writer.apply([{ op: 'set', path: [...path, 'tag'], value: v ?? '' }])} />
      <SelectField label="Транспорт" hint={typeHint(DNS_SERVER_TYPE_VALUES, type)} value={type} options={typeOptions(DNS_SERVER_TYPE_VALUES, type, true)} onChange={(v) => setOrRemove('type', v)} />
      {visible.has('server') && (
        <TextField label="Адрес" value={typeof value.server === 'string' ? value.server : undefined} onChange={(v) => setOrRemove('server', v)} />
      )}
      {visible.has('detour') && (
        <SelectField label="Через выход" hint="Тег выхода, через который уйдут запросы этого сервера." value={detour} options={typeOptions((refs.outbound ?? []).map((value) => ({ value })), detour, true)} onChange={(v) => setOrRemove('detour', v)} />
      )}
      <SchemaForm fields={DNS_SERVER_FIELDS} value={value} path={path} writer={writer} refs={refs} skip={SHOWN} />
    </>
  )
}
