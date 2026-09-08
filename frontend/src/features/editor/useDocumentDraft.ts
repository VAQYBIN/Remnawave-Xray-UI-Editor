// Ядро черновика: всё, что у редактора одинаково независимо от вида документа —
// черновик в localStorage, история, вкладки, выбор узла, поиск, флаги диалогов и
// хоткеи. Ни Xray, ни JSON здесь нет: разбор, счётчики проблем, адресация узлов и
// поиск приходят одним объектом — DocumentAdapter. Специфичное для документа
// живёт надстройкой (useConfigDraft для Xray).

import { useMemo, useRef, useState } from 'react'
import type { PathParts, TraceTarget, ValidationIssue } from '../../entities/xray'
import type { GraphContext, IssueCount } from '../../entities/graph/types'
import type { SearchHit } from '../../entities/graph/search'
import { docStorageKey, type DocKind } from '../../shared/lib/docKey'
import { hasOpenDialog, useHotkeys } from '../../shared/lib/useHotkeys'
import { useDraftStore, type Draft } from './draftStore'
import { canRedo, canUndo, useHistoryStore } from './historyStore'
import type { DocumentAdapter } from './documentAdapter'

export type { DocumentAdapter } from './documentAdapter'

export function resolveDraftText(draft: Draft | undefined, panelText: string): string {
  return draft ? draft.text : panelText
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

export interface DocumentDraftOptions<TModel> {
  /**
   * Вид документа. Uuid профиля и шаблона живут в разных пространствах панели и
   * могут совпасть, поэтому локальные хранилища ключуются видом вместе с uuid.
   * Не путать с `kind` у `Workbench`: там это сегмент пути бэкапов (`profiles`/
   * `templates`), а не ключ хранилища.
   */
  docKind: DocKind
  /** Uuid документа: уходит в запросы бэкапов, поэтому остаётся голым */
  docKey: string
  /** Документ, каким его отдала панель, — уже текстом */
  panelText: string
  /** Версия панели: updatedAt профиля либо хэш содержимого шаблона */
  baseVersion: string
  /** Контекст графа: у шаблона он пустой — сквадов там нет */
  ctx: GraphContext
  /** Всё, что ядро знает о виде документа */
  adapter: DocumentAdapter<TModel>
}

/**
 * Подмножество черновика, которое читает хром редактора (`EditorShell`), —
 * **без параметра модели**: топбар, статус-бар и общие диалоги одинаковы у Xray
 * и Mihomo, и знать разобранный документ им незачем. `DocumentDraft<TModel>`
 * расширяет этот интерфейс, поэтому хром принимает любой черновик как есть.
 */
export interface EditorShellDraft {
  /** Uuid документа: он же адрес бэкапов в панели */
  docKey: string
  text: string
  dirty: boolean
  issues: ValidationIssue[]
  errorCount: number
  warningCount: number

  tab: 'graph' | 'text'
  openGraphTab: () => void
  openTextTab: () => void

  undoAvailable: boolean
  redoAvailable: boolean
  doUndo: () => void
  doRedo: () => void

  canSelectIssue: (issue: ValidationIssue) => boolean
  selectIssue: (issue: ValidationIssue) => void

  issuesOpen: boolean
  setIssuesOpen: (open: boolean) => void
  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void

  writeDraft: (text: string, opts: { history: boolean }) => void
  /** Отменить локальные правки и вернуться к версии панели (сам шаг отменяем через undo) */
  resetDraft: () => void
  setSelectedNode: (id: string | null) => void
}

export interface DocumentDraft<TModel> extends EditorShellDraft {
  /** Ключ локальных хранилищ: `<вид>:<uuid>` — черновик, история, позиции узлов */
  storageKey: string
  /** Контекст графа, с которым построен документ: его же ждёт TopologyView */
  ctx: GraphContext
  /** Текст, каким его отдала панель: левая сторона сравнения при сохранении */
  panelText: string
  /** Версия, от которой отсчитывается черновик, — она уходит в сохранение */
  baseVersion: string
  /** Разобранный документ; undefined — текст не разбирается, граф не строится */
  model: TModel | undefined
  hasErrors: boolean
  nodeIssues: Record<string, IssueCount>

  selectedNode: string | null

  /** Сохранение прошло: черновик и история относятся к прежней базе */
  clearAfterSave: () => void
  /** Принять версию панели при конфликте: документ меняется целиком */
  adoptPanelVersion: () => void

  reveal: { parts: PathParts; nonce: number } | null
  /**
   * Перейти в текст и прокрутить к месту пути ОДНИМ действием. Порознь это не
   * собирается: `selectIssue` смотрит на `tab` из замыкания, и сразу после
   * `openTextTab()` там ещё старая вкладка — переход ушёл бы в ветку графа, а
   * вызывающий (инспектор узла) к этому моменту уже размонтирован вместе со
   * снятым выбором.
   */
  revealAt: (parts: PathParts) => void

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

  geoOpen: boolean
  setGeoOpen: (open: boolean) => void
}

export function useDocumentDraft<TModel>({
  docKind,
  docKey,
  panelText,
  baseVersion,
  ctx,
  adapter,
}: DocumentDraftOptions<TModel>): DocumentDraft<TModel> {
  // Черновик, история и позиции узлов ключуются видом документа вместе с uuid:
  // совпадение uuid профиля и шаблона иначе смешало бы два разных документа
  const storageKey = docStorageKey(docKind, docKey)
  const { drafts, setDraft, clearDraft } = useDraftStore()
  const { stacks, record, undo, redo, clear: clearHistory } = useHistoryStore()
  const stored = drafts[storageKey]
  const text = resolveDraftText(stored, panelText)
  const dirty = stored !== undefined && stored.text !== panelText
  // `||`, а не `??`: миграция v0 могла оставить пустую строку, и она не база
  const base = stored?.baseVersion || baseVersion

  // Единственная точка записи черновика: здесь же решается, попадает ли правка в историю
  function writeDraft(nextText: string, opts: { history: boolean }) {
    if (opts.history) record(storageKey, text)
    setDraft(storageKey, nextText, base)
  }

  const parsed = useMemo(() => adapter.parse(text), [adapter, text])
  const model = parsed.model
  const issues = parsed.issues
  const errorCount = issues.filter((i) => i.level === 'error').length
  const hasErrors = errorCount > 0
  const warningCount = issues.length - errorCount

  const [tab, setTab] = useState<'graph' | 'text'>('graph')
  // Текст на момент входа в текстовый редактор: вся текстовая сессия
  // сворачивается в один снимок истории при уходе с вкладки
  const textEntry = useRef<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  // Цель трассировки — инструмент, а не документ: в localStorage ей делать нечего
  const [traceOpen, setTraceOpen] = useState(false)
  const [traceTarget, setTraceTarget] = useState<TraceTarget | null>(null)
  const [geoOpen, setGeoOpen] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // Прокрутка к месту проблемы в тексте; nonce делает повторный клик рабочим
  const [reveal, setReveal] = useState<{ parts: PathParts; nonce: number } | null>(null)
  const revealNonce = useRef(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocus, setSearchFocus] = useState(0)
  const [focus, setFocus] = useState<{ nodeId: string; nonce: number } | null>(null)
  const focusNonce = useRef(0)

  const searchHits = useMemo(
    () => (model === undefined ? [] : adapter.search(model, ctx, searchQuery)),
    [adapter, model, ctx, searchQuery],
  )
  const nodeIssues = useMemo(
    () => (model === undefined ? {} : adapter.issueCounts(issues, model)),
    [adapter, issues, model],
  )

  // Переход зависит от вкладки: на графе ведём к узлу, в тексте — к месту.
  // Вкладку не переключаем: у части путей узла нет, и прыжок увёл бы в никуда.
  function canSelectIssue(issue: ValidationIssue): boolean {
    if (tab === 'text') return issue.parts.length > 0
    return model !== undefined && adapter.nodeIdForPath(issue.parts, model) !== null
  }

  function selectIssue(issue: ValidationIssue) {
    if (tab === 'text') {
      revealNonce.current += 1
      setReveal({ parts: issue.parts, nonce: revealNonce.current })
      return
    }
    const id = model === undefined ? null : adapter.nodeIdForPath(issue.parts, model)
    if (id) setSelectedNode(id)
  }

  const historyDisabled = tab === 'text'
  const undoAvailable = !historyDisabled && canUndo(stacks, storageKey)
  const redoAvailable = !historyDisabled && canRedo(stacks, storageKey)

  function doUndo() {
    const prev = undo(storageKey, text)
    if (prev === null) return
    setDraft(storageKey, prev, base)
    // Документ подменяется целиком — позиционные rule:N и inj:N дрейфуют
    setSelectedNode(null)
  }

  function doRedo() {
    const next = redo(storageKey, text)
    if (next === null) return
    setDraft(storageKey, next, base)
    setSelectedNode(null)
  }

  function openTextTab() {
    textEntry.current = text
    setTab('text')
    setSelectedNode(null)
    // Панель разбора живёт над канвасом — над текстовым редактором ей не место
    setTraceTarget(null)
    setTraceOpen(false)
  }

  function openGraphTab() {
    // Вся текстовая сессия сворачивается в один шаг истории
    const entry = textEntry.current
    if (entry !== null && entry !== text) record(storageKey, entry)
    textEntry.current = null
    setTab('graph')
  }

  useHotkeys([
    { combo: 'mod+z', handler: () => { if (undoAvailable) doUndo() } },
    { combo: 'mod+shift+z', handler: () => { if (redoAvailable) doRedo() } },
    { combo: 'mod+y', handler: () => { if (redoAvailable) doRedo() } },
    {
      combo: 'mod+f',
      // На текстовой вкладке Ctrl+F отдан поиску CodeMirror
      handler: () => { if (tab === 'graph') setSearchFocus((v) => v + 1) },
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
    storageKey,
    ctx,
    text,
    panelText,
    baseVersion: base,
    dirty,
    model,
    issues,
    hasErrors,
    errorCount,
    warningCount,
    nodeIssues,
    tab,
    openTextTab,
    openGraphTab,
    selectedNode,
    setSelectedNode,
    writeDraft,
    resetDraft: () => {
      // Сброс тоже отменяется: undo вернёт текст и создаст черновик заново
      record(storageKey, text)
      clearDraft(storageKey)
      setSelectedNode(null)
    },
    clearAfterSave: () => {
      clearDraft(storageKey)
      // База сместилась: прежние снимки относятся к другому документу
      clearHistory(storageKey)
    },
    adoptPanelVersion: () => {
      clearDraft(storageKey)
      clearHistory(storageKey)
      setSelectedNode(null)
    },
    undoAvailable,
    redoAvailable,
    doUndo,
    doRedo,
    reveal,
    revealAt: (parts) => {
      openTextTab()
      revealNonce.current += 1
      setReveal({ parts, nonce: revealNonce.current })
    },
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
    shortcutsOpen,
    setShortcutsOpen,
    geoOpen,
    setGeoOpen,
    issuesOpen,
    setIssuesOpen,
  }
}
