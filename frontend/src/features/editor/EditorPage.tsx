import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ConflictError,
  useProfile,
  useProfileInbounds,
  useGeoMatch,
  useSaveProfile,
  useSquads,
  type Profile,
  type ProfileInboundDetail,
  type SquadInfo,
} from '../../shared/api'
import {
  geoKeysOf,
  traceRoute,
  validateXrayConfig,
  type GeoAnswers,
  type TraceResult,
  type TraceTarget,
  type XrayConfig,
} from '../../entities/xray'
import type { GraphContext } from '../../entities/graph/types'
import { applyNodeJson, getNodeJson, moveRule, removeNode } from '../../entities/graph/mutations'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Chip, Dialog, EmptyState } from '../../shared/ui'
import { TopologyView } from '../topology/TopologyView'
import { NodeInspector } from '../topology/NodeInspector'
import { TraceBar } from '../diagnostics/TraceBar'
import { TracePanel } from '../diagnostics/TracePanel'
import { GeoDataDialog } from '../diagnostics/GeoDataDialog'
import { useDraftStore, type Draft } from './draftStore'
import { BackupsDialog } from './BackupsDialog'
import { ConfigSettingsDialog } from './ConfigSettingsDialog'
import { IssueList } from './IssueList'
import { JsonView } from './JsonView'
import { SaveDialog } from './SaveDialog'

export function formatConfig(config: unknown): string {
  return JSON.stringify(config, null, 2)
}

export function resolveEditorText(draft: Draft | undefined, panelConfig: unknown): string {
  return draft ? draft.text : formatConfig(panelConfig)
}

export function toGraphContext(
  squads: SquadInfo[] | undefined,
  inbounds: ProfileInboundDetail[] | undefined,
): GraphContext {
  const inboundSquads: Record<string, string[]> = {}
  for (const inb of inbounds ?? []) inboundSquads[inb.tag] = inb.activeSquads
  return { squads: squads ?? [], inboundSquads }
}

export function nextSelection(
  selected: string | null,
  prev: XrayConfig,
  next: XrayConfig,
): string | null {
  if (!selected) return null
  if (getNodeJson(next, selected) === undefined) return null
  // rule-узлы адресуются позиционно: при изменении числа правил id может
  // указывать на другое правило — сбрасываем выбор
  if (selected.startsWith('rule:')) {
    const prevLen = prev.routing?.rules?.length ?? 0
    const nextLen = next.routing?.rules?.length ?? 0
    if (prevLen !== nextLen) return null
  }
  return selected
}

// Пока ответ базы не пришёл (или базы нет), трассировщик честно считает
// geosite:/geoip: неизвестными и говорит об этом в caveats.
const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }

export function traceOf(
  config: XrayConfig | undefined,
  target: TraceTarget | null,
  geo: GeoAnswers | undefined,
): TraceResult | undefined {
  if (!config || !target) return undefined
  return traceRoute(config, target, geo ?? NO_GEO)
}

// Перестановка выбранного правила: конфиг меняется, а позиционный id выбора
// должен «переехать» вместе с правилом — иначе rule:N укажет на соседа
export function moveSelectedRule(
  config: XrayConfig,
  selected: string | null,
  dir: -1 | 1,
): { config: XrayConfig; selected: string } | null {
  if (!selected || !selected.startsWith('rule:')) return null
  const from = Number(selected.slice(5))
  const next = moveRule(config, from, dir)
  if (next === config) return null
  return { config: next, selected: `rule:${from + dir}` }
}

