import { Button, Checkbox, CollapsibleSection } from '../../shared/ui'
import { ssPassword } from '../../entities/xray/generate'
import { StreamForm } from './StreamForm'
import { ListEditor } from './collections'
import { NumberField, PortField, SelectField, TextField, type Option } from './fields'

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
  const fallbacks = settings.fallbacks as Obj[] | undefined

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

  // Fallbacks одинаковы у vless и trojan — общий рендер
  function renderFallbacks() {
    return (
      <ListEditor<Obj>
        label="Fallbacks"
        hint="Не-протокольный трафик уходит сюда (маскировка под сайт); dest — порт, адрес или unix-сокет"
        value={fallbacks}
        onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.fallbacks; else s.fallbacks = v })}
        createItem={() => ({})}
        addLabel="+ Fallback"
        renderItem={(item, update, i) => {
          const total = fallbacks?.length ?? 0
          return (
            <>
              {/* Mount-only буфер PortField: смена числа карточек сдвигает индексы — remount по key */}
              <PortField
                key={`fb-dest:${i}:${total}`}
                label="Куда (dest)"
                value={item.dest as number | string | undefined}
                onChange={(v) => update({ dest: v })}
              />
              <TextField
                label="Путь (path)"
                mono
                placeholder="/web"
                value={item.path as string | undefined}
                onChange={(v) => update({ path: v })}
              />
              <TextField
                label="ALPN (alpn)"
                mono
                placeholder="h2"
                hint="Fallback сработает только при совпадении ALPN хендшейка"
                value={item.alpn as string | undefined}
                onChange={(v) => update({ alpn: v })}
              />
              <TextField
                label="SNI (name)"
                mono
                placeholder="example.com"
                value={item.name as string | undefined}
                onChange={(v) => update({ name: v })}
              />
              <NumberField
                label="PROXY protocol (xver)"
                placeholder="0"
                value={item.xver as number | undefined}
                onChange={(v) => update({ xver: v })}
              />
            </>
          )
        }}
      />
    )
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
          {renderFallbacks()}
          <CollapsibleSection title="Продвинутые (VLESS)">
            <TextField
              label="Decryption"
              mono
              hint="VLESS Encryption: «none» или ключ формата mlkem768x25519plus… (генерирует xray vlessenc)"
              value={settings.decryption as string | undefined}
              onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.decryption; else s.decryption = v })}
            />
          </CollapsibleSection>
        </>
      )}

      {protocol === 'trojan' && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Пользователи добавляются панелью Remnawave автоматически — клиентов настраивать не нужно.
          </p>
          {renderFallbacks()}
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
        onChange={(stream) => patch((n) => { n.streamSettings = stream })}
        flow={settings.flow as string | undefined} />

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
