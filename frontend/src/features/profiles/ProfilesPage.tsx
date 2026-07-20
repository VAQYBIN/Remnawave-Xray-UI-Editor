import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDeleteProfile, useLogout, useProfiles, type Profile } from '../../shared/api'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Card, Chip, Dialog, EmptyState } from '../../shared/ui'
import { CreateProfileDialog } from './CreateProfileDialog'

const MAX_CHIPS = 4

function ProfileCard({ profile, onDelete }: { profile: Profile; onDelete: () => void }) {
  const navigate = useNavigate()
  const shown = profile.inbounds.slice(0, MAX_CHIPS)
  const hidden = profile.inbounds.length - shown.length

  return (
    <Card onClick={() => navigate(`/profiles/${profile.uuid}`)}>
      <h2 style={{ marginBottom: 10 }}>{profile.name}</h2>
      <div className="row-wrap" style={{ marginBottom: 10 }}>
        {shown.map((inb) => (
          <Chip key={inb.uuid} dir="in">
            {inb.port != null ? `${inb.tag} :${inb.port}` : inb.tag}
          </Chip>
        ))}
        {hidden > 0 && <Chip dir="none">+{hidden}</Chip>}
        {profile.inbounds.length === 0 && <span className="muted">Нет inbound'ов</span>}
      </div>
      <p className="muted" style={{ margin: '0 0 10px' }}>
        {profile.nodes.length > 0
          ? profile.nodes.map((n) => `${n.countryCode} ${n.name}`).join(', ')
          : 'Нет привязанных нод'}
      </p>
      <div className="row">
        <span className="muted">обновлён {relativeTime(profile.updatedAt)}</span>
        <span className="spacer" />
        <Button
          variant="danger"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          Удалить
        </Button>
      </div>
    </Card>
  )
}

export function ProfilesPage() {
  const profiles = useProfiles()
  const del = useDeleteProfile()
  const logout = useLogout()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [toDelete, setToDelete] = useState<Profile | null>(null)

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ marginBottom: 20 }}>
        <h1>Конфиг-профили</h1>
        <span className="spacer" />
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          Создать профиль
        </Button>
        <Button
          variant="ghost"
          onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}
        >
          Выйти
        </Button>
      </div>

      {profiles.isPending && <p className="muted">Загрузка профилей…</p>}
      {profiles.isError && <p className="field-error">{(profiles.error as Error).message}</p>}

      {profiles.data && profiles.data.length === 0 && (
        <EmptyState
          title="Профилей пока нет"
          hint="Создайте первый профиль — он сразу появится в панели Remnawave"
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              Создать профиль
            </Button>
          }
        />
      )}

      {profiles.data && profiles.data.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {profiles.data.map((p) => (
            <ProfileCard key={p.uuid} profile={p} onDelete={() => setToDelete(p)} />
          ))}
        </div>
      )}

      <CreateProfileDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <Dialog open={toDelete !== null} title="Удалить профиль" onClose={() => setToDelete(null)}>
        <p>
          Удалить профиль «{toDelete?.name}»? Это действие нельзя отменить — профиль исчезнет из панели
          Remnawave.
        </p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setToDelete(null)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            disabled={del.isPending}
            onClick={() => {
              if (toDelete) del.mutate(toDelete.uuid, { onSuccess: () => setToDelete(null) })
            }}
          >
            Удалить
          </Button>
        </div>
      </Dialog>
    </main>
  )
}