function EditorInner({ profile }: { profile: Profile }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { drafts, setDraft, clearDraft } = useDraftStore()
  const draft = drafts[profile.uuid]
  const text = resolveEditorText(draft, profile.config)
  const panelText = useMemo(() => formatConfig(profile.config), [profile.config])
  const dirty = draft !== undefined && draft.text !== panelText

  const validation = useMemo(() => validateXrayConfig(text), [text])
  const hasErrors = validation.issues.some((i) => i.level === 'error')

  const [tab, setTab] = useState<'topology' | 'json'>('topology')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  // Цель трассировки — инструмент, а не документ: в localStorage ей делать нечего
  const [traceOpen, setTraceOpen] = useState(false)
  const [traceTarget, setTraceTarget] = useState<TraceTarget | null>(null)
  const [geoOpen, setGeoOpen] = useState(false)
  const squads = useSquads()
  const panelInbounds = useProfileInbounds(profile.uuid)
  const ctx = useMemo(
    () => toGraphContext(squads.data, panelInbounds.data),
    [squads.data, panelInbounds.data],
  )
  // топология строится только по валидному (по схеме) документу
  const parsedConfig = validation.ok ? (validation.config as XrayConfig) : undefined
  // Спрашиваем базу только по тем ключам, что реально есть в правилах
  const geoKeys = useMemo(() => (parsedConfig ? geoKeysOf(parsedConfig) : []), [parsedConfig])
  const geoQuery = useGeoMatch(
    traceTarget ? { domain: traceTarget.address, ip: traceTarget.ip, keys: geoKeys } : null,
  )
  const trace = useMemo(
    () => traceOf(parsedConfig, traceTarget, geoQuery.data),
    [parsedConfig, traceTarget, geoQuery.data],
  )

  function changeConfig(next: XrayConfig) {
    setDraft(profile.uuid, formatConfig(next), draft?.baseUpdatedAt ?? profile.updatedAt)
    setSelectedNode((cur) => nextSelection(cur, parsedConfig!, next))
  }

  const save = useSaveProfile(profile.uuid)
  const [saveOpen, setSaveOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [backupsOpen, setBackupsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [conflict, setConflict] = useState<Profile | null>(null)

  function doSave(expectedUpdatedAt: string) {
    save.mutate(
      { config: validation.config, expectedUpdatedAt },
      {
        onSuccess: () => {
          clearDraft(profile.uuid)
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

  const errorCount = validation.issues.filter((i) => i.level === 'error').length
  const warningCount = validation.issues.length - errorCount
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

        <div className="segmented">
          <Button aria-pressed={tab === 'topology'} onClick={() => setTab('topology')}>
            Топология
          </Button>
          <Button
            aria-pressed={tab === 'json'}
            onClick={() => {
              setTab('json')
              setSelectedNode(null)
              // Панель разбора живёт над канвасом — над JSON-редактором ей не место
              setTraceTarget(null)
              setTraceOpen(false)
            }}
          >
            JSON
          </Button>
        </div>

        <span className="spacer" />
        {dirty && <Chip dir="none">черновик</Chip>}
        <Button variant="ghost" disabled={parsedConfig === undefined} onClick={() => setSettingsOpen(true)}>
          Настройки конфига
        </Button>
        <Button variant="ghost" onClick={() => setGeoOpen(true)}>
          Geo-базы
        </Button>
        <Button variant="ghost" onClick={() => setBackupsOpen(true)}>
          Бэкапы
        </Button>
        <Button variant="ghost" disabled={!dirty} onClick={() => setResetOpen(true)}>
          Сбросить к версии панели
        </Button>
        <Button variant="primary" disabled={hasErrors || !dirty || save.isPending} onClick={() => setSaveOpen(true)}>
          Сохранить в панель
        </Button>
      </header>

      <div className="wb-stage">
        {tab === 'json' && (
          <div className="wb-canvas">
            <JsonView
              text={text}
              onChange={(value) => setDraft(profile.uuid, value, draft?.baseUpdatedAt ?? profile.updatedAt)}
            />
          </div>
        )}
        {tab === 'topology' && parsedConfig === undefined && (
          <div className="wb-canvas wb-canvas-empty">
            <EmptyState
              title="Конфиг не проходит валидацию"
              hint="Исправьте ошибки на вкладке JSON — топология строится по валидному документу."
            />
          </div>
        )}
        {tab === 'topology' && parsedConfig !== undefined && (
          <>
            <div className="wb-canvas">
              <TopologyView
                profileUuid={profile.uuid}
                config={parsedConfig}
                ctx={ctx}
                selectedId={selectedNode}
                onSelect={setSelectedNode}
                onChangeConfig={changeConfig}
                trace={trace}
                dockExtra={
                  <>
                    <Button
                      aria-pressed={traceOpen}
                      onClick={() => {
                        setTraceOpen((v) => !v)
                        // Закрыли инструмент — снимаем и цель, иначе панель разбора висит
                        if (traceOpen) setTraceTarget(null)
                      }}
                    >
                      Трасса
                    </Button>
                    {traceOpen && <TraceBar value={traceTarget} onChange={setTraceTarget} />}
                  </>
                }
              />
            </div>
            {trace && (
              <TracePanel
                result={trace}
                onClose={() => setTraceTarget(null)}
                onSelectRule={(index) => setSelectedNode(`rule:${index}`)}
                onOpenGeo={() => setGeoOpen(true)}
              />
            )}
            {selectedNode && (
              <NodeInspector
                key={selectedNode}
                config={parsedConfig}
                nodeId={selectedNode}
                inboundSquads={ctx.inboundSquads}
                onApply={(value) => changeConfig(applyNodeJson(parsedConfig, selectedNode, value))}
                onMoveRule={(dir) => {
                  const moved = moveSelectedRule(parsedConfig, selectedNode, dir)
                  if (!moved) return
                  changeConfig(moved.config)
                  // Перекрывает nextSelection из changeConfig: число правил не изменилось,
                  // но правило переехало — выбор следует за ним
                  setSelectedNode(moved.selected)
                }}
                onRemove={() => {
                  changeConfig(removeNode(parsedConfig, selectedNode))
                  setSelectedNode(null)
                }}
                onClose={() => setSelectedNode(null)}
              />
            )}
          </>
        )}
      </div>

      <footer className="wb-statusbar">
        <div className="wb-status-head">
          {validation.issues.length === 0 ? (
            <span className="muted">Конфиг валиден</span>
          ) : (
            <button
              type="button"
              className="wb-status-toggle"
              aria-expanded={issuesOpen}
              onClick={() => setIssuesOpen((v) => !v)}
            >
              <span className="collapsible-marker" aria-hidden="true">
                ▸
              </span>
              {errorCount > 0 && <span className="field-error">ошибок: {errorCount}</span>}
              {errorCount > 0 && warningCount > 0 && <span aria-hidden="true">·</span>}
              {warningCount > 0 && <span className="field-warning">предупреждений: {warningCount}</span>}
            </button>
          )}
          <span className="spacer" />
          {saveError && <span className="field-error">{saveError}</span>}
        </div>
        {issuesOpen && validation.issues.length > 0 && (
          <div className="wb-status-body">
            <IssueList issues={validation.issues} />
          </div>
        )}
      </footer>

      <SaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        original={panelText}
        modified={text}
        issues={validation.issues}
        busy={save.isPending}
        onConfirm={() => doSave(draft?.baseUpdatedAt ?? profile.updatedAt)}
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
              clearDraft(profile.uuid)
              setSelectedNode(null)
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
              clearDraft(profile.uuid)
              // Конфиг подменяется целиком — сбрасываем выбор узла (позиционные rule-id дрейфуют)
              setSelectedNode(null)
              qc.setQueryData(['profiles', profile.uuid], conflict)
              qc.invalidateQueries({ queryKey: ['profiles'], exact: true })
              setConflict(null)
            }}
          >
            Загрузить версию панели
          </Button>
          <Button
            variant="danger"
            disabled={save.isPending || hasErrors}
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
          open={settingsOpen}
          config={parsedConfig}
          onChange={changeConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <GeoDataDialog open={geoOpen} onClose={() => setGeoOpen(false)} />

      <BackupsDialog
        open={backupsOpen}
        profileUuid={profile.uuid}
        onRestore={(configText) => {
          setDraft(profile.uuid, configText, draft?.baseUpdatedAt ?? profile.updatedAt)
          setSelectedNode(null)
        }}
        onClose={() => setBackupsOpen(false)}
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
