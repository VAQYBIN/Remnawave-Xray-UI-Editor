import { useMemo, useRef, useState } from 'react'
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
  realityTargetsOf,
  traceRoute,
  validateXrayConfig,
  type GeoAnswers,
  type PathParts,
  type TraceResult,
  type TraceTarget,
  type ValidationIssue,
  type XrayConfig,
} from '../../entities/xray'
import type { GraphContext } from '../../entities/graph/types'
import {
  appendGeoKey,
  applyNodeJson,
  getNodeJson,
  moveRule,
  removeNode,
} from '../../entities/graph/mutations'
import { issueCountsByNode, nodeIdForPath } from '../../entities/graph/locate'
import { searchNodes } from '../../entities/graph/search'
import { relativeTime } from '../../shared/lib/relativeTime'
import { useDebounced } from '../../shared/lib/useDebounced'
import { hasOpenDialog, useHotkeys } from '../../shared/lib/useHotkeys'
import { Button, Chip, Dialog, EmptyState } from '../../shared/ui'
import { TopologyView } from '../topology/TopologyView'
import { SearchBox } from '../topology/SearchBox'
import { NodeInspector } from '../topology/NodeInspector'
import { TraceBar } from '../diagnostics/TraceBar'
import { TracePanel } from '../diagnostics/TracePanel'
import { GeoDataDialog } from '../diagnostics/GeoDataDialog'
import { CheckReportDialog } from '../diagnostics/CheckReportDialog'
import { RecipesDialog } from '../recipes/RecipesDialog'
import { useDraftStore, type Draft } from './draftStore'
import { canRedo, canUndo, useHistoryStore } from './historyStore'
import { VersionsDialog } from './VersionsDialog'
import { ConfigSettingsDialog } from './ConfigSettingsDialog'
import { IssueList } from './IssueList'
import { JsonView } from './JsonView'
import { ShortcutsDialog } from './ShortcutsDialog'
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

/**
 * Пауза, после которой строка трассировки считается введённой. 600 мс: доменное
 * имя к этому моменту дописано, а ощущения «подвисло» ещё нет — секунда с лишним
 * читалась бы как задержка интерфейса.
 */
const TRACE_DEBOUNCE_MS = 600

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

/**
 * Что закрывает Escape. Порядок — от самого «верхнего» слоя к нижнему: сначала
 * инспектор узла, потом панель разбора трассы, потом результаты поиска.
 */
export function escapeTarget(state: {
  selectedNode: string | null
  traceTarget: TraceTarget | null
  searchQuery: string
}): 'inspector' | 'trace' | 'search' | null {
  if (state.selectedNode) return 'inspector'
  if (state.traceTarget) return 'trace'
  if (state.searchQuery.trim() !== '') return 'search'
  return null
}

/**
 * Новый id узла, если правка сменила его тег: id inbound'а и outbound'а —
 * это его тег, поэтому после переименования выбор нужно вести за узлом,
 * иначе инспектор закрывается прямо во время редактирования.
 */
export function renamedNodeId(nodeId: string, value: unknown): string | null {
  const prefix = nodeId.startsWith('in:') ? 'in:' : nodeId.startsWith('out:') ? 'out:' : null
  if (prefix === null) return null
  if (typeof value !== 'object' || value === null) return null
  const tag = (value as { tag?: unknown }).tag
  if (typeof tag !== 'string' || tag === '') return null
  const next = `${prefix}${tag}`
  return next === nodeId ? null : next
}

