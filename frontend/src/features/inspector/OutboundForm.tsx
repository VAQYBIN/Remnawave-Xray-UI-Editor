import { useState } from 'react'
import { Button } from '../../shared/ui'
import { NumberField, SelectField, StringListField, TextField, type Option } from './fields'

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

interface Props {
  value: Obj // outbound целиком
  onChange: (next: Obj) => void
}

export function OutboundForm({ value, onChange }: Props) {
  const protocol = (value.protocol as string) ?? 'freedom'
  const settings = (value.settings as Obj) ?? {}
  const peer = ((settings.peers as Obj[]) ?? [])[0] ?? {}
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

  function patchPeer(mut: (p: Obj) => void) {
    patchSettings((s) => {
      const list = ((s.peers as Obj[]) ?? []).map((p) => ({ ...p }))
      if (list.length === 0) list.push({})
      mut(list[0]!)
      s.peers = list
    })
  }

  return (
    <>
      <TextField label="Тег" mono value={value.tag as string | undefined} onChange={(v) => patch((n) => { if (v === undefined) delete n.tag; else n.tag = v })} />
      <SelectField label="Протокол" value={protocol} options={PROTOCOLS} onChange={(v) => patch((n) => { n.protocol = v })} />

      {protocol === 'freedom' && (
        <SelectField
          label="Стратегия доменов"
          value={(settings.domainStrategy as string) ?? ''}
          options={DOMAIN_STRATEGIES}
          onChange={(v) => patchSettings((s) => { if (v === '') delete s.domainStrategy; else s.domainStrategy = v })}
        />
      )}

      {protocol === 'blackhole' && (
        <p className="muted" style={{ margin: 0 }}>Блокирует весь трафик, направленный в этот outbound.</p>
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
          <StringListField key={`address:${warpFillCount}`} label="Адреса интерфейса" placeholder="172.16.0.2/32" value={settings.address as string[] | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.address; else s.address = v })} />
          <TextField label="Публичный ключ пира" mono value={peer.publicKey as string | undefined}
            onChange={(v) => patchPeer((p) => { if (v === undefined) delete p.publicKey; else p.publicKey = v })} />
          <TextField label="Endpoint пира" mono placeholder="engage.cloudflareclient.com:2408" value={peer.endpoint as string | undefined}
            onChange={(v) => patchPeer((p) => { if (v === undefined) delete p.endpoint; else p.endpoint = v })} />
          <StringListField key={`allowedIPs:${warpFillCount}`} label="AllowedIPs пира" placeholder={'0.0.0.0/0\n::/0'} value={peer.allowedIPs as string[] | undefined}
            onChange={(v) => patchPeer((p) => { if (v === undefined) delete p.allowedIPs; else p.allowedIPs = v })} />
          <NumberField label="MTU" placeholder="1280" value={settings.mtu as number | undefined}
            onChange={(v) => patchSettings((s) => { if (v === undefined) delete s.mtu; else s.mtu = v })} />
        </>
      )}

      {(protocol === 'socks' || protocol === 'http' || protocol === 'vless') && (
        <p className="muted" style={{ margin: 0 }}>
          Настройки протокола «{protocol}» редактируются на вкладке JSON узла.
        </p>
      )}
    </>
  )
}
