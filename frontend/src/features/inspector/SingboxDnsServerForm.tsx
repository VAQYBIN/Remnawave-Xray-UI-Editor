// Форма DNS-сервера sing-box. Правка идёт по модели: копия, мутация копии,
// `onChange(next)` — как у `RuleForm` в редакторе Xray.

import { fieldFor } from '../../entities/singbox'
import { type SelectOption } from '../../shared/ui'
import { SelectField, TextField } from './fields'
import { SingboxExtraFields } from './SingboxExtraFields'

// skip — ровно то, что нарисовано ниже руками (см. SingboxOutboundForm)
const SHOWN = ['tag', 'type', 'server', 'detour']

/** Варианты словаря плюс текущий тип, если словарь его не знает: выбор в форме
 *  не имеет права молча заменить тип чужого шаблона первым из списка */
function typeOptions(current: string): SelectOption[] {
  const options = (fieldFor('dns-server', 'type')?.enum ?? []).map((e) => ({ value: e.value, label: e.value }))
  const known = options.some((o) => o.value === current)
  return [
    { value: '', label: '(не задано)' },
    ...(current !== '' && !known ? [{ value: current, label: current }] : []),
    ...options,
  ]
}

export function SingboxDnsServerForm({
  value,
  onChange,
}: {
  /** Сервер DNS — свободный объект: у каждого транспорта свои ключи */
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}) {
  const type = typeof value.type === 'string' ? value.type : ''

  function patch(mut: (draft: Record<string, unknown>) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  return (
    <>
      <TextField
        label="Тег"
        hint="Имя сервера: по нему на него ссылаются правила DNS."
        value={typeof value.tag === 'string' ? value.tag : undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.tag; else n.tag = v })}
      />
      <SelectField
        label="Транспорт"
        value={type}
        options={typeOptions(type)}
        onChange={(v) => patch((n) => { if (v === '') delete n.type; else n.type = v })}
      />
      <TextField
        label="Адрес"
        value={typeof value.server === 'string' ? value.server : undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.server; else n.server = v })}
      />
      <TextField
        label="Через выход"
        hint="Тег выхода, через который уйдут запросы этого сервера."
        value={typeof value.detour === 'string' ? value.detour : undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.detour; else n.detour = v })}
      />
      <SingboxExtraFields section="dns-server" value={value} skip={SHOWN} onChange={onChange} />
    </>
  )
}