function EditorInner({ profile }: { profile: Profile }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { drafts, setDraft, clearDraft } = useDraftStore()
  const { stacks, record, undo, redo, clear: clearHistory } = useHistoryStore()
  const draft = drafts[profile.uuid]
  const text = resolveEditorText(draft, profile.config)
  const panelText = useMemo(() => formatConfig(profile.config), [profile.config])
  const dirty = draft !== undefined && draft.text !== panelText

  // Единственная точка записи черновика: здесь же решается, попадает ли правка в историю
  function writeDraft(nextText: string, opts: { history: boolean }) {
    if (opts.history) record(profile.uuid, text)
    setDraft(profile.uuid, nextText, draft?.baseUpdatedAt ?? profile.updatedAt)
  }

  const validation = useMemo(() => validateXrayConfig(text), [text])
  const hasErrors = validation.issues.some((i) => i.level === 'error')

  const [tab, setTab] = useState<'topology' | 'json'>('topology')
  // Текст на момент входа в JSON-редактор: вся текстовая сессия сворачивается
  // в один снимок истории при уходе с вкладки
  const jsonEntryText = useRef<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  // Цель трассировки — инструмент, а не документ: в localStorage ей делать нечего
  const [traceOpen, setTraceOpen] = useState(false)
  const [traceTarget, setTraceTarget] = useState<TraceTarget | null>(null)
  const [geoOpen, setGeoOpen] = useState(false)
  const [recipesOpen, setRecipesOpen] = useState(false)
  const [checkOpen, setCheckOpen] = useState(false)
  // Прокрутка к месту проблемы в JSON; nonce делает повторный клик рабочим
  const [reveal, setReveal] = useState<{ parts: PathParts; nonce: number } | null>(null)
  const revealNonce = useRef(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocus, setSearchFocus] = useState(0)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [focus, setFocus] = useState<{ nodeId: string; nonce: number } | null>(null)
  const focusNonce = useRef(0)
  const squads = useSquads()
  const panelInbounds = useProfileInbounds(profile.uuid)
  const ctx = useMemo(
    () => toGraphContext(squads.data, panelInbounds.data),
    [squads.data, panelInbounds.data],
  )
  // топология строится только по валидному (по схеме) документу
  const parsedConfig = validation.ok ? (validation.config as XrayConfig) : undefined
  // Считаем и спрашиваем базу, когда ввод затих: иначе каждый символ адреса
  // пересчитывал бы граф и дергал бэкенд, а вердикты мигали бы на полуслове
  const settledTarget = useDebounced(traceTarget, TRACE_DEBOUNCE_MS)
  // Спрашиваем базу только по тем ключам, что реально есть в правилах
  const geoKeys = useMemo(() => (parsedConfig ? geoKeysOf(parsedConfig) : []), [parsedConfig])
  const realityTargets = useMemo(
    () => (parsedConfig ? realityTargetsOf(parsedConfig) : []),
    [parsedConfig],
  )
  const searchHits = useMemo(
    () => (parsedConfig ? searchNodes(parsedConfig, ctx, searchQuery) : []),
    [parsedConfig, ctx, searchQuery],
  )
  const nodeIssues = useMemo(
    () => (parsedConfig ? issueCountsByNode(validation.issues, parsedConfig) : {}),
    [validation.issues, parsedConfig],
  )
  const geoQuery = useGeoMatch(
    settledTarget ? { domain: settledTarget.address, ip: settledTarget.ip, keys: geoKeys } : null,
  )
  const trace = useMemo(
    () => traceOf(parsedConfig, settledTarget, geoQuery.data),
    [parsedConfig, settledTarget, geoQuery.data],
  )

  // Переход зависит от вкладки: на топологии ведём к узлу, в JSON — к месту в тексте.
  // Вкладку не переключаем: у log/policy узла нет, и прыжок увёл бы в никуда.
  function canSelectIssue(issue: ValidationIssue): boolean {
    if (tab === 'json') return issue.parts.length > 0
    return parsedConfig !== undefined && nodeIdForPath(issue.parts, parsedConfig) !== null
  }

  function selectIssue(issue: ValidationIssue) {
    if (tab === 'json') {
      revealNonce.current += 1
      setReveal({ parts: issue.parts, nonce: revealNonce.current })
      return
    }
    const id = parsedConfig ? nodeIdForPath(issue.parts, parsedConfig) : null
    if (id) setSelectedNode(id)
  }

  function changeConfig(next: XrayConfig) {
    writeDraft(formatConfig(next), { history: true })
    setSelectedNode((cur) => nextSelection(cur, parsedConfig!, next))
  }

  const historyDisabled = tab === 'json'
  const undoAvailable = !historyDisabled && canUndo(stacks, profile.uuid)
  const redoAvailable = !historyDisabled && canRedo(stacks, profile.uuid)

  function doUndo() {
    const prev = undo(profile.uuid, text)
    if (prev === null) return
    setDraft(profile.uuid, prev, draft?.baseUpdatedAt ?? profile.updatedAt)
    // Конфиг подменяется целиком — позиционные rule:N дрейфуют
    setSelectedNode(null)
  }

  function doRedo() {
    const next = redo(profile.uuid, text)
    if (next === null) return
    setDraft(profile.uuid, next, draft?.baseUpdatedAt ?? profile.updatedAt)
    setSelectedNode(null)
  }

  function openJsonTab() {
    jsonEntryText.current = text
    setTab('json')
    setSelectedNode(null)
    // Панель разбора живёт над канвасом — над JSON-редактором ей не место
    setTraceTarget(null)
    setTraceOpen(false)
  }

  function openTopologyTab() {
    // Вся текстовая сессия сворачивается в один шаг истории
    const entry = jsonEntryText.current
    if (entry !== null && entry !== text) record(profile.uuid, entry)
    jsonEntryText.current = null
    setTab('topology')
  }

  useHotkeys([
    { combo: 'mod+z', handler: () => { if (undoAvailable) doUndo() } },
    { combo: 'mod+shift+z', handler: () => { if (redoAvailable) doRedo() } },
    { combo: 'mod+y', handler: () => { if (redoAvailable) doRedo() } },
    {
      combo: 'mod+f',
      // На вкладке JSON Ctrl+F отдан поиску CodeMirror
      handler: () => { if (tab === 'topology') setSearchFocus((v) => v + 1) },
    },
    {
      combo: 'Escape',
      // Нативный <dialog> закрывается по Escape сам — не мешаем и не отменяем действие
      preventDefault: false,
      whenEditable: true,
      handler: () => {
        if (hasOpenDialog()) return
        const target = escapeTarget({ selectedNode, traceTarget, searchQuery })
        if (target === 'inspector') setSelectedNode(null)
        if (target === 'trace') setTraceTarget(null)
        if (target === 'search') setSearchQuery('')
      },
    },
    { combo: '?', handler: () => setShortcutsOpen(true) },
  ])

  const save = useSaveProfile(profile.uuid)
  const [saveOpen, setSaveOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [conflict, setConflict] = useState<Profile | null>(null)

  function doSave(expectedUpdatedAt: string) {
    save.mutate(
      { config: validation.config, expectedUpdatedAt },
      {
        onSuccess: () => {
          clearDraft(profile.uuid)
          // База сместилась: прежние снимки относятся к другому документу
          clearHistory(profile.uuid)
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

        <div className="wb-iconbar">
          <Button
            aria-label="Отменить"
            title="Отменить (Ctrl+Z)"
            disabled={!undoAvailable}
            onClick={doUndo}
          >
            ↶
          </Button>
          <Button
            aria-label="Вернуть"
            title="Вернуть (Ctrl+Shift+Z)"
            disabled={!redoAvailable}
            onClick={doRedo}
          >
            ↷
          </Button>
          <Button
            aria-label="Горячие клавиши"
            title="Горячие клавиши (?)"
            onClick={() => setShortcutsOpen(true)}
          >
            ?
          </Button>
        </div>

        <div className="segmented">
          <Button aria-pressed={tab === 'topology'} onClick={openTopologyTab}>
            Топология
          </Button>
          <Button aria-pressed={tab === 'json'} onClick={openJsonTab}>
            JSON
          </Button>
        </div>

        <span className="spacer" />
        {dirty && <Chip dir="none">черновик</Chip>}
        <Button variant="ghost" disabled={parsedConfig === undefined} onClick={() => setSettingsOpen(true)}>
          Настройки конфига
        </Button>
        <Button
          variant="ghost"
          disabled={parsedConfig === undefined}
          onClick={() => setCheckOpen(true)}
        >
          Проверить конфиг
        </Button>
        <Button variant="ghost" onClick={() => setGeoOpen(true)}>
          Geo-базы
        </Button>
        <Button variant="ghost" onClick={() => setVersionsOpen(true)}>
          Версии
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
              reveal={reveal}
              onChange={(value) => writeDraft(value, { history: false })}
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
                issues={nodeIssues}
                focus={focus}
                onOpenRecipes={() => setRecipesOpen(true)}
                dockExtra={
                  <>
                    <SearchBox
                      query={searchQuery}
                      hits={searchHits}
                      focusSignal={searchFocus}
                      onQuery={setSearchQuery}
                      onPick={(nodeId) => {
                        setSelectedNode(nodeId)
                        focusNonce.current += 1
                        setFocus({ nodeId, nonce: focusNonce.current })
                        setSearchQuery('')
                      }}
                    />
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
                onApply={(value) => {
                  changeConfig(applyNodeJson(parsedConfig, selectedNode, value))
                  // Тег сменился — сменился и id узла: перекрываем сброс выбора из changeConfig
                  const renamed = renamedNodeId(selectedNode, value)
                  if (renamed !== null) setSelectedNode(renamed)
                }}
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
            <IssueList
              issues={validation.issues}
              onSelect={selectIssue}
              canSelect={canSelectIssue}
            />
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
              // Сброс тоже отменяется: undo вернёт текст и создаст черновик заново
              record(profile.uuid, text)
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
              clearHistory(profile.uuid)
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

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <GeoDataDialog
        open={geoOpen}
        onClose={() => setGeoOpen(false)}
        onUseKey={(key) => {
          if (parsedConfig === undefined) return
          // Категория дописывается в открытое правило, иначе создаётся новое
          const ruleIndex = selectedNode?.startsWith('rule:') ? Number(selectedNode.slice(5)) : null
          const res = appendGeoKey(parsedConfig, ruleIndex, key)
          if (res.config !== parsedConfig) changeConfig(res.config)
          // Перекрывает сброс выбора из changeConfig: показываем, куда попала категория
          setSelectedNode(`rule:${res.ruleIndex}`)
          setGeoOpen(false)
        }}
      />

      {parsedConfig !== undefined && (
        <RecipesDialog
          open={recipesOpen}
          config={parsedConfig}
          onApply={(next) => {
            changeConfig(next)
            // Правила рецепта вставляются в начало: позиционные rule:N сдвигаются
            setSelectedNode(null)
          }}
          onOpenGeo={() => {
            setRecipesOpen(false)
            setGeoOpen(true)
          }}
          onClose={() => setRecipesOpen(false)}
        />
      )}

      <CheckReportDialog
        open={checkOpen}
        config={validation.config}
        targets={realityTargets}
        onClose={() => setCheckOpen(false)}
        onOpenGeo={() => {
          setCheckOpen(false)
          setGeoOpen(true)
        }}
      />

      <VersionsDialog
        open={versionsOpen}
        profileUuid={profile.uuid}
        profileName={profile.name}
        currentText={text}
        onRestore={(configText) => {
          writeDraft(configText, { history: true })
          setSelectedNode(null)
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
