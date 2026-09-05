import { useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  causeOf,
  hintOf,
  useDeleteTemplate,
  useLogout,
  useTemplates,
  type SubscriptionTemplate,
  type TemplateType,
} from '../../shared/api'
import { Button, Card, Chip, Dialog, EmptyState } from '../../shared/ui'
import { useDraftStore } from '../editor/draftStore'
import { SectionSwitch } from '../nav/SectionSwitch'
import { usePositionsStore } from '../topology/positionsStore'
import { CreateTemplateDialog } from './CreateTemplateDialog'

// Редактор умеет пока только этот тип; остальные пять (MIHOMO, CLASH, STASH,
// SINGBOX, XRAY_BASE64) держат содержимое в другом поле и правятся в панели.
const EDITABLE: TemplateType = 'XRAY_JSON'

function TemplateCard({
  template,
  hasDraft,
  index,
  onDelete,
}: {
  template: SubscriptionTemplate
  hasDraft: boolean
  index: number
  onDelete: () => void
}) {
  const editable = template.templateType === EDITABLE
  return (
    // Карточки въезжают волной — тот же язык появления, что у узлов графа
    <Card className="profile-card" style={{ '--enter-delay': `${Math.min(index, 8) * 45}ms` } as CSSProperties}>
      <div className="row">
        <h2>
          {editable ? (
            <Link className="card-link" to={`/templates/${template.uuid}`}>
              {template.name}
            </Link>
          ) : (
            template.name
          )}
        </h2>
        <span className="spacer" />
        <Chip dir="none">{template.templateType}</Chip>
        {hasDraft && <Chip dir="none">черновик</Chip>}
        <button type="button" className="icon-btn" aria-label="Удалить" onClick={onDelete}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {!editable && (
        // Прятать такие шаблоны нельзя: список обязан отражать панель целиком
        <p className="muted">Редактор пока не поддерживает этот тип — откройте в панели Remnawave.</p>
      )}

      {template.tags?.length ? (
        <div className="row-wrap">
          {template.tags.map((t) => (
            <Chip key={t} dir="none">
              {t}
            </Chip>
          ))}
        </div>
      ) : null}
    </Card>
  )
}

export function TemplatesPage() {
  const templates = useTemplates()
  const del = useDeleteTemplate()
  const logout = useLogout()
  const navigate = useNavigate()
  const drafts = useDraftStore((s) => s.drafts)
  const [createOpen, setCreateOpen] = useState(false)
  const [toDelete, setToDelete] = useState<SubscriptionTemplate | null>(null)

  const total = templates.data?.length ?? 0

  return (
    <main className="page">
      <div className="masthead">
        <div className="masthead-mark">
          <span className="eyebrow">remnawave · xray</span>
          <h1>Шаблоны подписок</h1>
        </div>
        <SectionSwitch />
        <span className="spacer" />
        {total > 0 && <span className="muted">шаблонов: {total}</span>}
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          Создать шаблон
        </Button>
        <Button variant="ghost" onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}>
          Выйти
        </Button>
      </div>

      {templates.isPending && <p className="muted">Загрузка шаблонов…</p>}
      {templates.isError && (
        <div className="field-error">
          <p>{(templates.error as Error).message}</p>
          {hintOf(templates.error) && <p className="field-hint">{hintOf(templates.error)}</p>}
          {causeOf(templates.error) && <p className="muted">{causeOf(templates.error)}</p>}
        </div>
      )}

      {templates.data && templates.data.length === 0 && (
        <EmptyState
          title="Шаблонов пока нет"
          hint="Создайте первый — он сразу появится в панели Remnawave"
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              Создать шаблон
            </Button>
          }
        />
      )}

      {templates.data && templates.data.length > 0 && (
        <div className="profile-grid">
          {templates.data.map((t, i) => (
            <TemplateCard
              key={t.uuid}
              template={t}
              index={i}
              hasDraft={drafts[t.uuid] !== undefined}
              onDelete={() => setToDelete(t)}
            />
          ))}
        </div>
      )}

      <CreateTemplateDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <Dialog open={toDelete !== null} title="Удалить шаблон" onClose={() => setToDelete(null)}>
        <p>
          Удалить шаблон «{toDelete?.name}»? Это действие нельзя отменить — шаблон исчезнет из панели
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
