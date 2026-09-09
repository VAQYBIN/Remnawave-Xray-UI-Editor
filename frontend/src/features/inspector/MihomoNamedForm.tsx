// Одна форма на все именованные записи Mihomo: имя, тип и всё остальное по
// схеме. Главных полей ровно два — остальное SchemaForm поднимет наверх само,
// если оно заполнено (server и port у настоящего сервера, url у провайдера).

import type { ReactNode } from 'react'
import type { EnumValue, FieldSchema, SchemaPath, DocWriter } from '../../shared/schema'
import type { DocRefs } from './schema/DocPanel'
import { SelectField } from './fields'
import { MihomoNameField } from './MihomoNameField'
import { SchemaForm } from './schema/SchemaForm'
import { typeHint, typeOptions } from './schema/typeSelect'

export interface MihomoEntryFormProps {
  value: Record<string, unknown>
  path: SchemaPath
  writer: DocWriter
  refs: DocRefs
  /** Имя записи: у списков — value.name, у отображений — последний сегмент пути; форма его не читает сама */
  name: string
  /** Переименование с переносом ссылок; null — успех, иначе текст отказа, который поле покажет */
  onRename: (to: string) => string | null
}

export function MihomoNamedForm({
  value, path, writer, refs, name, onRename, fields, typeValues, typeLabel, nameHint, skip = [],
}: MihomoEntryFormProps & { fields: FieldSchema[]; typeValues: EnumValue[]; typeLabel: string; nameHint: string; skip?: string[] }): ReactNode {
  const type = typeof value.type === 'string' ? value.type : ''
  return (
    <>
      <MihomoNameField value={name} hint={nameHint} onRename={onRename} />
      <SelectField
        label="Тип"
        hint={typeHint(typeValues, type) ?? typeLabel}
        value={type}
        options={typeOptions(typeValues, type, true)}
        onChange={(v) => writer.apply([v === '' ? { op: 'remove', path: [...path, 'type'] } : { op: 'set', path: [...path, 'type'], value: v }])}
      />
      <SchemaForm fields={fields} value={value} path={path} writer={writer} refs={refs} skip={['name', 'type', ...skip]} showPanelKeys />
    </>
  )
}
