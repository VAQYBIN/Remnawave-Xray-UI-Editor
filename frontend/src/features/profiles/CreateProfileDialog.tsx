import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateProfile } from '../../shared/api'
import { Button, Dialog, TextInput } from '../../shared/ui'

const NAME_RE = /^[A-Za-z0-9_\s-]{2,30}$/
const TEMPLATE = {
  log: { loglevel: 'warning' },
  inbounds: [],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
}

export function CreateProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const create = useCreateProfile()
  const navigate = useNavigate()
  const invalid = name.length > 0 && !NAME_RE.test(name)

  function submit() {
    create.mutate(
      { name, config: TEMPLATE },
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
      <div className="row">
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="primary" disabled={!NAME_RE.test(name) || create.isPending} onClick={submit}>
          Создать
        </Button>
      </div>
    </Dialog>
  )
}
