import { useState } from 'react'
import { Button, CollapsibleSection } from '../../shared/ui'
import { randomShortId } from '../../entities/xray/generate'
import {
  allowedNetworks,
  allowedSecurities,
  flowNetworkIssue,
  hysteriaCertificateIssue,
  normalizeNetwork,
  securityNetworkIssue,
} from '../../entities/xray'
import { useRealityKeypair, useRealityPublicKey } from '../../shared/api'
import { KeyValueField, ListEditor } from './collections'
import {
  CheckboxField,
  MultiSelectField,
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
  { value: 'hysteria', label: 'Hysteria 2 (QUIC)' },
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

const ALPN_OPTIONS: Option[] = ['h2', 'http/1.1', 'h3'].map((v) => ({ value: v, label: v }))

const TLS_VERSIONS: Option[] = [
  { value: '', label: 'не задана' },
  { value: '1.0', label: '1.0' },
  { value: '1.1', label: '1.1' },
  { value: '1.2', label: '1.2' },
  { value: '1.3', label: '1.3' },
]

const MASQUERADE_TYPES: Option[] = [
  { value: '', label: 'нет' },
  { value: 'file', label: 'file — отдавать сайт из каталога' },
]

const CONGESTIONS: Option[] = [
  { value: '', label: 'по умолчанию (brutal)' },
  { value: 'reno', label: 'reno' },
  { value: 'bbr', label: 'bbr' },
  { value: 'brutal', label: 'brutal' },
  { value: 'force-brutal', label: 'force-brutal' },
]

const SOCKOPT_DOMAIN_STRATEGIES: Option[] = [
  { value: '', label: 'не задана (AsIs)' },
  { value: 'AsIs', label: 'AsIs' },
  { value: 'UseIP', label: 'UseIP' },
  { value: 'UseIPv4', label: 'UseIPv4' },
  { value: 'UseIPv6', label: 'UseIPv6' },
]

// Несовместимые комбинации не предлагаются, но уже существующее в конфиге значение
// остаётся видимой опцией с пометкой — молча переписывать конфиг нельзя,
// вместо этого под select'ами показываются предупреждения
function networkSelectOptions(security: string, flow: string | undefined, current: string): Option[] {
  const allowed = allowedNetworks(security).filter((n) => flowNetworkIssue(flow, n) === null)
  const base = NETWORKS.filter((o) => allowed.includes(o.value))
  if (base.some((o) => o.value === current)) return base
  const compatible = allowed.includes(normalizeNetwork(current))
  return [...base, { value: current, label: compatible ? `${current} (= tcp)` : `${current} (несовместимо)` }]
}

function securitySelectOptions(network: string, current: string): Option[] {
  const allowed = allowedSecurities(network)
  const base = SECURITIES.filter((o) => allowed.includes(o.value))
  return base.some((o) => o.value === current)
    ? base
    : [...base, { value: current, label: `${current} (несовместимо)` }]
}

export type StreamFormMode = 'inbound' | 'outbound'

interface Props {
  value: Obj // streamSettings целиком
  onChange: (next: Obj) => void
  /** inbound — серверные поля (дефолт, сохраняет прежнее поведение), outbound — клиентские */
  mode?: StreamFormMode
  /** flow протокола (settings.flow у VLESS) — для матрицы «vision только поверх raw» */
  flow?: string
  /** Теги outbound конфига — для select'а sockopt.dialerProxy (outbound-режим) */
  outboundTags?: string[]
}

export function StreamForm({ value, onChange, mode = 'inbound', flow, outboundTags }: Props) {
  const keypair = useRealityKeypair()
  const derive = useRealityPublicKey()
  // Сколько shortId генерировать за раз (Reality); пустой shortId добавляется отдельно
  const [genCount, setGenCount] = useState(4)
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
  const hysteria = (value.hysteriaSettings as Obj) ?? {}
  const masquerade = (hysteria.masquerade as Obj) ?? {}
  const quic = ((value.finalmask as Obj | undefined)?.quicParams as Obj | undefined) ?? {}
  const sockopt = (value.sockopt as Obj) ?? {}
  const dialerProxy = (sockopt.dialerProxy as string) ?? ''
  // Значение, которого нет среди тегов конфига, остаётся видимым с пометкой —
  // битая ссылка снимается из формы, а не пропадает молча
  const dialerOptions: Option[] = [
    { value: '', label: '— нет —' },
    ...(outboundTags ?? []).map((t) => ({ value: t, label: t })),
    ...(dialerProxy !== '' && !(outboundTags ?? []).includes(dialerProxy)
      ? [{ value: dialerProxy, label: `${dialerProxy} (нет в конфиге)` }]
      : []),
  ]

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

  // Дописать shortId'ы к существующим (сгенерированные или пустой «»)
  function appendShortIds(add: string[]) {
    const current = (reality.shortIds as string[] | undefined) ?? []
    patchReality((r) => { r.shortIds = [...current, ...add] })
  }

  // QUIC-параметры (congestion/brutal*) унифицированы в finalmask.quicParams (Xray v26.3.27+),
  // одноимённые поля в hysteriaSettings soft-deprecated; опустевшие уровни удаляются
  function patchQuic(mut: (q: Obj) => void) {
    patch((next) => {
      const fm = (next.finalmask as Obj) ?? {}
      const q = (fm.quicParams as Obj) ?? {}
      mut(q)
      if (Object.keys(q).length === 0) delete fm.quicParams
      else fm.quicParams = q
      if (Object.keys(fm).length === 0) delete next.finalmask
      else next.finalmask = fm
    })
  }

  // Xray ≥24.09 понимает и dest, и target; по умолчанию пишем target,
  // существующий устаревший ключ dest уважаем, чтобы не плодить дубли
  const destKey = 'dest' in reality ? 'dest' : 'target'
  const shownPublicKey = derive.data?.publicKey ?? keypair.data?.publicKey
  const secNetIssue = securityNetworkIssue(security, network)
  const flowIssue = flowNetworkIssue(flow, network)
  const certIssue = hysteriaCertificateIssue(network, security, tls as { certificates?: unknown[] })

  return (
    <>
      <SelectField
        label="Транспорт"
        value={network}
        options={networkSelectOptions(security, flow, network)}
        onChange={(v) =>
          patch((n) => {
            n.network = v
            // Hysteria 2 жёстко требует version: 2 — иначе ядро не стартует
            if (v === 'hysteria' && n.hysteriaSettings === undefined) n.hysteriaSettings = { version: 2 }
          })
        }
      />
      <SelectField
        label="Шифрование"
        value={security}
        options={securitySelectOptions(network, security)}
        onChange={(v) =>
          patch((n) => {
            n.security = v
            if (v === 'reality' && n.realitySettings === undefined) n.realitySettings = {}
            if (v === 'tls' && n.tlsSettings === undefined) n.tlsSettings = {}
          })
        }
      />
      {secNetIssue && <span className="field-warning">{secNetIssue}</span>}
      {flowIssue && <span className="field-warning">{flowIssue}</span>}
      {certIssue && <span className="field-warning">{certIssue}</span>}

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

      {network === 'hysteria' && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Hysteria 2 работает поверх QUIC: нужен security «TLS» с настоящим сертификатом; version: 2 фиксирован.
          </p>
          <TextField
            label="Скорость вверх (up)"
            mono
            placeholder="100mbps"
            hint="Единицы: bps/kbps/mbps/gbps"
            value={hysteria.up as string | undefined}
            onChange={(v) => patchSection('hysteriaSettings', (s) => { if (v === undefined) delete s.up; else s.up = v })}
          />
          <TextField
            label="Скорость вниз (down)"
            mono
            placeholder="300mbps"
            hint="Единицы: bps/kbps/mbps/gbps"
            value={hysteria.down as string | undefined}
            onChange={(v) => patchSection('hysteriaSettings', (s) => { if (v === undefined) delete s.down; else s.down = v })}
          />
          <SelectField
            label="Маскировка (masquerade)"
            hint="Неавторизованным отдаётся реальный сайт — HY2-аналог selfsteal"
            value={(masquerade.type as string) ?? ''}
            options={MASQUERADE_TYPES}
            onChange={(v) =>
              patchSection('hysteriaSettings', (s) => {
                if (v === '') delete s.masquerade
                else s.masquerade = { ...((s.masquerade as Obj) ?? {}), type: v }
              })
            }
          />
          {masquerade.type === 'file' && (
            <TextField
              label="Каталог сайта (masquerade.dir)"
              mono
              placeholder="/var/www"
              value={masquerade.dir as string | undefined}
              onChange={(v) =>
                patchSection('hysteriaSettings', (s) => {
                  const m = (s.masquerade as Obj) ?? { type: 'file' }
                  if (v === undefined) delete m.dir
                  else m.dir = v
                  s.masquerade = m
                })
              }
            />
          )}
          <SelectField
            label="Congestion control"
            hint="brutal требует brutalUp/brutalDown — фиксированная полоса, стабильность на потерях"
            value={(quic.congestion as string) ?? ''}
            options={CONGESTIONS}
            onChange={(v) => patchQuic((q) => { if (v === '') delete q.congestion; else q.congestion = v })}
          />
          <NumberField
            label="brutalUp (Мбит/с)"
            value={quic.brutalUp as number | undefined}
            onChange={(v) => patchQuic((q) => { if (v === undefined) delete q.brutalUp; else q.brutalUp = v })}
          />
          <NumberField
            label="brutalDown (Мбит/с)"
            value={quic.brutalDown as number | undefined}
            onChange={(v) => patchQuic((q) => { if (v === undefined) delete q.brutalDown; else q.brutalDown = v })}
          />
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
            onChange={(v) =>
              patchSection('tlsSettings', (s) => { if (v === undefined) delete s.serverName; else s.serverName = v })
            }
          />
          <MultiSelectField
            label="ALPN"
            hint="Пусто — дефолт ядра (h2, http/1.1)"
            options={ALPN_OPTIONS}
            value={tls.alpn as string[] | undefined}
            onChange={(v) => patchSection('tlsSettings', (s) => { if (v === undefined) delete s.alpn; else s.alpn = v })}
          />
          {mode === 'outbound' && (
            <SelectField
              label="Отпечаток (fingerprint)"
              hint="uTLS-профиль клиентского ClientHello"
              value={(tls.fingerprint as string) ?? ''}
              options={[{ value: '', label: 'не задан' }, ...FINGERPRINTS]}
              onChange={(v) =>
                patchSection('tlsSettings', (s) => { if (v === '') delete s.fingerprint; else s.fingerprint = v })
              }
            />
          )}
          {mode === 'inbound' && (
            <>
              <ListEditor<Obj>
                label="Сертификаты"
                hint="Файловые пути ИЛИ inline-PEM построчно"
                value={tls.certificates as Obj[] | undefined}
                onChange={(v) =>
                  patchSection('tlsSettings', (s) => { if (v === undefined) delete s.certificates; else s.certificates = v })
                }
                createItem={() => ({})}
                addLabel="+ Сертификат"
                renderItem={(item, update, i) => {
                  const total = (tls.certificates as Obj[] | undefined)?.length ?? 0
                  return (
                    <>
                      <TextField
                        label="Файл сертификата (certificateFile)"
                        mono
                        placeholder="/etc/ssl/cert.pem"
                        value={item.certificateFile as string | undefined}
                        onChange={(v) => update({ certificateFile: v })}
                      />
                      <TextField
                        label="Файл ключа (keyFile)"
                        mono
                        placeholder="/etc/ssl/key.pem"
                        value={item.keyFile as string | undefined}
                        onChange={(v) => update({ keyFile: v })}
                      />
                      {/* Mount-only буфер StringListField: удаление карточки сдвигает индексы,
                          key с длиной списка remount'ит поля, чтобы буферы перечитали значения */}
                      <StringListField
                        key={`cert:${i}:${total}`}
                        label="Сертификат (PEM, построчно)"
                        placeholder="-----BEGIN CERTIFICATE-----"
                        value={item.certificate as string[] | undefined}
                        onChange={(v) => update({ certificate: v })}
                      />
                      <StringListField
                        key={`key:${i}:${total}`}
                        label="Ключ (PEM, построчно)"
                        placeholder="-----BEGIN PRIVATE KEY-----"
                        value={item.key as string[] | undefined}
                        onChange={(v) => update({ key: v })}
                      />
                    </>
                  )
                }}
              />
              <CollapsibleSection title="Продвинутые (TLS)">
                <SelectField
                  label="Мин. версия TLS"
                  value={(tls.minVersion as string) ?? ''}
                  options={TLS_VERSIONS}
                  onChange={(v) =>
                    patchSection('tlsSettings', (s) => { if (v === '') delete s.minVersion; else s.minVersion = v })
                  }
                />
                <SelectField
                  label="Макс. версия TLS"
                  value={(tls.maxVersion as string) ?? ''}
                  options={TLS_VERSIONS}
                  onChange={(v) =>
                    patchSection('tlsSettings', (s) => { if (v === '') delete s.maxVersion; else s.maxVersion = v })
                  }
                />
                <CheckboxField
                  label="Отклонять неизвестный SNI (rejectUnknownSni)"
                  hint="Соединения с SNI вне certificates разрываются"
                  value={tls.rejectUnknownSni as boolean | undefined}
                  onChange={(v) =>
                    patchSection('tlsSettings', (s) => {
                      if (v === undefined) delete s.rejectUnknownSni
                      else s.rejectUnknownSni = v
                    })
                  }
                />
              </CollapsibleSection>
            </>
          )}
        </>
      )}

      {security === 'reality' && mode === 'inbound' && (
        <>
          <TextField
            label="Цель маскировки (target)"
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
            hint="Пустой shortId пускает клиентов без него. Обычно добавляют несколько разом."
            value={reality.shortIds as string[] | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.shortIds; else r.shortIds = v })}
            actions={
              <>
                <input
                  className="input taglist-count"
                  type="number"
                  min={1}
                  max={16}
                  value={genCount}
                  aria-label="Сколько shortId сгенерировать"
                  onChange={(e) => setGenCount(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
                />
                <Button onClick={() => appendShortIds(Array.from({ length: genCount }, () => randomShortId()))}>
                  Сгенерировать
                </Button>
                <Button variant="ghost" onClick={() => appendShortIds([''])}>
                  + пустой
                </Button>
              </>
            }
          />
          <NumberField
            label="PROXY protocol к цели (xver)"
            placeholder="0"
            value={reality.xver as number | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.xver; else r.xver = v })}
          />
          <CollapsibleSection title="Продвинутые (Reality)">
            <CheckboxField
              label="Отладочный вывод (show)"
              hint="Печатает отладку хендшейка в лог — в проде выключено"
              value={reality.show as boolean | undefined}
              onChange={(v) => patchReality((r) => { if (v === undefined) delete r.show; else r.show = v })}
            />
          </CollapsibleSection>
        </>
      )}

      {security === 'reality' && mode === 'outbound' && (
        <>
          <TextField
            label="Имя сервера (serverName)"
            mono
            hint="Ровно одно значение — одно из serverNames сервера"
            value={reality.serverName as string | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.serverName; else r.serverName = v })}
          />
          <TextField
            label="Публичный ключ сервера (password)"
            mono
            hint="В свежих ядрах поле называется password — это x25519 publicKey сервера (pbk)"
            value={reality.password as string | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.password; else r.password = v })}
          />
          <TextField
            label="Короткий ID (shortId)"
            mono
            hint="Один из shortIds сервера"
            value={reality.shortId as string | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.shortId; else r.shortId = v })}
          />
          <TextField
            label="spiderX"
            mono
            placeholder="/"
            hint="Путь имитации краулера; рекомендуется свой на каждого клиента"
            value={reality.spiderX as string | undefined}
            onChange={(v) => patchReality((r) => { if (v === undefined) delete r.spiderX; else r.spiderX = v })}
          />
          <SelectField
            label="Отпечаток (fingerprint)"
            hint="uTLS-профиль; Reality работает только с uTLS"
            value={(reality.fingerprint as string) ?? 'chrome'}
            options={FINGERPRINTS}
            onChange={(v) => patchReality((r) => { r.fingerprint = v })}
          />
        </>
      )}

      <CollapsibleSection title="Сетевые опции (sockopt)">
        {mode === 'outbound' && (
          <SelectField
            label="Проксировать через outbound (dialerProxy)"
            hint="Цепочка: исходящие соединения этого outbound пойдут через указанный тег (например, нода → WARP)"
            value={dialerProxy}
            options={dialerOptions}
            onChange={(v) =>
              patchSection('sockopt', (s) => { if (v === '') delete s.dialerProxy; else s.dialerProxy = v })
            }
          />
        )}
        {mode === 'inbound' && (
          <CheckboxField
            label="Принимать PROXY protocol (sockopt)"
            hint="acceptProxyProtocol на уровне сокета"
            value={sockopt.acceptProxyProtocol as boolean | undefined}
            onChange={(v) =>
              patchSection('sockopt', (s) => {
                if (v === undefined) delete s.acceptProxyProtocol
                else s.acceptProxyProtocol = v
              })
            }
          />
        )}
        <NumberField
          label="Метка пакетов (mark)"
          placeholder="0"
          value={sockopt.mark as number | undefined}
          onChange={(v) => patchSection('sockopt', (s) => { if (v === undefined) delete s.mark; else s.mark = v })}
        />
        <CheckboxField
          label="TCP Fast Open"
          hint="Числовое значение (длина очереди) редактируется в JSON — чекбокс отражает только true"
          value={sockopt.tcpFastOpen === true ? true : undefined}
          onChange={(v) =>
            patchSection('sockopt', (s) => { if (v === undefined) delete s.tcpFastOpen; else s.tcpFastOpen = v })
          }
        />
        <TextField
          label="Сетевой интерфейс (interface)"
          mono
          placeholder="eth0"
          value={sockopt.interface as string | undefined}
          onChange={(v) =>
            patchSection('sockopt', (s) => { if (v === undefined) delete s.interface; else s.interface = v })
          }
        />
        {mode === 'outbound' && (
          <SelectField
            label="Стратегия доменов (sockopt)"
            hint="Как резолвить домены при исходящем соединении на уровне сокета"
            value={(sockopt.domainStrategy as string) ?? ''}
            options={SOCKOPT_DOMAIN_STRATEGIES}
            onChange={(v) =>
              patchSection('sockopt', (s) => { if (v === '') delete s.domainStrategy; else s.domainStrategy = v })
            }
          />
        )}
      </CollapsibleSection>
    </>
  )
}
