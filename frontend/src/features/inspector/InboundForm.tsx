import { Button, Checkbox } from '../../shared/ui'
import { ssPassword } from '../../entities/xray/generate'
import { ClientsEditor } from './ClientsEditor'
import { StreamForm } from './StreamForm'
import { PortField, SelectField, TextField, type Option } from './fields'

type Obj = Record<string, unknown>

const PROTOCOLS: Option[] = [
  { value: 'vless', label: 'VLESS' },
  { value: 'trojan', label: 'Trojan' },
  { value: 'shadowsocks', label: 'Shadowsocks' },
]

const SS_METHODS: Option[] = [
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
].map((v) => ({ value: v, label: v }))

// Flow применяется панелью Remnawave ко всем пользователям inbound'а (settings.flow)
const FLOWS: Option[] = [
  { value: '', label: 'нет' },
  { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
]

// settings протоколо-специфичны: при смене протокола заменяются чистым шаблоном,
// иначе в JSON остаются висеть поля прежнего протокола (например method от Shadowsocks)
const SETTINGS_TEMPLATES: Record<string, Obj> = {
  vless: { clients: [], decryption: 'none' },
  trojan: { clients: [] },
  shadowsocks: {},
}

interface Props {
  value: Obj // inbound целиком
  onChange: (next: Obj) => void
}

export function InboundForm({ value, onChange }: Props) {
  const protocol = (value.protocol as string) ?? 'vless'
  const settings = (value.settings as Obj) ?? {}
  const sniffing = (value.sniffing as Obj) ?? {}

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  function patchSettings(mut: (s: Obj) => void) {
    patch((next) => {
      const s = (next.settings as Obj) ?? {}
      mut(s)
      next.settings = s
    })
  }

  return (
    <>
      <TextField label="Тег" mono value={value.tag as string | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.tag; else n.tag = v })} />
      <PortField label="Порт" value={value.port as number | string | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.port; else n.port = v })} />
      <TextField label="Listen (адрес)" mono placeholder="0.0.0.0" value={value.listen as string | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.listen; else n.listen = v })} />
      <SelectField label="Протокол" value={protocol} options={PROTOCOLS}
        onChange={(v) =>
          patch((n) => {
            if (n.protocol === v) return
            n.protocol = v
            n.settings = structuredClone(SETTINGS_TEMPLATES[v] ?? {})
          })
        }
      />

      {protocol === 'vless' && (
        <>
          <SelectField label="Flow" value={(settings.flow as string) ?? ''} options={FLOWS}
            onChange={(v) => patchSettings((s) => { if (v === '') delete s.flow; else s.flow = v })} />
          <p className="muted" style={{ margin: 0 }}>
            Пользователи добавляются панелью Remnawave автоматически; flow применяется ко всем пользователям
            этого inbound'а.
          </p>
        </>
      )}

      {protocol === 'trojan' && (
        <>
          <ClientsEditor
            protocol={protocol}
            clients={(settings.clients as Obj[]) ?? []}
            onChange={(clients) => patchSettings((s) => { s.clients = clients })}
          />
          <p className="muted" style={{ margin: 0 }}>
            Пользователи панели Remnawave добавляются в inbound автоматически — здесь только статические клиенты.
          </p>
        </>
      )}

      {protocol === 'shadowsocks' && (
        <>
          <SelectField label="Метод шифрования" value={(settings.method as string) ?? '2022-blake3-aes-128-gcm'}
            options={SS_METHODS}
            onChange={(v) => patchSettings((s) => { s.method = v })} />
          <TextField label="Пароль" mono value={settings.password as string | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.password; else s.password = v })} />
          <Button variant="ghost"
            onClick={() => patchSettings((s) => { s.password = ssPassword((s.method as string) ?? '2022-blake3-aes-128-gcm') })}>
            Сгенерировать пароль
          </Button>
        </>
      )}

      <StreamForm value={(value.streamSettings as Obj) ?? {}}
        onChange={(stream) => patch((n) => { n.streamSettings = stream })} />

      <Checkbox label="Sniffing включён" checked={Boolean(sniffing.enabled)}
        onChange={(checked) =>
          patch((n) => {
            n.sniffing = { ...((n.sniffing as Obj) ?? { destOverride: ['http', 'tls', 'quic'] }), enabled: checked }
          })
        }
      />
    </>
  )
}
