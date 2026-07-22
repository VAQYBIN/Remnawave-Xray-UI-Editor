import { keywordEntries, portSpecError } from '../../entities/xray'
import { CollapsibleSection } from '../../shared/ui'
import { MultiSelectField, PortField, SelectField, StringListField, type Option } from './fields'

type Obj = Record<string, unknown>

const NETWORKS: Option[] = [
  { value: '', label: 'любая' },
  { value: 'tcp', label: 'tcp' },
  { value: 'udp', label: 'udp' },
  { value: 'tcp,udp', label: 'tcp,udp' },
]

// Протоколы, которые определяет sniffing на inbound
const SNIFF_PROTOCOLS: Option[] = ['http', 'tls', 'quic', 'bittorrent'].map((v) => ({ value: v, label: v }))

// Чистая логика (DOMAIN_PREFIXES/keywordEntries/portSpecError) переехала в
// entities/xray/rules.ts — её переиспользует analyzeIntegrity (Task 2 плана 4).
// Реэкспорт сохраняет прежние импорты потребителей (тесты плана 2).
export { DOMAIN_PREFIXES, keywordEntries, portSpecError } from '../../entities/xray'

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
  const domainKeywords = keywordEntries(value.domain as string[] | undefined)
  const portError = portSpecError(value.port as string | number | undefined)
  const sourcePortError = portSpecError(value.sourcePort as string | number | undefined)

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
      <StringListField
        label="Домены"
        hint="Префиксы: geosite: (категория), domain: (домен и поддомены), full: (точное совпадение), regexp: (рег. выражение)"
        placeholder={'geosite:category-ads-all\ndomain:example.com'}
        value={value.domain as string[] | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.domain; else n.domain = v })}
      />
      {domainKeywords.length > 0 && (
        <span className="field-warning">
          Без префикса — keyword-матчинг по подстроке: {domainKeywords.join(', ')}
        </span>
      )}
      <StringListField
        label="IP назначения"
        hint="IP, CIDR (10.0.0.0/8) или geoip:ru, geoip:private"
        placeholder={'geoip:private\n10.0.0.0/8'}
        value={value.ip as string[] | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.ip; else n.ip = v })}
      />
      <PortField
        label="Порт назначения"
        value={value.port as number | string | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.port; else n.port = v })}
      />
      {portError && <span className="field-error">{portError}</span>}
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
        <PortField
          label="Порт источника (sourcePort)"
          value={value.sourcePort as number | string | undefined}
          onChange={(v) => patch((n) => { if (v === undefined) delete n.sourcePort; else n.sourcePort = v })}
        />
        {sourcePortError && <span className="field-error">{sourcePortError}</span>}
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
