import { CollapsibleSection } from '../../shared/ui'
import { KeyValueField, ListEditor } from './collections'
import { NumberField, SelectField, StringListField, TextField, type Option } from './fields'

type Obj = Record<string, unknown>

const QUERY_STRATEGIES: Option[] = [
  { value: '', label: 'не задана (UseIP)' },
  { value: 'UseIP', label: 'UseIP — A и AAAA' },
  { value: 'UseIPv4', label: 'UseIPv4 — только A' },
  { value: 'UseIPv6', label: 'UseIPv6 — только AAAA' },
]

const SERVER_KINDS: Option[] = [
  { value: 'simple', label: 'адрес строкой' },
  { value: 'full', label: 'расширенный объект' },
]

// Сервер DNS в конфиге — строка-адрес ИЛИ объект. kind-обёртка живёт только в UI:
// fromCard возвращает в конфиг исходную форму, неизвестные поля объекта сохраняются.
type ServerCard = { kind: 'simple'; address: string } | { kind: 'full'; server: Obj }

function toCard(s: unknown): ServerCard {
  return typeof s === 'string' ? { kind: 'simple', address: s } : { kind: 'full', server: { ...((s as Obj) ?? {}) } }
}

function fromCard(c: ServerCard): unknown {
  return c.kind === 'simple' ? c.address : c.server
}

interface Props {
  value: Obj // объект dns целиком (getNodeJson(config, 'dns'))
  onChange: (next: Obj) => void
}

export function DnsForm({ value, onChange }: Props) {
  const servers = value.servers as unknown[] | undefined
  const cards = servers?.map(toCard)
  const hosts = (value.hosts as Record<string, unknown> | undefined) ?? {}
  // KeyValueField умеет только строки; записи-массивы (несколько IP на домен)
  // в форме не редактируются, но сохраняются при любых правках
  const stringHosts = Object.fromEntries(
    Object.entries(hosts).filter((e): e is [string, string] => typeof e[1] === 'string'),
  )
  const arrayHostEntries = Object.entries(hosts).filter(([, v]) => typeof v !== 'string')

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  return (
    <>
      <ListEditor<ServerCard>
        label="Серверы"
        hint="Опрашиваются по порядку; адрес — IP, tcp://…, https://…/dns-query или localhost"
        value={cards}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.servers; else n.servers = v.map(fromCard) })}
        createItem={() => ({ kind: 'simple', address: '' })}
        addLabel="+ Сервер"
        renderItem={(item, update, i) => {
          const total = cards?.length ?? 0
          const server = item.kind === 'full' ? item.server : {}
          const setServer = (mut: (s: Obj) => void) => {
            const s = { ...server }
            mut(s)
            update({ kind: 'full', server: s } as Partial<ServerCard>)
          }
          return (
            <>
              <SelectField
                label="Тип сервера"
                hint="Расширенный — свои домены и expectIPs; при сворачивании в строку останется только адрес"
                value={item.kind}
                options={SERVER_KINDS}
                onChange={(v) => {
                  if (v === item.kind) return
                  if (v === 'full') {
                    update({
                      kind: 'full',
                      server: item.kind === 'simple' && item.address !== '' ? { address: item.address } : {},
                    } as Partial<ServerCard>)
                  } else {
                    update({
                      kind: 'simple',
                      address: ((item.kind === 'full' ? item.server.address : '') as string | undefined) ?? '',
                    } as Partial<ServerCard>)
                  }
                }}
              />
              {item.kind === 'simple' && (
                <TextField
                  label="Адрес"
                  mono
                  placeholder="1.1.1.1"
                  value={item.address === '' ? undefined : item.address}
                  onChange={(v) => update({ address: v ?? '' } as Partial<ServerCard>)}
                />
              )}
              {item.kind === 'full' && (
                <>
                  <TextField label="Адрес" mono placeholder="8.8.8.8" value={server.address as string | undefined}
                    onChange={(v) => setServer((s) => { if (v === undefined) delete s.address; else s.address = v })} />
                  <NumberField label="Порт" placeholder="53" value={server.port as number | undefined}
                    onChange={(v) => setServer((s) => { if (v === undefined) delete s.port; else s.port = v })} />
                  {/* Mount-only буфер StringListField — remount при смене числа карточек */}
                  <StringListField key={`domains:${i}:${total}`} label="Домены (domains)"
                    hint="Только эти домены резолвятся этим сервером"
                    placeholder={'geosite:category-ru\ndomain:example.com'}
                    value={server.domains as string[] | undefined}
                    onChange={(v) => setServer((s) => { if (v === undefined) delete s.domains; else s.domains = v })} />
                  <StringListField key={`expectIPs:${i}:${total}`} label="Ожидаемые IP (expectIPs)"
                    hint="Ответы вне списка отбрасываются (защита от DNS-подмены)"
                    placeholder="geoip:ru"
                    value={server.expectIPs as string[] | undefined}
                    onChange={(v) => setServer((s) => { if (v === undefined) delete s.expectIPs; else s.expectIPs = v })} />
                </>
              )}
            </>
          )
        }}
      />
      <SelectField
        label="Стратегия запросов (queryStrategy)"
        value={(value.queryStrategy as string) ?? ''}
        options={QUERY_STRATEGIES}
        onChange={(v) => patch((n) => { if (v === '') delete n.queryStrategy; else n.queryStrategy = v })}
      />
      <KeyValueField
        label="Hosts"
        hint="Статические записи: домен → IP или домен → другой домен"
        keyPlaceholder="example.com"
        valuePlaceholder="1.2.3.4"
        value={Object.keys(stringHosts).length > 0 ? stringHosts : undefined}
        onChange={(v) =>
          patch((n) => {
            const merged: Record<string, unknown> = { ...(v ?? {}) }
            for (const [k, val] of arrayHostEntries) merged[k] = val
            if (Object.keys(merged).length === 0) delete n.hosts
            else n.hosts = merged
          })
        }
      />
      {arrayHostEntries.length > 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Записи с несколькими значениями ({arrayHostEntries.map(([k]) => k).join(', ')}) редактируются на
          вкладке «JSON узла».
        </p>
      )}
      <TextField
        label="Тег (tag)"
        mono
        hint="Запросы DNS-модуля помечаются этим тегом — можно маршрутизировать правилами"
        value={value.tag as string | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.tag; else n.tag = v })}
      />
      <CollapsibleSection title="Продвинутые (DNS)">
        <TextField
          label="IP клиента (clientIp)"
          mono
          placeholder="203.0.113.1"
          hint="EDNS Client Subnet — геопривязка DNS-ответов к этому IP"
          value={value.clientIp as string | undefined}
          onChange={(v) => patch((n) => { if (v === undefined) delete n.clientIp; else n.clientIp = v })}
        />
      </CollapsibleSection>
    </>
  )
}
