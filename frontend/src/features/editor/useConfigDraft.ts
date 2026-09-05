// Документ, который правит редактор: черновик в localStorage, история, валидация,
// выбор узла, вкладки, поиск и трассировка. Профильного здесь нет ничего — тот же
// хук обслуживает шаблон подписки. Страница добавляет к нему только своё
// сохранение и свои кнопки топбара.

import { useMemo, useRef, useState } from 'react'
import {
  ensureObservatorySection,
  geoKeysOf,
  traceRoute,
  validateXrayConfig,
  type GeoAnswers,
  type PathParts,
  type TraceResult,
  type TraceTarget,
  type ValidationIssue,
  type XrayConfig,
} from '../../entities/xray'
import { issueCountsByNode, nodeIdForPath } from '../../entities/graph/locate'
import { searchNodes, type SearchHit } from '../../entities/graph/search'
import {
  appendGeoKey,
  applyNodeJson,
  getNodeJson,
  moveRule,
  removeNode,
} from '../../entities/graph/mutations'
import type { GraphContext, IssueCount } from '../../entities/graph/types'
import { useGeoMatch } from '../../shared/api'
import { useDebounced } from '../../shared/lib/useDebounced'
import { hasOpenDialog, useHotkeys } from '../../shared/lib/useHotkeys'
import { useDraftStore, type Draft } from './draftStore'
import { canRedo, canUndo, useHistoryStore } from './historyStore'

export function formatConfig(config: unknown): string {
  return JSON.stringify(config, null, 2)
}

export function resolveEditorText(draft: Draft | undefined, panelConfig: unknown): string {
  return draft ? draft.text : formatConfig(panelConfig)
}

