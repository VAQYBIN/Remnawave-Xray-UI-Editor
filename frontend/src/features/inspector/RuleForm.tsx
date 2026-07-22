import { CollapsibleSection } from '../../shared/ui'
import { MultiSelectField, SelectField, StringListField, type Option } from './fields'

type Obj = Record<string, unknown>

const NETWORKS: Option[] = [
  { value: '', label: 'любая' },
  { value: 'tcp', label: 'tcp' },
  { value: 'udp', label: 'udp' },
  { value: 'tcp,udp', label: 'tcp,udp' },
]

// Протоколы, которые определяет sniffing на inbound
const SNIFF_PROTOCOLS: Option[] = ['http', 'tls', 'quic', 'bittorrent'].map((v) => ({ value: v, label: v }))

interface Props {
  value: Obj // правило целиком
  onChange: (next: Obj) => void
  inboundTags: string[]
  outboundTags: string[]
}

// Опции тегов: теги конфига + значения из самого правила — битая ссылка должна
// быть видима и снимаема из формы, а не пропадать молча
function tagOptions(configTags: string[], selected: string[]): Option[] {
  const all = [...configTags]
  for (const t of selected) if (!all.includes(t)) all.push(t)
  return all.map((v) => ({ value: v, label: v }))
}

export function RuleForm({ value, onChange, inboundTags, outboundTags }: Props) {
  const selectedInbounds = (value.inboundTag as string[] | undefined) ?? []
  const outboundTag = (value.outboundTag as string) ?? ''

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        Правила проверяются сверху вниз — срабатывает первое совпавшее.
      </p>
      <SelectField
        label="Outbound (куда отправить)"
        value={outboundTag}
        options={[
          { value: '', label: '— не задан —' },
          ...tagOptions(outboundTags, outboundTag === '' ? [] : [outboundTag]),
        ]}
        onChange={(v) => patch((n) => { if (v === '') delete n.outboundTag; else n.outboundTag = v })}
      />
      <MultiSelectField
        label="Inbound (откуда трафик)"
        hint="Пусто — правило действует на трафик всех inbound"
        options={tagOptions(inboundTags, selectedInbounds)}
        value={value.inboundTag as string[] | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.inboundTag; else n.inboundTag = v })}
      />
      <SelectField
        label="Сеть (network)"
        value={(value.network as string) ?? ''}
        options={NETWORKS}
        onChange={(v) => patch((n) => { if (v === '') delete n.network; else n.network = v })}
      />
      <MultiSelectField
        label="Протокол трафика"
        hint="Работает только при включённом sniffing на inbound"
        options={SNIFF_PROTOCOLS}
        value={value.protocol as string[] | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.protocol; else n.protocol = v })}
      />
      <CollapsibleSection title="Продвинутые">
        <StringListField
          label="Пользователи (user)"
          hint="Email пользователей уровня Xray — панель Remnawave генерирует их сама"
          placeholder="user@example.com"
          value={value.user as string[] | undefined}
          onChange={(v) => patch((n) => { if (v === undefined) delete n.user; else n.user = v })}
        />
        <StringListField
          label="IP источника (source)"
          hint="IP или CIDR клиента"
          placeholder={'192.168.0.0/24\n10.0.0.1'}
          value={value.source as string[] | undefined}
          onChange={(v) => patch((n) => { if (v === undefined) delete n.source; else n.source = v })}
        />
      </CollapsibleSection>
    </>
  )
}
