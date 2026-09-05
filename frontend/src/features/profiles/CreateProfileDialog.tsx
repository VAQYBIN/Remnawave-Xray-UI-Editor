import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCreateProfile, useRealityKeypair } from '../../shared/api'
import { randomShortId } from '../../entities/xray/generate'
import { DEFAULT_PARAMS, XrayConfigSchema, planFor, type RecipeId } from '../../entities/xray'
import { Button, Checkbox, Dialog, Select, TextInput } from '../../shared/ui'
import { NAME_RE } from '../../shared/lib/nameRules'

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
        // flow на уровне settings — Remnawave применяет его ко всем пользователям inbound'а
        settings: { clients: [], decryption: 'none', flow: 'xtls-rprx-vision' },
        streamSettings: {
          network: 'tcp',
          security: 'reality',
          realitySettings: {
            show: false,
            target: 'yahoo.com:443',
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

// Рецепты без обязательных параметров — их можно применить прямо при создании.
// WARP и цепочка требуют ввода, поэтому живут только в редакторе.
const CREATE_RECIPES: { id: RecipeId; label: string }[] = [
  { id: 'torrent', label: 'Блокировать торренты' },
  { id: 'ads', label: 'Блокировать рекламу' },
  { id: 'private', label: 'Блокировать локальные сети' },
]

function withRecipes(base: unknown, picks: RecipeId[]): unknown {
  if (picks.length === 0) return base
  let config = XrayConfigSchema.parse(base)
  for (const id of picks) config = planFor(config, id, DEFAULT_PARAMS).config
  return config
}

type Preset = 'minimal' | 'reality'

export function CreateProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [preset, setPreset] = useState<Preset>('minimal')
  const [picks, setPicks] = useState<RecipeId[]>([])
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
    create.mutate(
      { name, config: withRecipes(config, picks) },
      { onSuccess: (profile) => navigate(`/profiles/${profile.uuid}`) },
    )
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
      <div className="field">
        <label className="field-label" htmlFor="profile-preset">
          Шаблон
        </label>
        <Select
          id="profile-preset"
          value={preset}
          onChange={(v) => setPreset(v as Preset)}
          options={[
            { value: 'minimal', label: 'Минимальный VLESS (TCP)' },
            { value: 'reality', label: 'VLESS Reality Vision' },
          ]}
        />
      </div>
      {preset === 'reality' && (
        <p className="muted">Reality-ключи и короткий ID будут сгенерированы автоматически при создании.</p>
      )}
      <div className="field">
        <span className="field-label">Готовые рецепты</span>
        {CREATE_RECIPES.map((r) => (
          <Checkbox
            key={r.id}
            label={r.label}
            checked={picks.includes(r.id)}
            onChange={(on) =>
              setPicks((prev) => (on ? [...prev, r.id] : prev.filter((id) => id !== r.id)))
            }
          />
        ))}
        <span className="field-hint">
          Остальные рецепты — WARP и цепочку — можно добавить в редакторе кнопкой «+ Рецепт».
        </span>
      </div>
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
