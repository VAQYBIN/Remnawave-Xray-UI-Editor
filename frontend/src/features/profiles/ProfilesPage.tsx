import { useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDeleteProfile, useLogout, useProfiles, type PanelInboundView, type Profile } from '../../shared/api'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Card, Chip, Dialog, EmptyState } from '../../shared/ui'
import { useDraftStore } from '../editor/draftStore'
import { usePositionsStore } from '../topology/positionsStore'
import { CreateProfileDialog } from './CreateProfileDialog'

const MAX_INBOUNDS = 3

// Профиль в списке — тот же приборный язык, что у узлов графа: тег, затем
// ячейки порта, транспорта и шифрования.
function InboundRow({ inbound }: { inbound: PanelInboundView }) {
  return (
    <div className="profile-inbound">
      <span className="profile-inbound-tag">{inbound.tag}</span>
      <span className="metrics">
        {inbound.port != null && <span className="metric metric-accent">:{inbound.port}</span>}
        {inbound.network && <span className="metric">{inbound.network}</span>}
        {inbound.security && inbound.security !== 'none' && (
          <span className="metric metric-accent">{inbound.security}</span>
        )}
      </span>
    </div>
  )
}

function ProfileCard({
  profile,
  hasDraft,
  index,
  onDelete,
}: {
  profile: Profile
  hasDraft: boolean
  index: number
  onDelete: () => void
}) {
  const shown = profile.inbounds.slice(0, MAX_INBOUNDS)
  const hidden = profile.inbounds.length - shown.length

  return (
    // Карточки въезжают волной — тот же язык появления, что у узлов графа
    <Card className="profile-card" style={{ '--enter-delay': `${Math.min(index, 8) * 45}ms` } as CSSProperties}>
      <div className="row">
        <h2>
          <Link className="card-link" to={`/profiles/${profile.uuid}`}>
            {profile.name}
          </Link>
        </h2>
        <span className="spacer" />
        {hasDraft && <Chip dir="none">черновик</Chip>}
        <button type="button" className="icon-btn" aria-label="Удалить" onClick={onDelete}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {profile.inbounds.length > 0 ? (
        <div className="profile-inbounds">
          {shown.map((inb) => (
            <InboundRow key={inb.uuid} inbound={inb} />
          ))}
          {hidden > 0 && <span className="muted">и ещё {hidden}</span>}
        </div>
      ) : (
        <span className="muted">Нет inbound'ов</span>
      )}

      <div className="profile-foot">
        <span className="row-wrap">
          {profile.nodes.length > 0 ? (
            profile.nodes.map((n) => (
              <Chip key={n.uuid} dir="none">
                {n.countryCode} · {n.name}
              </Chip>
            ))
          ) : (
            <span>Нет привязанных нод</span>
          )}
        </span>
        <span className="spacer" />
        <span>обновлён {relativeTime(profile.updatedAt)}</span>
      </div>
    </Card>
  )
}

export function ProfilesPage() {
  const profiles = useProfiles()
  const del = useDeleteProfile()
  const logout = useLogout()
  const navigate = useNavigate()
  const drafts = useDraftStore((s) => s.drafts)
  const [createOpen, setCreateOpen] = useState(false)
  const [toDelete, setToDelete] = useState<Profile | null>(null)

  const total = profiles.data?.length ?? 0
  const draftCount = profiles.data?.filter((p) => drafts[p.uuid] !== undefined).length ?? 0

  return (
    <main className="page">
      <div className="masthead">
        <div className="masthead-mark">
          <span className="eyebrow">remnawave · xray</span>
          <h1>Конфиг-профили</h1>
        </div>
        <span className="spacer" />
        {/* Черновики лежат в localStorage и до сих пор были видны только внутри
            редактора — на списке это единственная подсказка, что правки не сохранены */}
        {draftCount > 0 && <Chip dir="none">незасейвленных черновиков: {draftCount}</Chip>}
        {total > 0 && <span className="muted">профилей: {total}</span>}
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          Создать профиль
        </Button>
        <Button variant="ghost" onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}>
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
        <div className="profile-grid">
          {profiles.data.map((p, i) => (
            <ProfileCard
              key={p.uuid}
              profile={p}
              index={i}
              hasDraft={drafts[p.uuid] !== undefined}
              onDelete={() => setToDelete(p)}
            />
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
              if (toDelete) {
                del.mutate(toDelete.uuid, {
                  onSuccess: () => {
                    useDraftStore.getState().clearDraft(toDelete.uuid)
                    usePositionsStore.getState().resetPositions(toDelete.uuid)
                    setToDelete(null)
                  },
                })
              }
            }}
          >
            Удалить
          </Button>
        </div>
      </Dialog>
    </main>
  )
}
