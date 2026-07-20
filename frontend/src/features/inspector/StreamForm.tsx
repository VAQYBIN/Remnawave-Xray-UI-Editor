import { Button } from '../../shared/ui'
import { randomShortId } from '../../entities/xray/generate'
import { useRealityKeypair, useRealityPublicKey } from '../../shared/api'
import { SelectField, StringListField, TagListField, TextField, type Option } from './fields'

type Obj = Record<string, unknown>

const NETWORKS: Option[] = [
  { value: 'tcp', label: 'TCP' },
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

interface Props {
  value: Obj // streamSettings целиком
  onChange: (next: Obj) => void
}

export function StreamForm({ value, onChange }: Props) {
  const keypair = useRealityKeypair()
  const derive = useRealityPublicKey()
  const network = (value.network as string) ?? 'tcp'
  const security = (value.security as string) ?? 'none'
  const reality = (value.realitySettings as Obj) ?? {}
  const tls = (value.tlsSettings as Obj) ?? {}

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
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
        <TextField
          label="Путь WebSocket"
          mono
          placeholder="/ws"
          value={(value.wsSettings as Obj | undefined)?.path as string | undefined}
          onChange={(v) => patch((n) => { n.wsSettings = { ...((n.wsSettings as Obj) ?? {}), path: v } })}
        />
      )}
      {network === 'grpc' && (
        <TextField
          label="Имя gRPC-сервиса"
          mono
          value={(value.grpcSettings as Obj | undefined)?.serviceName as string | undefined}
          onChange={(v) => patch((n) => { n.grpcSettings = { ...((n.grpcSettings as Obj) ?? {}), serviceName: v } })}
        />
      )}
      {network === 'httpupgrade' && (
        <TextField
          label="Путь HTTPUpgrade"
          mono
          placeholder="/upgrade"
          value={(value.httpupgradeSettings as Obj | undefined)?.path as string | undefined}
          onChange={(v) => patch((n) => { n.httpupgradeSettings = { ...((n.httpupgradeSettings as Obj) ?? {}), path: v } })}
        />
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
