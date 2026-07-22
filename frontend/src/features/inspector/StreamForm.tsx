import { Button, CollapsibleSection } from '../../shared/ui'
import { randomShortId } from '../../entities/xray/generate'
import { useRealityKeypair, useRealityPublicKey } from '../../shared/api'
import { KeyValueField } from './collections'
import {
  CheckboxField,
  NumberField,
  SelectField,
  StringListField,
  TagListField,
  TextField,
  type Option,
} from './fields'

type Obj = Record<string, unknown>

const NETWORKS: Option[] = [
  { value: 'tcp', label: 'TCP (raw)' },
  { value: 'ws', label: 'WebSocket' },
  { value: 'grpc', label: 'gRPC' },
  { value: 'httpupgrade', label: 'HTTPUpgrade' },
  { value: 'xhttp', label: 'XHTTP' },
]

const SECURITIES: Option[] = [
  { value: 'none', label: 'Без шифрования' },
  { value: 'tls', label: 'TLS' },
  { value: 'reality', label: 'Reality' },
]

const FINGERPRINTS: Option[] = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random', 'randomized'].map(
  (v) => ({ value: v, label: v }),
)

const XHTTP_MODES: Option[] = [
  { value: '', label: 'auto (по умолчанию)' },
  { value: 'packet-up', label: 'packet-up' },
  { value: 'stream-up', label: 'stream-up' },
  { value: 'stream-one', label: 'stream-one' },
]

export type StreamFormMode = 'inbound' | 'outbound'

interface Props {
  value: Obj // streamSettings целиком
  onChange: (next: Obj) => void
  /** inbound — серверные поля (дефолт, сохраняет прежнее поведение), outbound — клиентские */
  mode?: StreamFormMode
}

