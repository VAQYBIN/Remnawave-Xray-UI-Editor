import type { TorrentParams } from '../../../entities/xray'
import { MultiSelectField, TextField } from '../../inspector/fields'

export function TorrentForm({
  value,
  inboundTags,
  onChange,
}: {
  value: TorrentParams
  inboundTags: string[]
  onChange: (v: TorrentParams) => void
}) {
  return (
    <>
      <TextField
        label="Тег блокирующего outbound’а"
        hint="Если outbound с таким тегом уже есть, рецепт возьмёт его и не станет менять настройки"
        value={value.blockTag}
        onChange={(v) => onChange({ ...value, blockTag: v ?? '' })}
      />
      <MultiSelectField
        label="Включить sniffing у inbound’ов"
        hint="Пусто — все inbound’ы конфига. Без sniffing правило по bittorrent не сработает"
        options={inboundTags.map((t) => ({ value: t, label: t }))}
        value={value.inboundTags.length > 0 ? value.inboundTags : undefined}
        onChange={(v) => onChange({ ...value, inboundTags: v ?? [] })}
      />
    </>
  )
}