export function nextSelection(
  selected: string | null,
  prev: XrayConfig,
  next: XrayConfig,
): string | null {
  if (!selected) return null
  if (getNodeJson(next, selected) === undefined) return null
  // rule- и inj-узлы адресуются позиционно: при изменении их числа id укажет на
  // соседа — сбрасываем выбор
  if (selected.startsWith('rule:')) {
    const prevLen = prev.routing?.rules?.length ?? 0
    const nextLen = next.routing?.rules?.length ?? 0
    if (prevLen !== nextLen) return null
  }
  if (selected.startsWith('inj:')) {
    const prevLen = prev.remnawave?.injectHosts?.length ?? 0
    const nextLen = next.remnawave?.injectHosts?.length ?? 0
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
 * Новый id узла, если правка сменила его тег: id inbound'а и outbound'а — это его
 * тег, поэтому после переименования выбор нужно вести за узлом, иначе инспектор
 * закрывается прямо во время редактирования.
 */
export function renamedNodeId(nodeId: string, value: unknown): string | null {
  const prefix = nodeId.startsWith('in:')
    ? 'in:'
    : nodeId.startsWith('out:')
      ? 'out:'
      : nodeId.startsWith('bal:')
        ? 'bal:'
        : null
  if (prefix === null) return null
  if (typeof value !== 'object' || value === null) return null
  const tag = (value as { tag?: unknown }).tag
  if (typeof tag !== 'string' || tag === '') return null
  const next = `${prefix}${tag}`
  return next === nodeId ? null : next
}

export interface ConfigDraftOptions {
  /** Ключ документа: uuid профиля или шаблона. По нему живут черновик, история и позиции узлов */
  docKey: string
  /** Документ, каким его отдала панель */
  panelConfig: unknown
  /** Версия панели: updatedAt профиля либо хэш содержимого шаблона */
  baseVersion: string
  /** Контекст графа: у шаблона он пустой — сквадов там нет */
  ctx: GraphContext
}

export interface ConfigDraft {
  docKey: string
  /** Контекст графа, с которым построен документ: его же ждёт TopologyView */
  ctx: GraphContext
  text: string
  /** Текст, каким его отдала панель: левая сторона сравнения при сохранении */
  panelText: string
  /** Версия, от которой отсчитывается черновик, — она уходит в сохранение */
  baseVersion: string
  dirty: boolean
  validation: ReturnType<typeof validateXrayConfig>
  /** Разобранный конфиг; undefined — документ не проходит схему, топология не строится */
  parsedConfig: XrayConfig | undefined
  hasErrors: boolean
  errorCount: number
  warningCount: number
  nodeIssues: Record<string, IssueCount>

  tab: 'topology' | 'json'
  openJsonTab: () => void
  openTopologyTab: () => void

  selectedNode: string | null
  setSelectedNode: (id: string | null) => void

  writeDraft: (text: string, opts: { history: boolean }) => void
  changeConfig: (next: XrayConfig) => void
  /** Отменить локальные правки и вернуться к версии панели (сам шаг отменяем через undo) */
  resetDraft: () => void
  /** Сохранение прошло: черновик и история относятся к прежней базе */
  clearAfterSave: () => void
  /** Принять версию панели при конфликте: документ меняется целиком */
  adoptPanelVersion: () => void

  undoAvailable: boolean
  redoAvailable: boolean
  doUndo: () => void
  doRedo: () => void

  reveal: { parts: PathParts; nonce: number } | null
  canSelectIssue: (issue: ValidationIssue) => boolean
  selectIssue: (issue: ValidationIssue) => void

  searchQuery: string
  setSearchQuery: (value: string) => void
  searchFocus: number
  searchHits: SearchHit[]
  focus: { nodeId: string; nonce: number } | null
  /** Выбрать узел и подвести к нему холст (из поиска) */
  focusNode: (nodeId: string) => void

  traceOpen: boolean
  toggleTrace: () => void
  traceTarget: TraceTarget | null
  setTraceTarget: (target: TraceTarget | null) => void
  trace: TraceResult | undefined

  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
  geoOpen: boolean
  setGeoOpen: (open: boolean) => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  issuesOpen: boolean
  setIssuesOpen: (open: boolean) => void

  /** Применить правку узла из инспектора */
  applyNode: (value: unknown) => void
  /** Переставить выбранное правило */
  moveSelected: (dir: -1 | 1) => void
  /** Удалить выбранный узел */
  removeSelected: () => void
  /** Дописать geo-категорию в открытое правило либо завести новое */
  appendGeoKeyToRule: (key: string) => void
  setupObservatory: (kind: 'observatory' | 'burst', subjects: string[]) => void
}

export function useConfigDraft({
  docKey,
  panelConfig,
  baseVersion,
  ctx,
}: ConfigDraftOptions): ConfigDraft {
  const { drafts, setDraft, clearDraft } = useDraftStore()
  const { stacks, record, undo, redo, clear: clearHistory } = useHistoryStore()
  const stored = drafts[docKey]
  const text = resolveEditorText(stored, panelConfig)
  const panelText = useMemo(() => formatConfig(panelConfig), [panelConfig])
  const dirty = stored !== undefined && stored.text !== panelText
  // `||`, а не `??`: миграция v0 могла оставить пустую строку, и она не база
  const base = stored?.baseVersion || baseVersion

  // Единственная точка записи черновика: здесь же решается, попадает ли правка в историю
  function writeDraft(nextText: string, opts: { history: boolean }) {
    if (opts.history) record(docKey, text)
    setDraft(docKey, nextText, base)
  }

  const validation = useMemo(() => validateXrayConfig(text), [text])
  const errorCount = validation.issues.filter((i) => i.level === 'error').length
  const hasErrors = errorCount > 0
  const warningCount = validation.issues.length - errorCount

  const [tab, setTab] = useState<'topology' | 'json'>('topology')
  // Текст на момент входа в JSON-редактор: вся текстовая сессия сворачивается
  // в один снимок истории при уходе с вкладки
  const jsonEntryText = useRef<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  // Цель трассировки — инструмент, а не документ: в localStorage ей делать нечего
  const [traceOpen, setTraceOpen] = useState(false)
  const [traceTarget, setTraceTarget] = useState<TraceTarget | null>(null)
  const [geoOpen, setGeoOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // Прокрутка к месту проблемы в JSON; nonce делает повторный клик рабочим
  const [reveal, setReveal] = useState<{ parts: PathParts; nonce: number } | null>(null)
  const revealNonce = useRef(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocus, setSearchFocus] = useState(0)
  const [focus, setFocus] = useState<{ nodeId: string; nonce: number } | null>(null)
  const focusNonce = useRef(0)

  // топология строится только по валидному (по схеме) документу
  const parsedConfig = validation.ok ? (validation.config as XrayConfig) : undefined
  // Считаем и спрашиваем базу, когда ввод затих: иначе каждый символ адреса
  // пересчитывал бы граф и дергал бэкенд, а вердикты мигали бы на полуслове
  const settledTarget = useDebounced(traceTarget, TRACE_DEBOUNCE_MS)
  // Спрашиваем базу только по тем ключам, что реально есть в правилах
  const geoKeys = useMemo(() => (parsedConfig ? geoKeysOf(parsedConfig) : []), [parsedConfig])
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
    // Без разобранного документа менять нечего: nextSelection читает prev.routing,
    // а вызов приходит теперь и снаружи хука
    if (!parsedConfig) return
    writeDraft(formatConfig(next), { history: true })
    setSelectedNode((cur) => nextSelection(cur, parsedConfig, next))
  }

  const historyDisabled = tab === 'json'
  const undoAvailable = !historyDisabled && canUndo(stacks, docKey)
  const redoAvailable = !historyDisabled && canRedo(stacks, docKey)

  function doUndo() {
    const prev = undo(docKey, text)
    if (prev === null) return
    setDraft(docKey, prev, base)
    // Конфиг подменяется целиком — позиционные rule:N и inj:N дрейфуют
    setSelectedNode(null)
  }

  function doRedo() {
    const next = redo(docKey, text)
    if (next === null) return
    setDraft(docKey, next, base)
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
    if (entry !== null && entry !== text) record(docKey, entry)
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

  return {
    docKey,
    ctx,
    text,
    panelText,
    baseVersion: base,
    dirty,
    validation,
    parsedConfig,
    hasErrors,
    errorCount,
    warningCount,
    nodeIssues,
    tab,
    openJsonTab,
    openTopologyTab,
    selectedNode,
    setSelectedNode,
    writeDraft,
    changeConfig,
    resetDraft: () => {
      // Сброс тоже отменяется: undo вернёт текст и создаст черновик заново
      record(docKey, text)
      clearDraft(docKey)
      setSelectedNode(null)
    },
    clearAfterSave: () => {
      clearDraft(docKey)
      // База сместилась: прежние снимки относятся к другому документу
      clearHistory(docKey)
    },
    adoptPanelVersion: () => {
      clearDraft(docKey)
      clearHistory(docKey)
      setSelectedNode(null)
    },
    undoAvailable,
    redoAvailable,
    doUndo,
    doRedo,
    reveal,
    canSelectIssue,
    selectIssue,
    searchQuery,
    setSearchQuery,
    searchFocus,
    searchHits,
    focus,
    focusNode: (nodeId) => {
      setSelectedNode(nodeId)
      focusNonce.current += 1
      setFocus({ nodeId, nonce: focusNonce.current })
      setSearchQuery('')
    },
    traceOpen,
    toggleTrace: () => {
      setTraceOpen((v) => !v)
      // Закрыли инструмент — снимаем и цель, иначе панель разбора висит
      if (traceOpen) setTraceTarget(null)
    },
    traceTarget,
    setTraceTarget,
    trace,
    shortcutsOpen,
    setShortcutsOpen,
    geoOpen,
    setGeoOpen,
    settingsOpen,
    setSettingsOpen,
    issuesOpen,
    setIssuesOpen,
    applyNode: (value) => {
      if (!parsedConfig || !selectedNode) return
      changeConfig(applyNodeJson(parsedConfig, selectedNode, value))
      // Тег сменился — сменился и id узла: перекрываем сброс выбора из changeConfig
      const renamed = renamedNodeId(selectedNode, value)
      if (renamed !== null) setSelectedNode(renamed)
    },
    moveSelected: (dir) => {
      if (!parsedConfig) return
      const moved = moveSelectedRule(parsedConfig, selectedNode, dir)
      if (!moved) return
      changeConfig(moved.config)
      // Перекрывает nextSelection: число правил не изменилось, но правило переехало
      setSelectedNode(moved.selected)
    },
    removeSelected: () => {
      if (!parsedConfig || !selectedNode) return
      changeConfig(removeNode(parsedConfig, selectedNode))
      setSelectedNode(null)
    },
    appendGeoKeyToRule: (key) => {
      if (!parsedConfig) return
      // Категория дописывается в открытое правило, иначе создаётся новое
      const ruleIndex = selectedNode?.startsWith('rule:') ? Number(selectedNode.slice(5)) : null
      const res = appendGeoKey(parsedConfig, ruleIndex, key)
      if (res.config !== parsedConfig) changeConfig(res.config)
      // Перекрывает сброс выбора: показываем, куда попала категория
      setSelectedNode(`rule:${res.ruleIndex}`)
      setGeoOpen(false)
    },
    setupObservatory: (kind, subjects) => {
      if (!parsedConfig) return
      changeConfig(ensureObservatorySection(parsedConfig, kind, subjects))
      setSelectedNode('obs')
    },
  }
}
