// Форма записи `listeners[]`: имя, тип входа и остальное по схеме.

import { LISTENER_FIELDS, LISTENER_TYPE_VALUES } from '../../entities/mihomo/schema'
import { MihomoNamedForm, type MihomoEntryFormProps } from './MihomoNamedForm'

export function MihomoListenerForm(p: MihomoEntryFormProps) {
  return (
    <MihomoNamedForm
      {...p}
      fields={LISTENER_FIELDS}
      typeValues={LISTENER_TYPE_VALUES}
      typeLabel="Тип входа."
      nameHint="На имя ссылается правило IN-NAME; переименование ведёт ссылки за собой."
    />
  )
}
