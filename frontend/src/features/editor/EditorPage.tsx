import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ConflictError,
  useProfile,
  useProfileInbounds,
  useSaveProfile,
  useSquads,
  type Profile,
  type ProfileInboundDetail,
  type SquadInfo,
} from '../../shared/api'
import { realityTargetsOf } from '../../entities/xray'
import type { GraphContext } from '../../entities/graph/types'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Dialog } from '../../shared/ui'
import { CheckReportDialog } from '../diagnostics/CheckReportDialog'
import { RecipesDialog } from '../recipes/RecipesDialog'
import { useConfigDraft } from './useConfigDraft'
import { Workbench } from './Workbench'
import { SaveDialog } from './SaveDialog'

export function toGraphContext(
  squads: SquadInfo[] | undefined,
  inbounds: ProfileInboundDetail[] | undefined,
): GraphContext {
  const inboundSquads: Record<string, string[]> = {}
  for (const inb of inbounds ?? []) inboundSquads[inb.tag] = inb.activeSquads
  return { squads: squads ?? [], inboundSquads }
}

function EditorInner({ profile }: { profile: Profile }) {
  const qc = useQueryClient()
  const squads = useSquads()
  const panelInbounds = useProfileInbounds(profile.uuid)
  const ctx = useMemo(
    () => toGraphContext(squads.data, panelInbounds.data),
    [squads.data, panelInbounds.data],
  )
  const draft = useConfigDraft({
    docKey: profile.uuid,
    panelConfig: profile.config,
    baseVersion: profile.updatedAt,
    ctx,
  })
  const parsedConfig = draft.parsedConfig
  const [recipesOpen, setRecipesOpen] = useState(false)
  const [checkOpen, setCheckOpen] = useState(false)
  // Проверка Reality-целей — профильная кнопка: список берём из документа
  const realityTargets = useMemo(
    () => (parsedConfig ? realityTargetsOf(parsedConfig) : []),
    [parsedConfig],
  )

  const save = useSaveProfile(profile.uuid)
  const [saveOpen, setSaveOpen] = useState(false)
  const [conflict, setConflict] = useState<Profile | null>(null)

  function doSave(expectedUpdatedAt: string) {
    save.mutate(
      { config: draft.validation.config, expectedUpdatedAt },
      {
        onSuccess: () => {
          draft.clearAfterSave()
          setSaveOpen(false)
          setConflict(null)
        },
        onError: (err) => {
          if (err instanceof ConflictError) {
            setSaveOpen(false)
            // Роут профилей отдаёт в `current` профиль — сужаем на границе
            setConflict(err.current as Profile)
          }
        },
      },
    )
  }

  const saveError = save.isError && !(save.error instanceof ConflictError) ? (save.error as Error).message : undefined

  return (
    <Workbench
      draft={draft}
      kind="profiles"
      back={{ to: '/', label: '← Профили' }}
      title={profile.name}
      subtitle={`обновлён ${relativeTime(profile.updatedAt)}`}
      onOpenRecipes={() => setRecipesOpen(true)}
      actions={
        <Button
          variant="ghost"
          disabled={parsedConfig === undefined}
          onClick={() => setCheckOpen(true)}
        >
          Проверить конфиг
        </Button>
      }
      save={
        <Button variant="primary" disabled={draft.hasErrors || !draft.dirty || save.isPending} onClick={() => setSaveOpen(true)}>
          Сохранить в панель
        </Button>
      }
      statusExtra={saveError ? <span className="field-error">{saveError}</span> : undefined}
    >
      <SaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        original={draft.panelText}
        modified={draft.text}
        issues={draft.validation.issues}
        busy={save.isPending}
        onConfirm={() => doSave(draft.baseVersion)}
        error={save.isError && !(save.error instanceof ConflictError) ? (save.error as Error).message : undefined}
      />

      <Dialog open={conflict !== null} title="Конфликт версий" onClose={() => setConflict(null)}>
        <p>
          Профиль был изменён в панели после открытия
          {conflict && <> (обновлён {relativeTime(conflict.updatedAt)})</>}. Выберите, что делать:
        </p>
        <div className="row">
          <span className="spacer" />
          <Button
            variant="ghost"
            onClick={() => {
              if (!conflict) return
              draft.adoptPanelVersion()
              qc.setQueryData(['profiles', profile.uuid], conflict)
              qc.invalidateQueries({ queryKey: ['profiles'], exact: true })
              setConflict(null)
            }}
          >
            Загрузить версию панели
          </Button>
          <Button
            variant="danger"
            disabled={save.isPending || draft.hasErrors}
            onClick={() => {
              if (conflict) doSave(conflict.updatedAt)
            }}
          >
            Перезаписать
          </Button>
        </div>
      </Dialog>

      {parsedConfig !== undefined && (
        <RecipesDialog
          open={recipesOpen}
          config={parsedConfig}
          onApply={(next) => {
            draft.changeConfig(next)
            // Правила рецепта вставляются в начало: позиционные rule:N сдвигаются
            draft.setSelectedNode(null)
          }}
          onOpenGeo={() => {
            setRecipesOpen(false)
            draft.setGeoOpen(true)
          }}
          onClose={() => setRecipesOpen(false)}
        />
      )}

      <CheckReportDialog
        open={checkOpen}
        config={draft.validation.config}
        profileUuid={profile.uuid}
        targets={realityTargets}
        onClose={() => setCheckOpen(false)}
        onOpenGeo={() => {
          setCheckOpen(false)
          draft.setGeoOpen(true)
        }}
      />
    </Workbench>
  )
}

export function EditorPage() {
  const { uuid } = useParams<{ uuid: string }>()
  const profile = useProfile(uuid!)

  if (profile.isPending) return <main style={{ padding: 24 }} className="muted">Загрузка профиля…</main>
  if (profile.isError) return <main style={{ padding: 24 }} className="field-error">{(profile.error as Error).message}</main>
  // key: при переходе между двумя закэшированными профилями компонент иначе не
  // размонтируется, и выбранный узел, вкладка и цель трассировки переезжают на
  // чужой документ — а позиционные id правил там указывают уже не туда
  return <EditorInner key={profile.data.uuid} profile={profile.data} />
}
