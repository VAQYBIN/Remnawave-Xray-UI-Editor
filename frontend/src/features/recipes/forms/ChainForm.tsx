import { CHAIN_PROTOCOLS, type ChainParams } from '../../../entities/xray'
import {
  CheckboxField,
  NumberField,
  SelectField,
  StringListField,
  TextField,
} from '../../inspector/fields'

export function ChainForm({
  value,
  outboundTags,
  onChange,
}: {
  value: ChainParams
  outboundTags: string[]
  onChange: (v: ChainParams) => void
}) {
  return (
    <>
      <TextField
        label="Тег outbound’а"
        value={value.tag}
        onChange={(v) => onChange({ ...value, tag: v ?? '' })}
      />
      <SelectField
        label="Протокол"
        value={value.protocol}
        options={CHAIN_PROTOCOLS}
        onChange={(v) => onChange({ ...value, protocol: v as ChainParams['protocol'] })}
      />
      <TextField
        label="Адрес сервера"
        value={value.address}
        onChange={(v) => onChange({ ...value, address: v ?? '' })}
      />
      <NumberField label="Порт" value={value.port} onChange={(v) => onChange({ ...value, port: v ?? 443 })} />
      {value.protocol === 'vless' && (
        <TextField
          label="UUID пользователя"
          mono
          value={value.uuid}
          onChange={(v) => onChange({ ...value, uuid: v ?? '' })}
        />
      )}
      {value.protocol === 'socks' && (
        <TextField
          label="Имя пользователя"
          value={value.username}
          onChange={(v) => onChange({ ...value, username: v ?? '' })}
        />
      )}
      {value.protocol !== 'vless' && (
        <TextField
          label="Пароль"
          value={value.password}
          onChange={(v) => onChange({ ...value, password: v ?? '' })}
        />
      )}
      <CheckboxField
        label="TLS"
        hint="serverName подставится по адресу сервера"
        value={value.tls}
        onChange={(v) => onChange({ ...value, tls: v === true })}
      />
      <SelectField
        label="Подключаться через outbound"
        hint="dialerProxy: соединение до этого сервера пойдёт через выбранный выход — второй хоп"
        value={value.dialerProxy}
        options={[
          { value: '', label: 'напрямую' },
          ...outboundTags.filter((t) => t !== value.tag).map((t) => ({ value: t, label: t })),
        ]}
        onChange={(v) => onChange({ ...value, dialerProxy: v })}
      />
      <StringListField
        label="Домены и категории"
        hint="Пусто — весь трафик пойдёт в цепочку"
        placeholder={'geosite:netflix\nexample.com'}
        value={value.domains.length > 0 ? value.domains : undefined}
        onChange={(v) => onChange({ ...value, domains: v ?? [] })}
      />
    </>
  )
}
