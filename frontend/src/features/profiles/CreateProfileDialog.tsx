import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateProfile, useRealityKeypair } from '../../shared/api'
import { randomShortId } from '../../entities/xray/generate'
import { Button, Dialog, Select, TextInput } from '../../shared/ui'

const NAME_RE = /^[A-Za-z0-9_\s-]{2,30}$/
// Панель Remnawave отклоняет конфиг без единого inbound (500, errorCode A112),
// поэтому шаблон нового профиля содержит минимальный VLESS-inbound.
export const TEMPLATE = {
  log: { loglevel: 'warning' },
  inbounds: [
    {
      tag: 'vless-in',
      port: 443,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: { network: 'tcp', security: 'none' },
      sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
    },
  ],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
}

// Шаблон VLESS + Reality (Vision): ключи и shortId передаются при создании
export function realityTemplate(privateKey: string, shortId: string) {
  return {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        tag: 'vless-reality',
        port: 443,
        protocol: 'vless',
        settings: { clients: [], decryption: 'none' },
        streamSettings: {
          network: 'tcp',
          security: 'reality',
          realitySettings: {
            show: false,
            dest: 'yahoo.com:443',
            xver: 0,
            serverNames: ['yahoo.com', 'www.yahoo.com'],
            privateKey,
            shortIds: [shortId],
          },
        },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
      },
    ],
    outbounds: [
      { tag: 'direct', protocol: 'freedom', settings: {} },
      { tag: 'block', protocol: 'blackhole', settings: {} },
    ],
    routing: { rules: [] },
  }
}

type Preset = 'minimal' | 'reality'

export function CreateProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [preset, setPreset] = useState<Preset>('minimal')
  const create = useCreateProfile()
  const keypair = useRealityKeypair()
  const navigate = useNavigate()
  const invalid = name.length > 0 && !NAME_RE.test(name)
  const busy = create.isPending || keypair.isPending

  async function submit() {
    let config: unknown = TEMPLATE
    if (preset === 'reality') {
      let keys
      try {
        keys = await keypair.mutateAsync()
      } catch {
        return // ошибка показана через keypair.isError
      }
      config = realityTemplate(keys.privateKey, randomShortId())
    }
    create.mutate({ name, config }, { onSuccess: (profile) => navigate(`/profiles/${profile.uuid}`) })
  }

  return (
    <Dialog open={open} title="Создать профиль" onClose={onClose}>
      <div className="field">
        <label className="field-label" htmlFor="profile-name">
          Имя профиля
        </label>
        <TextInput
          id="profile-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Germany 1"
        />
        {invalid && <span className="field-error">Имя: 2–30 символов, латиница, цифры, пробел, - и _</span>}
        {create.isError && <span className="field-error">{(create.error as Error).message}</span>}
      </div>
      <label className="field">
        <span className="field-label">Шаблон</span>
        <Select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
          <option value="minimal">Минимальный VLESS (TCP)</option>
          <option value="reality">VLESS Reality Vision</option>
        </Select>
      </label>
      {preset === 'reality' && (
        <p className="muted">Reality-ключи и короткий ID будут сгенерированы автоматически при создании.</p>
      )}
      {keypair.isError && <span className="field-error">{(keypair.error as Error).message}</span>}
      <div className="row">
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="primary" disabled={!NAME_RE.test(name) || busy} onClick={submit}>
          Создать
        </Button>
      </div>
    </Dialog>
  )
}
