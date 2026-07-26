import { BALANCE_STRATEGY_OPTIONS, type BalanceParams } from '../../../entities/xray'
import {
  CheckboxField,
  MultiSelectField,
  SelectField,
  TextField,
  type Option,
} from '../../inspector/fields'

export function BalanceForm({
  value,
  outboundTags,
  onChange,
}: {
  value: BalanceParams
  outboundTags: string[]
  onChange: (v: BalanceParams) => void
}) {
  const fallbackOptions: Option[] = [
    { value: '', label: 'без запасного выхода' },
    ...outboundTags.filter((t) => !value.members.includes(t)).map((t) => ({ value: t, label: t })),
  ]
  return (
    <>
      <TextField
        label="Тег балансера"
        value={value.tag}
        onChange={(v) => onChange({ ...value, tag: v ?? '' })}
      />
      <MultiSelectField
        label="Балансируемые выходы"
        hint="В selector уйдут точные теги — префиксы можно дописать потом в форме балансера"
        options={outboundTags.map((t) => ({ value: t, label: t }))}
        value={value.members.length > 0 ? value.members : undefined}
        onChange={(v) => onChange({ ...value, members: v ?? [] })}
      />
      <SelectField
        label="Стратегия"
        hint="leastPing и leastLoad дополнительно заведут секцию наблюдения"
        value={value.strategy}
        options={BALANCE_STRATEGY_OPTIONS}
        onChange={(v) => onChange({ ...value, strategy: v as BalanceParams['strategy'] })}
      />
      <SelectField
        label="Запасной выход"
        value={value.fallbackTag}
        options={fallbackOptions}
        onChange={(v) => onChange({ ...value, fallbackTag: v })}
      />
      <CheckboxField
        label="Перевести правила этих выходов на балансер"
        hint="Правила с outboundTag выбранных выходов получат balancerTag вместо него"
        value={value.repoint ? true : undefined}
        onChange={(v) => onChange({ ...value, repoint: v === true })}
      />
    </>
  )
}