export function StreamForm({ value, onChange, mode = 'inbound' }: Props) {
  const keypair = useRealityKeypair()
  const derive = useRealityPublicKey()
  const network = (value.network as string) ?? 'tcp'
  const security = (value.security as string) ?? 'none'
  const reality = (value.realitySettings as Obj) ?? {}
  const tls = (value.tlsSettings as Obj) ?? {}
  const ws = (value.wsSettings as Obj) ?? {}
  const grpc = (value.grpcSettings as Obj) ?? {}
  const upgrade = (value.httpupgradeSettings as Obj) ?? {}
  const xhttp = (value.xhttpSettings as Obj) ?? {}
  // Xray понимает и tcpSettings, и rawSettings (network tcp→raw) — редактируем тот ключ, что уже есть
  const tcpKey = 'rawSettings' in value ? 'rawSettings' : 'tcpSettings'
  const tcp = (value[tcpKey] as Obj) ?? {}

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  // Правка вложенной секции (wsSettings, tcpSettings, sockopt, ...);
  // опустевшая секция удаляется целиком — не оставляем в JSON висящие "{}"
  function patchSection(key: string, mut: (s: Obj) => void) {
    patch((next) => {
      const s = (next[key] as Obj) ?? {}
      mut(s)
      if (Object.keys(s).length === 0) delete next[key]
      else next[key] = s
    })
  }

  function patchReality(mut: (r: Obj) => void) {
    patch((next) => {
      const r = (next.realitySettings as Obj) ?? {}
      mut(r)
      next.realitySettings = r
    })
  }

  // Xray ≥24.09 понимает и dest, и target — редактируем тот ключ, что уже есть
  const destKey = 'target' in reality ? 'target' : 'dest'
  const shownPublicKey = derive.data?.publicKey ?? keypair.data?.publicKey

  return (
    <>
      <SelectField label="Транспорт" value={network} options={NETWORKS} onChange={(v) => patch((n) => { n.network = v })} />
      <SelectField
        label="Шифрование"
        value={security}
        options={SECURITIES}
        onChange={(v) =>
          patch((n) => {
            n.security = v
            if (v === 'reality' && n.realitySettings === undefined) n.realitySettings = {}
            if (v === 'tls' && n.tlsSettings === undefined) n.tlsSettings = {}
          })
        }
      />

      {network === 'ws' && (
        <>
          <TextField
            label="Путь WebSocket"
            mono
            placeholder="/ws"
            value={ws.path as string | undefined}
            onChange={(v) => patchSection('wsSettings', (s) => { if (v === undefined) delete s.path; else s.path = v })}
          />
          <TextField
            label="Host"
            mono
            hint="Заголовок Host; за CDN — домен фронта"
            value={ws.host as string | undefined}
            onChange={(v) => patchSection('wsSettings', (s) => { if (v === undefined) delete s.host; else s.host = v })}
          />
          <NumberField
            label="Heartbeat (сек)"
            placeholder="0"
            value={ws.heartbeatPeriod as number | undefined}
            onChange={(v) =>
              patchSection('wsSettings', (s) => { if (v === undefined) delete s.heartbeatPeriod; else s.heartbeatPeriod = v })
            }
          />
          <KeyValueField
            label="Заголовки (headers)"
            hint="Дополнительные HTTP-заголовки; отправляет клиент"
            value={ws.headers as Record<string, string> | undefined}
            onChange={(v) => patchSection('wsSettings', (s) => { if (v === undefined) delete s.headers; else s.headers = v })}
          />
        </>
      )}

      {network === 'grpc' && (
        <>
          <TextField
            label="Имя gRPC-сервиса"
            mono
            value={grpc.serviceName as string | undefined}
            onChange={(v) =>
              patchSection('grpcSettings', (s) => { if (v === undefined) delete s.serviceName; else s.serviceName = v })
            }
          />
          <TextField
            label="Authority"
            mono
            hint="Псевдозаголовок :authority — обычно домен за CDN"
            value={grpc.authority as string | undefined}
            onChange={(v) =>
              patchSection('grpcSettings', (s) => { if (v === undefined) delete s.authority; else s.authority = v })
            }
          />
          <CheckboxField
            label="multiMode"
            hint="Несколько потоков данных в одном gRPC-соединении (экспериментально)"
            value={grpc.multiMode as boolean | undefined}
            onChange={(v) =>
              patchSection('grpcSettings', (s) => { if (v === undefined) delete s.multiMode; else s.multiMode = v })
            }
          />
        </>
      )}

      {network === 'httpupgrade' && (
        <>
          <TextField
            label="Путь HTTPUpgrade"
            mono
            placeholder="/upgrade"
            value={upgrade.path as string | undefined}
            onChange={(v) =>
              patchSection('httpupgradeSettings', (s) => { if (v === undefined) delete s.path; else s.path = v })
            }
          />
          <TextField
            label="Host"
            mono
            hint="Заголовок Host; за CDN — домен фронта"
            value={upgrade.host as string | undefined}
            onChange={(v) =>
              patchSection('httpupgradeSettings', (s) => { if (v === undefined) delete s.host; else s.host = v })
            }
          />
          <KeyValueField
            label="Заголовки (headers)"
            hint="Дополнительные HTTP-заголовки; отправляет клиент"
            value={upgrade.headers as Record<string, string> | undefined}
            onChange={(v) =>
              patchSection('httpupgradeSettings', (s) => { if (v === undefined) delete s.headers; else s.headers = v })
            }
          />
        </>
      )}

      {network === 'xhttp' && (
        <>
          <TextField
            label="Путь XHTTP"
            mono
            placeholder="/api/data"
            value={xhttp.path as string | undefined}
            onChange={(v) => patchSection('xhttpSettings', (s) => { if (v === undefined) delete s.path; else s.path = v })}
          />
          <TextField
            label="Host"
            mono
            hint="Домен CDN-фронта"
            value={xhttp.host as string | undefined}
            onChange={(v) => patchSection('xhttpSettings', (s) => { if (v === undefined) delete s.host; else s.host = v })}
          />
          <SelectField
            label="Режим (mode)"
            value={(xhttp.mode as string) ?? ''}
            options={XHTTP_MODES}
            onChange={(v) => patchSection('xhttpSettings', (s) => { if (v === '') delete s.mode; else s.mode = v })}
          />
          <p className="muted" style={{ margin: 0 }}>
            Поле extra (xmux, padding) редактируется на вкладке «JSON узла» — спека XHTTP нестабильна.
          </p>
        </>
      )}

      {(network === 'tcp' || network === 'raw') && mode === 'inbound' && (
        <CollapsibleSection title="Продвинутые (транспорт)">
          <CheckboxField
            label="Принимать PROXY protocol"
            hint="acceptProxyProtocol — реальный IP клиента от реверс-прокси перед Xray"
            value={tcp.acceptProxyProtocol as boolean | undefined}
            onChange={(v) =>
              patchSection(tcpKey, (s) => { if (v === undefined) delete s.acceptProxyProtocol; else s.acceptProxyProtocol = v })
            }
          />
        </CollapsibleSection>
      )}

      {security === 'tls' && (
        <>
          <TextField
            label="Имя сервера (SNI)"
            mono
            value={tls.serverName as string | undefined}
            onChange={(v) => patch((n) => { n.tlsSettings = { ...((n.tlsSettings as Obj) ?? {}), serverName: v } })}
          />
          <p className="muted" style={{ margin: 0 }}>Сертификаты настраиваются на вкладке «JSON узла».</p>
        </>
      )}

      {security === 'reality' && (
        <>
          <TextField
            label="Цель маскировки (dest)"
            mono
            placeholder="yahoo.com:443"
            value={reality[destKey] === undefined ? undefined : String(reality[destKey])}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r[destKey]; else r[destKey] = v })}
          />
          <StringListField
            label="Имена серверов (serverNames)"
            placeholder={'yahoo.com\nwww.yahoo.com'}
            value={reality.serverNames as string[] | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.serverNames; else r.serverNames = v })}
          />
          <TextField
            label="Приватный ключ"
            mono
            value={reality.privateKey as string | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.privateKey; else r.privateKey = v })}
          />
          <div className="row">
            <Button
              disabled={keypair.isPending}
              onClick={() => {
                // Сбрасываем прежний derive — иначе его устаревший pbk перекрыл бы ключ новой пары
                derive.reset()
                keypair.mutate(undefined, {
                  onSuccess: (keys) => patchReality((r) => { r.privateKey = keys.privateKey }),
                })
              }}
            >
              Сгенерировать ключи
            </Button>
            <Button
              variant="ghost"
              disabled={derive.isPending || !reality.privateKey}
              onClick={() => derive.mutate(reality.privateKey as string)}
            >
              Публичный ключ
            </Button>
          </div>
          {shownPublicKey && (
            <p className="mono" style={{ fontSize: 12, wordBreak: 'break-all', margin: 0 }}>
              pbk: {shownPublicKey}
            </p>
          )}
          {(keypair.isError || derive.isError) && (
            <span className="field-error">{((keypair.error ?? derive.error) as Error).message}</span>
          )}
          <TagListField
            label="Короткие ID (shortIds)"
            addLabel="+ ID"
            value={reality.shortIds as string[] | undefined}
            onAdd={() => patchReality((r) => { r.shortIds = [...((r.shortIds as string[]) ?? []), randomShortId()] })}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.shortIds; else r.shortIds = v })}
          />
          <SelectField
            label="Отпечаток (fingerprint)"
            value={(reality.fingerprint as string) ?? 'chrome'}
            options={FINGERPRINTS}
            onChange={(v) => patchReality((r) => { r.fingerprint = v })}
          />
        </>
      )}
    </>
  )
}
