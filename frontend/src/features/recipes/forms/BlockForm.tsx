import type { BlockParams } from '../../../entities/xray'
import { TextField } from '../../inspector/fields'

export function BlockForm({
  value,
  onChange,
}: {
  value: BlockParams
  onChange: (v: BlockParams) => void
}) {
  return (
    <TextField
      label="Тег блокирующего outbound’а"
      hint="Если outbound с таким тегом уже есть, рецепт возьмёт его и не станет менять настройки"
      value={value.blockTag}
      onChange={(v) => onChange({ ...value, blockTag: v ?? '' })}
    />
  )
}
