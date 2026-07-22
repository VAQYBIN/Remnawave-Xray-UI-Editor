import { useState } from 'react'
import { Button, CollapsibleSection } from '../../shared/ui'
import { CheckboxField, NumberField, SelectField, StringListField, TextField, type Option } from './fields'
import { StreamForm } from './StreamForm'
import { ListEditor } from './collections'

type Obj = Record<string, unknown>

const PROTOCOLS: Option[] = [
  { value: 'freedom', label: 'freedom — прямой выход' },
  { value: 'blackhole', label: 'blackhole — блокировка' },
  { value: 'wireguard', label: 'wireguard — WARP и другие' },
  { value: 'socks', label: 'socks — внешний прокси' },
  { value: 'http', label: 'http — внешний прокси' },
  { value: 'vless', label: 'vless — цепочка серверов' },
]

const DOMAIN_STRATEGIES: Option[] = [
  { value: '', label: 'AsIs (по умолчанию)' },
  { value: 'UseIP', label: 'UseIP' },
  { value: 'UseIPv4', label: 'UseIPv4' },
  { value: 'UseIPv6', label: 'UseIPv6' },
]

const OUTBOUND_FLOWS: Option[] = [
  { value: '', label: 'нет' },
  { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
]

const WG_DOMAIN_STRATEGIES: Option[] = [
  { value: '', label: 'не задана (ForceIP)' },
  { value: 'ForceIP', label: 'ForceIP' },
  { value: 'ForceIPv4', label: 'ForceIPv4' },
  { value: 'ForceIPv6', label: 'ForceIPv6' },
  { value: 'ForceIPv6v4', label: 'ForceIPv6v4' },
]

const BLACKHOLE_RESPONSES: Option[] = [
  { value: '', label: 'не задан (none — молча разорвать)' },
  { value: 'none', label: 'none — молча разорвать' },
  { value: 'http', label: 'http — пустой HTTP-ответ (мягкий отказ)' },
]

const XUDP_MODES: Option[] = [
  { value: '', label: 'reject (по умолчанию)' },
  { value: 'reject', label: 'reject — отклонять UDP/443' },
  { value: 'allow', label: 'allow — пропускать через mux' },
  { value: 'skip', label: 'skip — мимо mux' },
]

// Протоколы, для которых mux имеет смысл (мультиплексируемый прокси-транспорт)
const MUX_PROTOCOLS = ['vless', 'socks', 'http']

// Публичный ключ WARP-пира Cloudflare и endpoint одинаковы для всех аккаунтов;
// secretKey и address выдаются при регистрации устройства (wgcf / приложение WARP)
export const WARP_TEMPLATE: Obj = {
  secretKey: 'ВСТАВЬТЕ_ПРИВАТНЫЙ_КЛЮЧ_WARP',
  address: ['172.16.0.2/32'],
  mtu: 1280,
  peers: [
    {
      publicKey: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
      endpoint: 'engage.cloudflareclient.com:2408',
      allowedIPs: ['0.0.0.0/0', '::/0'],
    },
  ],
}

// Правка первого пользователя карточки (vnext/servers): единственный опустевший
// пользователь удаляется целиком — UUID может инжектить панель Remnawave
function patchFirstUser(item: Obj, update: (patch: Partial<Obj>) => void, mut: (u: Obj) => void) {
  const users = ((item.users as Obj[]) ?? []).map((u) => ({ ...u }))
  if (users.length === 0) users.push({})
  mut(users[0]!)
  if (users.length === 1 && Object.keys(users[0]!).length === 0) update({ users: undefined })
  else update({ users })
}

interface Props {
  value: Obj // outbound целиком
  onChange: (next: Obj) => void
  /** Теги всех outbound конфига — для select'а sockopt.dialerProxy; свой тег исключается */
  outboundTags?: string[]
}

export function OutboundForm({ value, onChange, outboundTags }: Props) {
  const protocol = (value.protocol as string) ?? 'freedom'
  const settings = (value.settings as Obj) ?? {}
  const vnext = settings.vnext as Obj[] | undefined
  const servers = settings.servers as Obj[] | undefined
  const peers = settings.peers as Obj[] | undefined
  const fragment = (settings.fragment as Obj) ?? {}
  const mux = (value.mux as Obj) ?? {}
  // StringListField хранит текст в локальном state и читает value только при монтировании,
  // поэтому массовая замена settings кнопкой WARP не обновит поле само по себе — нужен remount по key
  const [warpFillCount, setWarpFillCount] = useState(0)

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

  // Правка settings.fragment; опустевшая секция удаляется целиком
  function patchFragment(mut: (f: Obj) => void) {
    patchSettings((s) => {
      const f = (s.fragment as Obj) ?? {}
      mut(f)
      if (Object.keys(f).length === 0) delete s.fragment
      else s.fragment = f
    })
  }

  // Правка top-level секции outbound (mux); опустевшая секция удаляется целиком
  function patchTop(key: string, mut: (s: Obj) => void) {
    patch((next) => {
      const s = (next[key] as Obj) ?? {}
      mut(s)
      if (Object.keys(s).length === 0) delete next[key]
      else next[key] = s
    })
  }

  return (
    <>
      <TextField label="Тег" mono value={value.tag as string | undefined} onChange={(v) => patch((n) => { if (v === undefined) delete n.tag; else n.tag = v })} />
      <SelectField label="Протокол" value={protocol} options={PROTOCOLS}
        onChange={(v) =>
          patch((n) => {
            if (n.protocol === v) return
            n.protocol = v
            // settings протоколо-специфичны — при смене протокола начинаем с чистого листа
            n.settings = {}
          })
        } />

      {protocol === 'freedom' && (
        <>
          <SelectField
            label="Стратегия доменов"
            value={(settings.domainStrategy as string) ?? ''}
            options={DOMAIN_STRATEGIES}
            onChange={(v) => patchSettings((s) => { if (v === '') delete s.domainStrategy; else s.domainStrategy = v })}
          />
          <TextField
            label="Redirect"
            mono
            placeholder="127.0.0.1:3366"
            hint="Весь трафик принудительно уходит на этот адрес (адрес:порт)"
            value={settings.redirect as string | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.redirect; else s.redirect = v })}
          />
          <CollapsibleSection title="Fragment (анти-DPI)">
            <Button
              variant="ghost"
              onClick={() =>
                patchSettings((s) => { s.fragment = { packets: 'tlshello', length: '100-200', interval: '10-20' } })
              }
            >
              Пресет tlshello
            </Button>
            <p className="muted" style={{ margin: 0 }}>
              Фрагментация ClientHello ломает DPI-детект; работает только для исходящего TLS.
            </p>
            <TextField label="Пакеты (packets)" mono placeholder="tlshello"
              value={fragment.packets as string | undefined}
              onChange={(v) => patchFragment((f) => { if (v === undefined) delete f.packets; else f.packets = v })} />
            <TextField label="Длина (length)" mono placeholder="100-200"
              value={fragment.length as string | undefined}
              onChange={(v) => patchFragment((f) => { if (v === undefined) delete f.length; else f.length = v })} />
            <TextField label="Интервал (interval)" mono placeholder="10-20"
              value={fragment.interval as string | undefined}
              onChange={(v) => patchFragment((f) => { if (v === undefined) delete f.interval; else f.interval = v })} />
          </CollapsibleSection>
        </>
      )}

      {protocol === 'blackhole' && (
        <>
          <p className="muted" style={{ margin: 0 }}>Блокирует весь трафик, направленный в этот outbound.</p>
          <SelectField
            label="Ответ (response.type)"
            value={((settings.response as Obj | undefined)?.type as string) ?? ''}
            options={BLACKHOLE_RESPONSES}
            onChange={(v) =>
              patchSettings((s) => {
                if (v === '') delete s.response
                else s.response = { ...((s.response as Obj) ?? {}), type: v }
              })
            }
          />
        </>
      )}

      {protocol === 'wireguard' && (
        <>
          <Button onClick={() => {
            patch((n) => { n.settings = structuredClone(WARP_TEMPLATE) })
            setWarpFillCount((c) => c + 1)
          }}>
            Заполнить шаблон WARP
          </Button>
          <p className="muted" style={{ margin: 0 }}>
            secretKey и address выдаёт Cloudflare при регистрации устройства (утилита wgcf).
          </p>
          <TextField label="Приватный ключ (secretKey)" mono value={settings.secretKey as string | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.secretKey; else s.secretKey = v })} />
          <StringListField key={`address:${warpFillCount}`} label="Адреса интерфейса" placeholder="172.16.0.2/32"
            value={settings.address as string[] | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.address; else s.address = v })} />
          <ListEditor<Obj>
            label="Пиры (peers)"
            value={peers}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.peers; else s.peers = v })}
            createItem={() => ({})}
            addLabel="+ Пир"
            renderItem={(item, update, i) => {
              const total = peers?.length ?? 0
              return (
                <>
                  <TextField label="Публичный ключ пира" mono value={item.publicKey as string | undefined}
                    onChange={(v) => update({ publicKey: v })} />
                  <TextField label="Endpoint пира" mono placeholder="engage.cloudflareclient.com:2408"
                    value={item.endpoint as string | undefined}
                    onChange={(v) => update({ endpoint: v })} />
                  {/* Mount-only буфер: remount при смене числа карточек и заливке WARP-шаблона */}
                  <StringListField key={`allowedIPs:${warpFillCount}:${i}:${total}`} label="AllowedIPs пира"
                    placeholder={'0.0.0.0/0\n::/0'}
                    value={item.allowedIPs as string[] | undefined}
                    onChange={(v) => update({ allowedIPs: v })} />
                  <TextField label="preSharedKey" mono value={item.preSharedKey as string | undefined}
                    onChange={(v) => update({ preSharedKey: v })} />
                  <NumberField label="keepAlive (сек)" placeholder="25" value={item.keepAlive as number | undefined}
                    onChange={(v) => update({ keepAlive: v })} />
                </>
              )
            }}
          />
          <NumberField label="MTU" placeholder="1280" value={settings.mtu as number | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.mtu; else s.mtu = v })} />
          <StringListField key={`reserved:${warpFillCount}`} label="Reserved (по числу на строку)"
            hint="3 байта client id WARP; нечисловые строки игнорируются" placeholder={'51\n77\n99'}
            value={(settings.reserved as number[] | undefined)?.map(String)}
            onChange={(v) =>
              patchSettings((s) => {
                const nums = (v ?? []).map(Number).filter((n) => Number.isInteger(n))
                if (nums.length === 0) delete s.reserved
                else s.reserved = nums
              })
            } />
          <SelectField label="Стратегия доменов" value={(settings.domainStrategy as string) ?? ''}
            options={WG_DOMAIN_STRATEGIES}
            onChange={(v) => patchSettings((s) => { if (v === '') delete s.domainStrategy; else s.domainStrategy = v })} />
        </>
      )}

      {(protocol === 'socks' || protocol === 'http') && (
        <ListEditor<Obj>
          label="Серверы"
          hint="Внешний прокси-сервер, на который уходит трафик"
          value={servers}
          onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.servers; else s.servers = v })}
          createItem={() => ({})}
          addLabel="+ Сервер"
          renderItem={(item, update) => {
            const user = ((item.users as Obj[]) ?? [])[0] ?? {}
            return (
              <>
                <TextField label="Адрес" mono placeholder="10.0.0.1"
                  value={item.address as string | undefined}
                  onChange={(v) => update({ address: v })} />
                <NumberField label="Порт" placeholder={protocol === 'socks' ? '1080' : '3128'}
                  value={item.port as number | undefined}
                  onChange={(v) => update({ port: v })} />
                <TextField label="Логин (users[0].user)" mono hint="Пусто — прокси без авторизации"
                  value={user.user as string | undefined}
                  onChange={(v) => patchFirstUser(item, update, (u) => { if (v === undefined) delete u.user; else u.user = v })} />
                <TextField label="Пароль (users[0].pass)" mono
                  value={user.pass as string | undefined}
                  onChange={(v) => patchFirstUser(item, update, (u) => { if (v === undefined) delete u.pass; else u.pass = v })} />
              </>
            )
          }}
        />
      )}

      {protocol === 'vless' && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Цепочка нод: трафик уходит на следующий VLESS-сервер. UUID может инжектить панель — тогда
            оставьте поле пустым.
          </p>
          <ListEditor<Obj>
            label="Серверы (vnext)"
            value={vnext}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.vnext; else s.vnext = v })}
            createItem={() => ({ users: [{ encryption: 'none' }] })}
            addLabel="+ Сервер"
            renderItem={(item, update) => {
              const user = ((item.users as Obj[]) ?? [])[0] ?? {}
              return (
                <>
                  <TextField label="Адрес" mono placeholder="node2.example.com"
                    value={item.address as string | undefined}
                    onChange={(v) => update({ address: v })} />
                  <NumberField label="Порт" placeholder="443"
                    value={item.port as number | undefined}
                    onChange={(v) => update({ port: v })} />
                  <TextField label="UUID (users[0].id)" mono hint="Пусто — пользователя инжектит панель"
                    value={user.id as string | undefined}
                    onChange={(v) => patchFirstUser(item, update, (u) => { if (v === undefined) delete u.id; else u.id = v })} />
                  <SelectField label="Flow" value={(user.flow as string) ?? ''} options={OUTBOUND_FLOWS}
                    onChange={(v) => patchFirstUser(item, update, (u) => { if (v === '') delete u.flow; else u.flow = v })} />
                  <TextField label="Encryption" mono placeholder="none" hint="Для классического VLESS — «none»"
                    value={user.encryption as string | undefined}
                    onChange={(v) =>
                      patchFirstUser(item, update, (u) => { if (v === undefined) delete u.encryption; else u.encryption = v })
                    } />
                </>
              )
            }}
          />
        </>
      )}

      {protocol !== 'wireguard' && protocol !== 'blackhole' && (
        // wireguard не поддерживает streamSettings, для blackhole транспорт бессмыслен
        <StreamForm
          mode="outbound"
          value={(value.streamSettings as Obj) ?? {}}
          onChange={(stream) => patch((n) => { n.streamSettings = stream })}
          outboundTags={(outboundTags ?? []).filter((t) => t !== (value.tag as string | undefined))}
        />
      )}

      <CollapsibleSection title="Продвинутые (outbound)">
        <TextField
          label="Исходящий адрес (sendThrough)"
          mono
          placeholder="0.0.0.0"
          hint="IP интерфейса для исходящих соединений (мульти-IP серверы)"
          value={value.sendThrough as string | undefined}
          onChange={(v) => patch((n) => { if (v === undefined) delete n.sendThrough; else n.sendThrough = v })}
        />
        {MUX_PROTOCOLS.includes(protocol) && (
          <>
            <CheckboxField
              label="Mux включён"
              hint="Мультиплексирование потоков; несовместим с flow xtls-rprx-vision"
              value={mux.enabled as boolean | undefined}
              onChange={(v) => patchTop('mux', (m) => { if (v === undefined) delete m.enabled; else m.enabled = v })}
            />
            <NumberField label="Concurrency" placeholder="8" value={mux.concurrency as number | undefined}
              onChange={(v) => patchTop('mux', (m) => { if (v === undefined) delete m.concurrency; else m.concurrency = v })} />
            <NumberField label="xudpConcurrency" placeholder="16" value={mux.xudpConcurrency as number | undefined}
              onChange={(v) =>
                patchTop('mux', (m) => { if (v === undefined) delete m.xudpConcurrency; else m.xudpConcurrency = v })
              } />
            <SelectField label="UDP/443 (xudpProxyUDP443)" value={(mux.xudpProxyUDP443 as string) ?? ''} options={XUDP_MODES}
              onChange={(v) =>
                patchTop('mux', (m) => { if (v === '') delete m.xudpProxyUDP443; else m.xudpProxyUDP443 = v })
              } />
          </>
        )}
      </CollapsibleSection>
    </>
  )
}
