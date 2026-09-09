// Форма сервера `proxies[]`: имя, протокол и остальное по схеме. Полнота
// схемы — форма умеет любой тип, который умеет ядро, а не только те, что
// кладёт панель.

import { PROXY_FIELDS, PROXY_TYPE_VALUES } from '../../entities/mihomo/schema'
import { MihomoNamedForm, type MihomoEntryFormProps } from './MihomoNamedForm'

export function MihomoProxyForm(p: MihomoEntryFormProps) {
  return (
    <MihomoNamedForm
      {...p}
      fields={PROXY_FIELDS}
      typeValues={PROXY_TYPE_VALUES}
      typeLabel="Протокол сервера."
      nameHint="На имя ссылаются группы и правила; переименование ведёт ссылки за собой."
    />
  )
}
