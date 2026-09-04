import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ConflictError,
  useProfile,
  useProfileInbounds,
  useSaveProfile,
  useSquads,
  usePanelToken,
  type Profile,
  type ProfileInboundDetail,
  type SquadInfo,
} from '../../shared/api'
import { realityTargetsOf } from '../../entities/xray'
import type { GraphContext } from '../../entities/graph/types'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Chip, Dialog, EmptyState } from '../../shared/ui'
import { TopologyView } from '../topology/TopologyView'
import { SearchBox } from '../topology/SearchBox'
import { NodeInspector } from '../topology/NodeInspector'
import { TraceBar } from '../diagnostics/TraceBar'
import { TracePanel } from '../diagnostics/TracePanel'
import { GeoDataDialog } from '../diagnostics/GeoDataDialog'
import { CheckReportDialog } from '../diagnostics/CheckReportDialog'
import { RecipesDialog } from '../recipes/RecipesDialog'
import { useConfigDraft } from './useConfigDraft'
import { VersionsDialog } from './VersionsDialog'
import { ConfigSettingsDialog } from './ConfigSettingsDialog'
import { IssueList } from './IssueList'
import { PanelTokenNotice } from './PanelTokenNotice'
import { JsonView } from './JsonView'
import { ShortcutsDialog } from './ShortcutsDialog'
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
  const navigate = useNavigate()
  const qc = useQueryClient()
  const squads = useSquads()
  const panelToken = usePanelToken()
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
  const [resetOpen, setResetOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
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
            setConflict(err.current)
          }
        },
      },
    )
  }

  const saveError = save.isError && !(save.error instanceof ConflictError) ? (save.error as Error).message : undefined

  return (
    <div className="workbench">
      <header className="wb-topbar">
        <Button variant="ghost" onClick={() => navigate('/')}>
          ← Профили
        </Button>
        <div className="wb-title">
          <h1>{profile.name}</h1>
          <span className="eyebrow">обновлён {relativeTime(profile.updatedAt)}</span>
        </div>

        <div className="wb-iconbar">
          <Button
            aria-label="Отменить"
            title="Отменить (Ctrl+Z)"
            disabled={!draft.undoAvailable}
            onClick={draft.doUndo}
          >
            ↶
          </Button>
          <Button
            aria-label="Вернуть"
            title="Вернуть (Ctrl+Shift+Z)"
            disabled={!draft.redoAvailable}
            onClick={draft.doRedo}
          >
            ↷
          </Button>
          <Button
            aria-label="Горячие клавиши"
            title="Горячие клавиши (?)"
            onClick={() => draft.setShortcutsOpen(true)}
          >
            ?
          </Button>
        </div>

        <div className="segmented">
          <Button aria-pressed={draft.tab === 'topology'} onClick={draft.openTopologyTab}>
            Топология
          </Button>
          <Button aria-pressed={draft.tab === 'json'} onClick={draft.openJsonTab}>
            JSON
          </Button>
        </div>

        <span className="spacer" />
        {draft.dirty && <Chip dir="none">черновик</Chip>}
        <Button variant="ghost" disabled={parsedConfig === undefined} onClick={() => draft.setSettingsOpen(true)}>
          Настройки конфига
        </Button>
        <Button
          variant="ghost"
          disabled={parsedConfig === undefined}
          onClick={() => setCheckOpen(true)}
        >
          Проверить конфиг
        </Button>
        <Button variant="ghost" onClick={() => draft.setGeoOpen(true)}>
          Geo-базы
        </Button>
        <Button variant="ghost" onClick={() => setVersionsOpen(true)}>
          Версии
        </Button>
        <Button variant="ghost" disabled={!draft.dirty} onClick={() => setResetOpen(true)}>
          Сбросить к версии панели
        </Button>
        <Button variant="primary" disabled={draft.hasErrors || !draft.dirty || save.isPending} onClick={() => setSaveOpen(true)}>
          Сохранить в панель
        </Button>
      </header>

      <div className="wb-stage">
        {draft.tab === 'json' && (
          <div className="wb-canvas">
            <JsonView
              text={draft.text}
              reveal={draft.reveal}
              onChange={(value) => draft.writeDraft(value, { history: false })}
            />
          </div>
        )}
        {draft.tab === 'topology' && parsedConfig === undefined && (
          <div className="wb-canvas wb-canvas-empty">
            <EmptyState
              title="Конфиг не проходит валидацию"
              hint="Исправьте ошибки на вкладке JSON — топология строится по валидному документу."
            />
          </div>
        )}
        {draft.tab === 'topology' && parsedConfig !== undefined && (
          <>
            <div className="wb-canvas">
              <TopologyView
                profileUuid={profile.uuid}
                config={parsedConfig}
                ctx={draft.ctx}
                selectedId={draft.selectedNode}
                onSelect={draft.setSelectedNode}
                onChangeConfig={draft.changeConfig}
                trace={draft.trace}
                issues={draft.nodeIssues}
                focus={draft.focus}
                onOpenRecipes={() => setRecipesOpen(true)}
                dockExtra={
                  <>
                    <SearchBox
                      query={draft.searchQuery}
                      hits={draft.searchHits}
                      focusSignal={draft.searchFocus}
                      onQuery={draft.setSearchQuery}
                      onPick={draft.focusNode}
                    />
                    <Button aria-pressed={draft.traceOpen} onClick={draft.toggleTrace}>
                      Куда пойдёт трафик
                    </Button>
                  </>
                }
                dockRow={
                  draft.traceOpen ? (
                    <TraceBar value={draft.traceTarget} onChange={draft.setTraceTarget} />
                  ) : undefined
                }
              />
            </div>
            {draft.trace && (
              <TracePanel
                result={draft.trace}
                onClose={() => draft.setTraceTarget(null)}
                onSelectRule={(index) => draft.setSelectedNode(`rule:${index}`)}
                onOpenGeo={() => draft.setGeoOpen(true)}
              />
            )}
            {draft.selectedNode && (
              <NodeInspector
                key={draft.selectedNode}
                config={parsedConfig}
                nodeId={draft.selectedNode}
                inboundSquads={draft.ctx.inboundSquads}
                onApply={draft.applyNode}
                onMoveRule={draft.moveSelected}
                onRemove={draft.removeSelected}
                onSetupObservatory={draft.setupObservatory}
                onClose={() => draft.setSelectedNode(null)}
              />
            )}
          </>
        )}
      </div>

      <footer className="wb-statusbar">
        <div className="wb-status-head">
          {draft.validation.issues.length === 0 ? (
            <span className="muted">Конфиг валиден</span>
          ) : (
            <button
              type="button"
              className="wb-status-toggle"
              aria-expanded={draft.issuesOpen}
              onClick={() => draft.setIssuesOpen(!draft.issuesOpen)}
            >
              <span className="collapsible-marker" aria-hidden="true">
                ▸
              </span>
              {draft.errorCount > 0 && <span className="field-error">ошибок: {draft.errorCount}</span>}
              {draft.errorCount > 0 && draft.warningCount > 0 && <span aria-hidden="true">·</span>}
              {draft.warningCount > 0 && <span className="field-warning">предупреждений: {draft.warningCount}</span>}
            </button>
          )}
          <span className="spacer" />
          <PanelTokenNotice status={panelToken.data} />
          {saveError && <span className="field-error">{saveError}</span>}
        </div>
        {draft.issuesOpen && draft.validation.issues.length > 0 && (
          <div className="wb-status-body">
            <IssueList
              issues={draft.validation.issues}
              onSelect={draft.selectIssue}
              canSelect={draft.canSelectIssue}
            />
          </div>
        )}
      </footer>

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

      <Dialog open={resetOpen} title="Сбросить черновик" onClose={() => setResetOpen(false)}>
        <p>Отменить все локальные правки и вернуться к версии из панели?</p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setResetOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              draft.resetDraft()
              setResetOpen(false)
            }}
          >
            Сбросить
          </Button>
        </div>
      </Dialog>

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
        <ConfigSettingsDialog
          open={draft.settingsOpen}
          config={parsedConfig}
          onChange={draft.changeConfig}
          onClose={() => draft.setSettingsOpen(false)}
        />
      )}

      <ShortcutsDialog open={draft.shortcutsOpen} onClose={() => draft.setShortcutsOpen(false)} />

      <GeoDataDialog
        open={draft.geoOpen}
        onClose={() => draft.setGeoOpen(false)}
        onUseKey={draft.appendGeoKeyToRule}
      />

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

      <VersionsDialog
        open={versionsOpen}
        profileUuid={profile.uuid}
        profileName={profile.name}
        currentText={draft.text}
        onRestore={(configText) => {
          draft.writeDraft(configText, { history: true })
          draft.setSelectedNode(null)
        }}
        onClose={() => setVersionsOpen(false)}
      />
    </div>
  )
}

export function EditorPage() {
  const { uuid } = useParams<{ uuid: string }>()
  const profile = useProfile(uuid!)

  if (profile.isPending) return <main style={{ padding: 24 }} className="muted">Загрузка профиля…</main>
  if (profile.isError) return <main style={{ padding: 24 }} className="field-error">{(profile.error as Error).message}</main>
  return <EditorInner profile={profile.data} />
}
