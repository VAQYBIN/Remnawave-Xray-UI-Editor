import { Button } from '../../shared/ui'
import { randomUuid, trojanPassword } from '../../entities/xray/generate'
import { SelectField, TextField, type Option } from './fields'

type Obj = Record<string, unknown>

const FLOWS: Option[] = [
  { value: '', label: 'нет' },
  { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
]

interface Props {
  protocol: 'vless' | 'trojan'
  clients: Obj[]
  onChange: (clients: Obj[]) => void
}

export function ClientsEditor({ protocol, clients, onChange }: Props) {
  function updateClient(index: number, patch: Obj) {
    onChange(
      clients.map((c, i) => {
        if (i !== index) return c
        const next: Obj = { ...c, ...patch }
        // undefined в патче означает «удалить ключ»
        for (const key of Object.keys(patch)) {
          if (next[key] === undefined) delete next[key]
        }
        return next
      }),
    )
  }

  function addClient() {
    onChange([...clients, protocol === 'vless' ? { id: randomUuid() } : { password: trojanPassword() }])
  }

  return (
    <div className="field">
      <span className="field-label">Клиенты ({clients.length})</span>
      {clients.map((client, i) => (
        <div key={i} className="client-card">
          <div className="row">
            <span className="muted">#{i + 1}</span>
            <span className="spacer" />
            <Button
              variant="ghost"
              aria-label={`Удалить клиента ${i + 1}`}
              onClick={() => onChange(clients.filter((_, idx) => idx !== i))}
            >
              ✕
            </Button>
          </div>
          {protocol === 'vless' && (
            <>
              <TextField label="UUID" mono value={client.id as string | undefined} onChange={(v) => updateClient(i, { id: v })} />
              <Button variant="ghost" onClick={() => updateClient(i, { id: randomUuid() })}>
                Сгенерировать UUID
              </Button>
              <SelectField
                label="Flow"
                value={(client.flow as string) ?? ''}
                options={FLOWS}
                onChange={(v) => updateClient(i, { flow: v === '' ? undefined : v })}
              />
            </>
          )}
          {protocol === 'trojan' && (
            <>
              <TextField
                label="Пароль"
                mono
                value={client.password as string | undefined}
                onChange={(v) => updateClient(i, { password: v })}
              />
              <Button variant="ghost" onClick={() => updateClient(i, { password: trojanPassword() })}>
                Сгенерировать пароль
              </Button>
            </>
          )}
          <TextField label="Email (метка)" value={client.email as string | undefined} onChange={(v) => updateClient(i, { email: v })} />
        </div>
      ))}
      <Button onClick={addClient}>+ Клиент</Button>
    </div>
  )
}
