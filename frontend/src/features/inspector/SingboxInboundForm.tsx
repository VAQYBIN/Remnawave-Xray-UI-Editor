// Форма входа клиента sing-box. Правка идёт по модели: копия, мутация копии,
// `onChange(next)` — как у `RuleForm` в редакторе Xray.

import { fieldFor, type SingboxInbound } from '../../entities/singbox'
import { type SelectOption } from '../../shared/ui'
import { NumberField, SelectField, TextField } from './fields'
import { SingboxExtraFields } from './SingboxExtraFields'

// skip — ровно то, что нарисовано ниже руками (см. SingboxOutboundForm)
const SHOWN = ['tag', 'type', 'listen', 'listen_port']

/** Варианты словаря плюс текущий тип, если словарь его не знает: выбор в форме
 *  не имеет права молча заменить тип чужого шаблона первым из списка */
function typeOptions(current: string): SelectOption[] {
  const options = (fieldFor('inbound', 'type')?.enum ?? []).map((e) => ({ value: e.value, label: e.value }))
  if (current !== '' && !options.some((o) => o.value === current)) {
    return [{ value: current, label: current }, ...options]
  }
  return options
}

export function SingboxInboundForm({
  value,
  onChange,
}: {
  value: SingboxInbound
  onChange: (next: SingboxInbound) => void
}) {
  function patch(mut: (draft: SingboxInbound) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  return (
    <>
      <TextField
        label="Тег"
        hint="Имя входа: на него ссылается условие inbound в правилах."
        value={value.tag}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.tag; else n.tag = v })}
      />
      <SelectField
        label="Тип"
        value={value.type}
        options={typeOptions(value.type)}
        onChange={(v) => patch((n) => { n.type = v })}
      />
      <TextField
        label="Адрес прослушивания"
        value={typeof value.listen === 'string' ? value.listen : undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.listen; else n.listen = v })}
      />
      <NumberField
        label="Порт прослушивания"
        value={typeof value.listen_port === 'number' ? value.listen_port : undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.listen_port; else n.listen_port = v })}
      />
      <SingboxExtraFields
        section="inbound"
        value={value}
        skip={SHOWN}
        onChange={(next) => onChange(next as SingboxInbound)}
      />
    </>
  )
}
