// Черновик шаблона Mihomo: ядро плюс операции правки ТЕКСТА. Единица правки —
// TextEdit[], а не новая модель: документ никогда не печатается заново.

import { useMemo, useState } from 'react'
import {
  addGroup,
  addRule,
  applyEdits,
  moveMihomoRule,
  originAt,
  removeFieldAt,
  removeGroup,
  removeRule,
  renameGroup,
  replaceRuleText,
  setFieldAt,
  setListAt,
  type FieldOrigin,
  type MihomoDoc,
  type TextEdit,
} from '../../entities/mihomo'
import { groupsOf } from '../../entities/mihomo/groups'
import {
  geoKeysOfMihomo,
  traceMihomo,
  type MihomoTraceResult,
  type RuleSetAnswers,
} from '../../entities/mihomo/trace'
import { ruleSetDescriptors } from '../../entities/mihomo/ruleSets'
import {
  connectMihomo,
  disconnectMihomo,
  type MihomoRefusal,
} from '../../entities/graph/mihomo/mutations'
import type { GeoAnswers, PathParts } from '../../entities/xray'
import type { GraphContext } from '../../entities/graph/types'
import { useGeoMatch, useRuleSetMatch, type RuleSetQuery } from '../../shared/api'
import { useDebounced } from '../../shared/lib/useDebounced'
import { useDocumentDraft, type DocumentDraft } from './useDocumentDraft'
import { mihomoAdapter } from './mihomoAdapter'

// Контекст графа у шаблона пуст: сквадов здесь нет. Константа, а не литерал в
// вызове — иначе новый объект на каждый рендер сбрасывал бы мемоизацию.
const NO_CONTEXT: GraphContext = {}

// Пока ответ базы не пришёл (или базы нет), трассировщик честно считает
// GEOSITE/GEOIP неизвестными и останавливает на них проход.
const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }

/**
 * Пауза, после которой строка трассировки считается введённой, — та же, что у
 * Xray (`useConfigDraft`): каждый символ адреса иначе дергал бы бэкенд, а
 * вердикты мигали бы на полуслове.
 */
const TRACE_DEBOUNCE_MS = 600

export interface MihomoDraftOptions {
  docKey: string
  panelText: string
  baseVersion: string
}

export interface MihomoDraft extends DocumentDraft<MihomoDoc> {
  /** Тот же `model`, названный по-человечески: формы читают именно документ */
  md: MihomoDoc | undefined
  setField: (parts: PathParts, key: string, value: string | boolean | number) => void
  removeField: (parts: PathParts, key: string) => void
  /**
   * Происхождение поля целиком, всеми четырьмя членами союза: `alias` и
   * `merged` формы показывают только на чтение. Сужать союз здесь нельзя —
   * иначе форма приняла бы значение из якоря за своё и предложила бы правку,
   * которую писатель всё равно отклонит.
   */
  originOf: (parts: PathParts, key: string) => FieldOrigin
  setListAt: (parts: PathParts, key: string, values: string[]) => void
  renameGroupTo: (index: number, name: string) => void
  addGroupNamed: (name: string) => void
  addRuleText: (raw: string, at?: number) => void
  replaceRule: (index: number, raw: string) => void
  moveSelected: (dir: -1 | 1) => void
  removeSelected: () => void
  connect: (source: string, target: string) => void
  disconnect: (edgeId: string) => void
  /** Разбор трассы; undefined — цель не задана либо документ не разбирается */
  trace: MihomoTraceResult | undefined
  refusal: MihomoRefusal | null
  dismissRefusal: () => void
  checkOpen: boolean
  setCheckOpen: (open: boolean) => void
  importOpen: boolean
  setImportOpen: (open: boolean) => void
  sectionsOpen: boolean
  setSectionsOpen: (open: boolean) => void
}

