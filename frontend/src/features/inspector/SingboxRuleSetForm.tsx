// Форма набора правил sing-box. Правка идёт по модели: копия, мутация копии,
// `onChange(next)` — как у `RuleForm` в редакторе Xray.
//
// Содержимого набора здесь нет и быть не может: оно лежит по ссылке, и редактор
// его не скачивает.

import { fieldFor, type SingboxRuleSet } from '../../entities/singbox'
import { type SelectOption } from '../../shared/ui'
import { SelectField, TextField } from './fields'
import { SingboxExtraFields } from './SingboxExtraFields'

// skip — ровно то, что нарисовано ниже руками (см. SingboxOutboundForm)
const SHOWN = ['tag', 'type', 'format', 'url', 'download_detour']

/** Варианты словаря плюс текущее значение, если словарь его не знает: выбор в
 *  форме не имеет права молча заменить значение чужого шаблона первым из списка */
function optionsWith(key: 'type' | 'format', current: string): SelectOption[] {
  const options = (fieldFor('rule-set', key)?.enum ?? []).map((e) => ({ value: e.value, label: e.value }))
  const known = options.some((o) => o.value === current)
  return [
    { value: '', label: '(не задано)' },
    ...(current !== '' && !known ? [{ value: current, label: current }] : []),
    ...options,
  ]
}

export function SingboxRuleSetForm({
  value,
  onChange,
}: {
  value: SingboxRuleSet
  onChange: (next: SingboxRuleSet) => void
}) {
  const type = typeof value.type === 'string' ? value.type : ''
  const format = typeof value.format === 'string' ? value.format : ''

  function patch(mut: (draft: SingboxRuleSet) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  return (
    <>
      <TextField
        label="Тег"
        hint="Имя набора: по нему на набор ссылаются правила."
        value={value.tag}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.tag; else n.tag = v })}
      />
      <SelectField
        label="Откуда берётся"
        value={type}
        options={optionsWith('type', type)}
        onChange={(v) => patch((n) => { if (v === '') delete n.type; else n.type = v })}
      />
      <SelectField
        label="Формат"
        hint="binary (.srs) или source (.json)."
        value={format}
        options={optionsWith('format', format)}
        onChange={(v) => patch((n) => { if (v === '') delete n.format; else n.format = v })}
      />
      <TextField
        label="Ссылка"
        value={typeof value.url === 'string' ? value.url : undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.url; else n.url = v })}
      />
      <TextField
        label="Скачивать через выход"
        hint="Тег выхода, через который клиент загрузит набор."
        value={typeof value.download_detour === 'string' ? value.download_detour : undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.download_detour; else n.download_detour = v })}
      />
      <SingboxExtraFields
        section="rule-set"
        value={value}
        skip={SHOWN}
        onChange={(next) => onChange(next as SingboxRuleSet)}
      />
    </>
  )
}
