// Черновик конфига Xray: всё, что знает про Xray редактор профиля и шаблона
// подписки. Общая машинерия (черновик в localStorage, история, вкладки, выбор
// узла, поиск, хоткеи) живёт в ядре `useDocumentDraft` и о виде документа не
// знает — сюда добавляются разбор конфига, трассировка и правки графа.

import { useMemo, useState } from 'react'
import {
  ensureObservatorySection,
  geoKeysOf,
  traceRoute,
  validateXrayConfig,
  type GeoAnswers,
  type TraceResult,
  type TraceTarget,
  type XrayConfig,
} from '../../entities/xray'
import {
  appendGeoKey,
  applyNodeJson,
  getNodeJson,
  moveRule,
  removeNode,
} from '../../entities/graph/mutations'
import type { GraphContext } from '../../entities/graph/types'
import { useGeoMatch } from '../../shared/api'
import { type DocKind } from '../../shared/lib/docKey'
import { useDebounced } from '../../shared/lib/useDebounced'
import type { Draft } from './draftStore'
import { useDocumentDraft, type DocumentDraft } from './useDocumentDraft'
import { xrayAdapter } from './xrayAdapter'

// Escape одинаков для любого документа и живёт в ядре; реэкспорт — чтобы
// вызывающим не пришлось знать, в каком слое он оказался
export { escapeTarget } from './useDocumentDraft'

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
  /**
   * Вид документа. Uuid профиля и шаблона живут в разных пространствах панели и
   * могут совпасть, поэтому локальные хранилища ключуются видом вместе с uuid.
   * Не путать с `kind` у `Workbench`: там это сегмент пути бэкапов (`profiles`/
   * `templates`), а не ключ хранилища.
   */
  docKind: DocKind
  /** Uuid документа: уходит в запросы бэкапов, поэтому остаётся голым */
  docKey: string
  /** Документ, каким его отдала панель */
  panelConfig: unknown
  /** Версия панели: updatedAt профиля либо хэш содержимого шаблона */
  baseVersion: string
  /** Контекст графа: у шаблона он пустой — сквадов там нет */
  ctx: GraphContext
}

export interface ConfigDraft extends DocumentDraft<XrayConfig> {
  validation: ReturnType<typeof validateXrayConfig>
  /** Разобранный конфиг; undefined — документ не проходит схему, топология не строится */
  parsedConfig: XrayConfig | undefined
  changeConfig: (next: XrayConfig) => void
  trace: TraceResult | undefined
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
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
  docKind,
  docKey,
  panelConfig,
  baseVersion,
  ctx,
}: ConfigDraftOptions): ConfigDraft {
  const panelText = useMemo(() => formatConfig(panelConfig), [panelConfig])
  const core = useDocumentDraft({
    docKind,
    docKey,
    panelText,
    baseVersion,
    ctx,
    adapter: xrayAdapter,
  })
  const [settingsOpen, setSettingsOpen] = useState(false)

  const parsedConfig = core.model
  // validation остаётся публичной: страницы шлют validation.config в панель,
  // а SaveDialog показывает validation.issues
  const validation = useMemo(() => validateXrayConfig(core.text), [core.text])

  // Считаем и спрашиваем базу, когда ввод затих: иначе каждый символ адреса
  // пересчитывал бы граф и дергал бэкенд, а вердикты мигали бы на полуслове
  const settledTarget = useDebounced(core.traceTarget, TRACE_DEBOUNCE_MS)
  // Спрашиваем базу только по тем ключам, что реально есть в правилах
  const geoKeys = useMemo(() => (parsedConfig ? geoKeysOf(parsedConfig) : []), [parsedConfig])
  const geoQuery = useGeoMatch(
    settledTarget ? { domain: settledTarget.address, ip: settledTarget.ip, keys: geoKeys } : null,
  )
  const trace = useMemo(
    () => traceOf(parsedConfig, settledTarget, geoQuery.data),
    [parsedConfig, settledTarget, geoQuery.data],
  )

  function changeConfig(next: XrayConfig) {
    // Без разобранного документа менять нечего: nextSelection читает prev.routing,
    // а вызов приходит теперь и снаружи хука
    if (!parsedConfig) return
    core.writeDraft(formatConfig(next), { history: true })
    core.setSelectedNode(nextSelection(core.selectedNode, parsedConfig, next))
  }

  return {
    ...core,
    validation,
    parsedConfig,
    changeConfig,
    trace,
    settingsOpen,
    setSettingsOpen,
    applyNode: (value) => {
      if (!parsedConfig || !core.selectedNode) return
      changeConfig(applyNodeJson(parsedConfig, core.selectedNode, value))
      // Тег сменился — сменился и id узла: перекрываем сброс выбора из changeConfig
      const renamed = renamedNodeId(core.selectedNode, value)
      if (renamed !== null) core.setSelectedNode(renamed)
    },
    moveSelected: (dir) => {
      if (!parsedConfig) return
      const moved = moveSelectedRule(parsedConfig, core.selectedNode, dir)
      if (!moved) return
      changeConfig(moved.config)
      // Перекрывает nextSelection: число правил не изменилось, но правило переехало
      core.setSelectedNode(moved.selected)
    },
    removeSelected: () => {
      if (!parsedConfig || !core.selectedNode) return
      changeConfig(removeNode(parsedConfig, core.selectedNode))
      core.setSelectedNode(null)
    },
    appendGeoKeyToRule: (key) => {
      if (!parsedConfig) return
      // Категория дописывается в открытое правило, иначе создаётся новое
      const ruleIndex = core.selectedNode?.startsWith('rule:')
        ? Number(core.selectedNode.slice(5))
        : null
      const res = appendGeoKey(parsedConfig, ruleIndex, key)
      if (res.config !== parsedConfig) changeConfig(res.config)
      // Перекрывает сброс выбора: показываем, куда попала категория
      core.setSelectedNode(`rule:${res.ruleIndex}`)
      core.setGeoOpen(false)
    },
    setupObservatory: (kind, subjects) => {
      if (!parsedConfig) return
      changeConfig(ensureObservatorySection(parsedConfig, kind, subjects))
      core.setSelectedNode('obs')
    },
  }
}