export function useMihomoDraft({
  docKey,
  panelText,
  baseVersion,
}: MihomoDraftOptions): MihomoDraft {
  const core = useDocumentDraft({
    docKind: 'template',
    docKey,
    panelText,
    baseVersion,
    ctx: NO_CONTEXT,
    adapter: mihomoAdapter,
  })
  const [refusal, setRefusal] = useState<MihomoRefusal | null>(null)
  const [checkOpen, setCheckOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [sectionsOpen, setSectionsOpen] = useState(false)
  const md = core.model

  // Считаем и спрашиваем базу, когда ввод затих: иначе каждый символ адреса
  // пересчитывал бы вердикты и дергал бэкенд
  const settledTarget = useDebounced(core.traceTarget, TRACE_DEBOUNCE_MS)
  // Спрашиваем базу только по тем ключам, что реально есть в правилах
  const geoKeys = useMemo(() => (md ? geoKeysOfMihomo(md) : []), [md])
  const geoQuery = useGeoMatch(
    settledTarget ? { domain: settledTarget.address, ip: settledTarget.ip, keys: geoKeys } : null,
  )

  // Наборы правил документа делятся надвое ещё до запроса. На бэкенд уходят
  // только те, чьё содержимое он способен достать: `http` и `inline`. Набор из
  // файла клиента и набор незнакомого вида сервер не увидит по определению —
  // спрашивать о них нечего, их состояние известно здесь и сейчас, и оно
  // подмешивается к ответу как `unavailable` со своей причиной. Промолчать о
  // них было бы хуже: трассировка сказала бы «содержимое редактору неизвестно»
  // и умолчала бы о том, ПОЧЕМУ оно неизвестно и что этого уже не изменить.
  const ruleSets = useMemo(() => (md ? ruleSetDescriptors(md) : []), [md])
  const askedSets = useMemo<RuleSetQuery[]>(() => {
    const asked: RuleSetQuery[] = []
    for (const set of ruleSets) {
      if (set.kind === 'http') {
        asked.push({
          name: set.name,
          kind: 'http',
          url: set.url,
          behavior: set.behavior,
          format: set.format,
          ...(set.intervalSec === undefined ? {} : { intervalSec: set.intervalSec }),
        })
      } else if (set.kind === 'inline') {
        asked.push({
          name: set.name,
          kind: 'inline',
          payload: set.payload,
          behavior: set.behavior,
          format: set.format,
        })
      }
    }
    return asked
  }, [ruleSets])
  // `proxy` в запрос не уходит: бэкенд ходит по ссылке напрямую и такое поле
  // всё равно отбросил бы. Расхождение содержимого с тем, что увидит клиент,
  // объясняется оговоркой трассировки, а не молчаливой отправкой лишнего поля.
  const localAnswers = useMemo(() => {
    const answers: RuleSetAnswers['answers'] = {}
    for (const set of ruleSets) {
      if (set.kind === 'file') {
        answers[set.name] = {
          state: 'unavailable',
          reason: 'набор лежит в файле у клиента — серверу такой файл недоступен',
        }
      } else if (set.kind === 'unsupported') {
        answers[set.name] = { state: 'unavailable', reason: set.reason }
      }
    }
    return answers
  }, [ruleSets])

  const ruleSetQuery = useRuleSetMatch(
    settledTarget
      ? { target: { address: settledTarget.address, ip: settledTarget.ip }, sets: askedSets }
      : null,
  )
  const ruleSetAnswers = useMemo<RuleSetAnswers>(
    () => ({
      answers: { ...localAnswers, ...(ruleSetQuery.data?.answers ?? {}) },
      // «Ещё едет» — это не «недоступен»: пока ответы в пути, трассировка
      // обязана останавливаться с ЭТОЙ причиной, а не выдавать промах
      pending: ruleSetQuery.isFetching,
    }),
    [localAnswers, ruleSetQuery.data, ruleSetQuery.isFetching],
  )

  const trace = useMemo(
    () =>
      md && settledTarget
        ? traceMihomo(md, settledTarget, geoQuery.data ?? NO_GEO, ruleSetAnswers)
        : undefined,
    [md, settledTarget, geoQuery.data, ruleSetAnswers],
  )

  /**
   * Наложить правки. Пустой список — не ошибка: операция отказала, и причину,
   * если она есть, показывает вызывающий. `select` передаётся явно там, где
   * выбор обязан переехать; `undefined` оставляет выбор как есть, `null` снимает.
   */
  function apply(edits: TextEdit[], select?: string | null) {
    if (edits.length === 0) return
    core.writeDraft(applyEdits(core.text, edits), { history: true })
    if (select !== undefined) core.setSelectedNode(select)
  }

  function selectedRuleIndex(): number | null {
    return core.selectedNode?.startsWith('rule:') ? Number(core.selectedNode.slice(5)) : null
  }

  function selectedGroupIndex(): number | null {
    if (md === undefined || !core.selectedNode?.startsWith('group:')) return null
    const name = core.selectedNode.slice(6)
    return groupsOf(md).find((g) => g.name === name)?.index ?? null
  }

  return {
    ...core,
    md,
    setField: (parts, key, value) => {
      if (md === undefined) return
      apply(setFieldAt(md, parts, key, value))
    },
    removeField: (parts, key) => {
      if (md === undefined) return
      apply(removeFieldAt(md, parts, key))
    },
    originOf: (parts, key) => (md === undefined ? 'absent' : originAt(md, parts, key)),
    setListAt: (parts, key, values) => {
      if (md === undefined) return
      apply(setListAt(md, parts, key, values))
    },
    renameGroupTo: (index, name) => {
      if (md === undefined) return
      const group = groupsOf(md).find((g) => g.index === index)
      if (group === undefined || group.name === name) return
      // Узел адресуется именем: без переноса выбора инспектор закрылся бы
      // прямо во время ввода — та же болезнь, что лечит renamedNodeId у Xray
      const select = core.selectedNode === `group:${group.name}` ? `group:${name}` : undefined
      apply(renameGroup(md, group.name, name), select)
    },
    addGroupNamed: (name) => {
      if (md === undefined) return
      apply(addGroup(md, name), `group:${name}`)
    },
    addRuleText: (raw, at) => {
      if (md === undefined) return
      apply(addRule(md, raw, at), null)
    },
    replaceRule: (index, raw) => {
      if (md === undefined) return
      // Строка правила переписывается целиком, но индекс не меняется — выбор
      // остаётся на том же узле, и трогать его незачем
      apply(replaceRuleText(md, index, raw))
    },
    moveSelected: (dir) => {
      const index = selectedRuleIndex()
      if (md === undefined || index === null) return
      const edits = moveMihomoRule(md, index, dir)
      if (edits.length === 0) return
      // Число правил не изменилось, но правило переехало — ведём выбор за ним
      apply(edits, `rule:${index + dir}`)
    },
    removeSelected: () => {
      if (md === undefined) return
      const ruleIndex = selectedRuleIndex()
      if (ruleIndex !== null) return apply(removeRule(md, ruleIndex), null)
      const groupIndex = selectedGroupIndex()
      if (groupIndex !== null) return apply(removeGroup(md, groupIndex), null)
    },
    connect: (source, target) => {
      if (md === undefined) return
      const res = connectMihomo(md, source, target)
      setRefusal(res.refusal ?? null)
      apply(res.edits)
    },
    disconnect: (edgeId) => {
      if (md === undefined) return
      const res = disconnectMihomo(md, edgeId)
      setRefusal(res.refusal ?? null)
      apply(res.edits)
    },
    trace,
    refusal,
    dismissRefusal: () => setRefusal(null),
    checkOpen,
    setCheckOpen,
    importOpen,
    setImportOpen,
    sectionsOpen,
    setSectionsOpen,
  }
}
