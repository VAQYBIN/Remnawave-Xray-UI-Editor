// Форма группы `proxy-groups[]`: имя, тип и остальное по схеме. Ключи панели
// (`remnawave.include-proxies` и соседи) видны всегда — это и есть главный
// рычаг подстановки хостов в группу.

import { GROUP_FIELDS, GROUP_TYPE_VALUES } from '../../entities/mihomo/schema'
import { MihomoNamedForm, type MihomoEntryFormProps } from './MihomoNamedForm'

export function MihomoGroupForm(p: MihomoEntryFormProps) {
  return (
    <MihomoNamedForm
      {...p}
      fields={GROUP_FIELDS}
      typeValues={GROUP_TYPE_VALUES}
      typeLabel="Как группа выбирает участника."
      nameHint="На имя ссылаются правила и другие группы; переименование ведёт ссылки за собой."
    />
  )
}
