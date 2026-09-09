// Форма входа клиента sing-box: тег и тип руками, остальное — по типу из схемы
// (у tun свои поля, у прокси-входов listen-поля и пользователи).

import { INBOUND_FIELDS, INBOUND_TYPE_VALUES, type SingboxInbound } from '../../entities/singbox'
import type { DocWriter, RefKind, SchemaPath } from '../../shared/schema'
import { SelectField, TextField } from './fields'
import { SchemaForm } from './schema/SchemaForm'
import { typeHint, typeOptions } from './schema/typeSelect'

const SHOWN = ['tag', 'type']

export function SingboxInboundForm({ value, path, writer, refs }: {
  value: SingboxInbound
  path: SchemaPath
  writer: DocWriter
  refs: Partial<Record<RefKind, string[]>>
}) {
  const set = (key: string, next: unknown) => writer.apply([{ op: 'set', path: [...path, key], value: next }])
  return (
    <>
      <TextField
        label="Тег"
        hint="Имя входа: на него ссылается условие inbound в правилах."
        value={value.tag}
        onChange={(v) => set('tag', v ?? '')}
      />
      <SelectField label="Тип" hint={typeHint(INBOUND_TYPE_VALUES, value.type)} value={value.type} options={typeOptions(INBOUND_TYPE_VALUES, value.type)} onChange={(v) => set('type', v)} />
      <SchemaForm fields={INBOUND_FIELDS} value={value as Record<string, unknown>} path={path} writer={writer} refs={refs} skip={SHOWN} />
    </>
  )
}
