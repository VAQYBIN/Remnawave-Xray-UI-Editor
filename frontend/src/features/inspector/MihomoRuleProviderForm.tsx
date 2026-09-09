// Форма записи `rule-providers.<имя>`: имя (сегмент пути), тип источника и
// остальное по схеме. Тот же приём, что у провайдера серверов — список типов
// источника берётся с поля `type` самой схемы, а не копией.

import { RULE_PROVIDER_FIELDS } from '../../entities/mihomo/schema'
import { MihomoNamedForm, type MihomoEntryFormProps } from './MihomoNamedForm'

const TYPE_VALUES = RULE_PROVIDER_FIELDS.find((f) => f.key === 'type')!.enum!

export function MihomoRuleProviderForm(p: MihomoEntryFormProps) {
  return (
    <MihomoNamedForm
      {...p}
      fields={RULE_PROVIDER_FIELDS}
      typeValues={TYPE_VALUES}
      typeLabel="Откуда брать содержимое набора."
      nameHint="На имя ссылаются правила через RULE-SET; переименование ведёт ссылки за собой."
    />
  )
}
