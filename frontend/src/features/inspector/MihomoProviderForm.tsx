// Форма записи `proxy-providers.<имя>`: имя (сегмент пути), тип источника и
// остальное по схеме. Список типов источника не экспортирован отдельно у
// схемы провайдера — он и так лежит на поле `type` самой схемы, вытаскивать
// его копией значило бы завести второй список, который разойдётся с первым.

import { PROVIDER_FIELDS } from '../../entities/mihomo/schema'
import { MihomoNamedForm, type MihomoEntryFormProps } from './MihomoNamedForm'

const TYPE_VALUES = PROVIDER_FIELDS.find((f) => f.key === 'type')!.enum!

export function MihomoProviderForm(p: MihomoEntryFormProps) {
  return (
    <MihomoNamedForm
      {...p}
      fields={PROVIDER_FIELDS}
      typeValues={TYPE_VALUES}
      typeLabel="Откуда брать список серверов."
      nameHint="На имя ссылается use у групп; переименование ведёт ссылки за собой."
    />
  )
}
