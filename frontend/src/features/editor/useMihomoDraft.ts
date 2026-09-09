// Черновик шаблона Mihomo: хук — писатель (`DocWriter`) поверх `applyMihomoOps`.
// Правка существующего собственного однострочного скаляра — сплайс по
// диапазону, всё структурное — модель `Document` с перепечаткой; писатель сам
// решает режим (`entities/mihomo/write.ts`), хук об этом не знает.

import { useCallback, useMemo, useRef, useState } from 'react'
import type { MihomoDoc } from '../../entities/mihomo'
import { applyMihomoOps, materializeAt, mihomoLockAt } from '../../entities/mihomo/write'
import { renameAt, renameRefusalText, type NamedKind } from '../../entities/mihomo/refs'
import type { DocOp, DocWriter, Lock, SchemaPath } from '../../shared/schema'
import { effectiveTarget,
  geoKeysOfMihomo,
  geoKeysOfRuleSetLines,
  traceMihomo,
  type MihomoTraceResult,
  type RuleSetAnswers,
} from '../../entities/mihomo/trace'
import {
  FILE_SET_REASON,
  ruleSetDescriptors,
  type RuleSetDescriptor,
} from '../../entities/mihomo/ruleSets'
import {
  connectMihomo,
  disconnectMihomo,
  refusalText,
} from '../../entities/graph/mihomo/mutations'
import {
  formatPath,
  type GeoAnswers,
  type PathParts,
  type ValidationIssue,
} from '../../entities/xray'
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
  /** Писатель поверх `applyMihomoOps`: формы по схеме адресуют поле путём, а не голым индексом */
  writer: DocWriter
  /** Применить операции; select — перенести выбор (null — снять), undefined — оставить */
  applyOps: (ops: DocOp[], select?: string | null) => void
  lockAt: (path: SchemaPath) => Lock | null
  materialize: (path: SchemaPath) => void
  /** Переименование с переносом ссылок; null — успех, иначе текст отказа */
  rename: (kind: NamedKind, from: string, to: string) => string | null
  connect: (source: string, target: string) => void
  disconnect: (edgeIds: string[]) => void
  /** Разбор трассы; undefined — цель не задана либо документ не разбирается */
  trace: MihomoTraceResult | undefined
  /** Текст отказа кабеля или писателя; null — отказа нет */
  refusal: string | null
  dismissRefusal: () => void
  checkOpen: boolean
  setCheckOpen: (open: boolean) => void
  importOpen: boolean
  setImportOpen: (open: boolean) => void
  ruleSetsOpen: boolean
  setRuleSetsOpen: (open: boolean) => void
  recipesOpen: boolean
  setRecipesOpen: (open: boolean) => void
  /** Дескрипторы наборов документа: их же показывает диалог «Наборы правил» */
  ruleSets: RuleSetDescriptor[]
  /** Что из них сервер способен достать — только это и уходит на него */
  askedSets: RuleSetQuery[]
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
  const [refusal, setRefusal] = useState<string | null>(null)
  const [checkOpen, setCheckOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [ruleSetsOpen, setRuleSetsOpen] = useState(false)
  const [recipesOpen, setRecipesOpen] = useState(false)
  const md = core.model

  // Ref со свежим документом: writer обязан держать тождество между рендерами
  // (формы memo'ят по нему), а операции — читать актуальный md, не тот, что
  // был на момент создания замыкания при монтировании
  const mdRef = useRef(md)
  mdRef.current = md

  // Ref со свежим `core`: находка ревью — `core.writeDraft`/`core.setSelectedNode`
  // объявлены ПЛОСКИМИ функциями внутри `useDocumentDraft` и получают новое
  // тождество на каждый рендер (`useDocumentDraft.ts`, там их не мемоизируют).
  // Список зависимостей `[core.writeDraft, core.setSelectedNode]` у `useCallback`
  // поэтому менялся на каждый рендер, и вся цепочка `applyOpsNow` → `lockAt` →
  // `writer` пересобиралась вхолостую — комментарий про «тождество держится»
  // был неправдой. Лечится тем же приёмом, что у `useSingboxDraft.ts`
  // (`coreRef`): callback читает `core.*` из ref ВНУТРИ вызова, а не из
  // замыкания, и зависит только от того, что вправду стабильно (`[]` или
  // другой такой же callback).
  const coreRef = useRef(core)
  coreRef.current = core

  // Считаем и спрашиваем базу, когда ввод затих: иначе каждый символ адреса
  // пересчитывал бы вердикты и дергал бэкенд
  const settled = useDebounced(core.traceTarget, TRACE_DEBOUNCE_MS)
  // Оба запроса спрашивают по ВЫВЕДЕННОЙ цели, а не по сырой: адрес-IP обязан
  // доехать до бэкенда как адрес назначения, иначе набор подсетей и правило
  // IP-CIDR из документа ответят на один вопрос по-разному
  const settledTarget = useMemo(() => (settled ? effectiveTarget(settled) : settled), [settled])

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
          reason: FILE_SET_REASON,
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

  /**
   * Запрос мог и не доехать: сеть, 500, тело больше предела роута. Ответов
   * тогда нет ВООБЩЕ, и каждое правило `RULE-SET` вырождается в «содержимое
   * редактору неизвестно» — настоящая причина теряется по дороге. Называем её
   * по каждому спрошенному набору, тем же способом, каким называется отказ,
   * приехавший с сервера.
   */
  const failedAnswers = useMemo<RuleSetAnswers['answers']>(() => {
    if (!ruleSetQuery.isError) return {}
    const reason = `запрос к серверу не удался: ${(ruleSetQuery.error as Error).message}`
    const answers: RuleSetAnswers['answers'] = {}
    for (const set of askedSets) answers[set.name] = { state: 'unavailable', reason }
    return answers
  }, [ruleSetQuery.isError, ruleSetQuery.error, askedSets])

  // Порядок склейки — от менее к более точному; ответ сервера перекрывает всё
  const ruleSetAnswers = useMemo<RuleSetAnswers>(
    () => ({
      answers: { ...localAnswers, ...failedAnswers, ...(ruleSetQuery.data?.answers ?? {}) },
      // «Ещё едет» — это не «недоступен»: пока ответы в пути, трассировка
      // обязана останавливаться с ЭТОЙ причиной, а не выдавать промах
      pending: ruleSetQuery.isFetching,
    }),
    [localAnswers, failedAnswers, ruleSetQuery.data, ruleSetQuery.isFetching],
  )

  // Строки набора `classical` — такие же правила Mihomo, и GEOSITE/GEOIP в них
  // надо спрашивать наравне с правилами документа. Ключи приезжают вторым
  // кругом: пока набор не скачан, знать о них неоткуда — поэтому запрос к базе
  // после прихода наборов уходит ещё раз, и это не лишний вызов, а
  // единственный способ узнать вопрос
  const setGeoKeys = useMemo(() => {
    const lines: string[] = []
    for (const answer of Object.values(ruleSetQuery.data?.answers ?? {})) {
      if (answer.state === 'lines') lines.push(...answer.lines)
    }
    return geoKeysOfRuleSetLines(lines)
  }, [ruleSetQuery.data])

  const geoKeys = useMemo(() => {
    const fromDoc = md ? geoKeysOfMihomo(md) : []
    return [...new Set([...fromDoc, ...setGeoKeys])]
  }, [md, setGeoKeys])
  const geoQuery = useGeoMatch(
    settledTarget ? { domain: settledTarget.address, ip: settledTarget.ip, keys: geoKeys } : null,
  )

  const trace = useMemo(
    () =>
      md && settledTarget
        ? traceMihomo(md, settledTarget, geoQuery.data ?? NO_GEO, ruleSetAnswers)
        : undefined,
    [md, settledTarget, geoQuery.data, ruleSetAnswers],
  )

  /**
   * Недоступный набор — ПРЕДУПРЕЖДЕНИЕ, а не ошибка: документ от нашей
   * неспособности скачать чужой файл корректным быть не перестаёт, и клиент его
   * загрузит. Поэтому сохранение не блокируется.
   *
   * Пока цель трассировки не задана, сетевых ответов нет — и предупреждений о
   * них тоже: утверждать, что набор недоступен, не спросив о нём, было бы
   * выдумкой. А про набор из файла клиента и про незнакомый вид сказать можно
   * сразу: их состояние от сети не зависит.
   */
  const ruleSetIssues = useMemo<ValidationIssue[]>(() => {
    const out: ValidationIssue[] = []
    for (const set of ruleSets) {
      const answer = Object.hasOwn(ruleSetAnswers.answers, set.name)
        ? ruleSetAnswers.answers[set.name]
        : undefined
      if (answer?.state !== 'unavailable') continue
      const parts: PathParts = ['rule-providers', set.name]
      out.push({
        parts,
        path: formatPath(parts),
        message: `Набор правил «${set.name}» редактор проверить не может: ${answer.reason}`,
        level: 'warning',
      })
    }
    return out
  }, [ruleSets, ruleSetAnswers])

  const issues = useMemo(
    () => (ruleSetIssues.length === 0 ? core.issues : [...core.issues, ...ruleSetIssues]),
    [core.issues, ruleSetIssues],
  )

  // Единственная точка правки операциями DocOp: писатель сам решает режим
  // (сплайс/модель) и сам отказывает на пути через алиас/слияние —
  // `applyOpsNow` только переносит результат в черновик и, если попросили,
  // выбор. Пустой список операций или отсутствующий документ — не ошибка,
  // а нечего делать. Успешная правка снимает стухший отказ: иначе диалог
  // «так соединить нельзя» от прошлого кабеля продолжал бы висеть после
  // того, как форма спокойно записала поле.
  const applyOpsNow = useCallback((ops: DocOp[], select?: string | null) => {
    const current = mdRef.current
    if (current === undefined || ops.length === 0) return
    const { md: next, refused } = applyMihomoOps(current, ops)
    if (refused.length > 0) setRefusal(refused[0]!.reason)
    else setRefusal(null)
    const { writeDraft, setSelectedNode } = coreRef.current
    // `select` переносит выбор только вместе с настоящей правкой: если ВСЕ
    // операции отказали, `next === current` (writer ничего не перепечатал), и
    // менять выбор было бы враньём об успехе — узел, на который просился
    // перенос (например, из-за смены тега), в документе так и не появился.
    if (next !== current) {
      writeDraft(next.text, { history: true })
      if (select !== undefined) setSelectedNode(select)
    }
  }, [])

  // Материализация якоря/слияния — правка документа по явному выбору
  // пользователя (кнопка замка), а не побочный эффект применения операции
  const materialize = useCallback((path: SchemaPath) => {
    const current = mdRef.current
    if (current === undefined) return
    const next = materializeAt(current, path)
    if (next !== current) coreRef.current.writeDraft(next.text, { history: true })
  }, [])

  const lockAt = useCallback((path: SchemaPath): Lock | null => {
    const current = mdRef.current
    if (current === undefined) return null
    const lock = mihomoLockAt(current, path)
    return lock === null
      ? null
      : { reason: lock.reason, action: { label: 'Развернуть значение здесь', run: () => materialize(path) } }
  }, [materialize])

  // Тождество писателя держится, пока не меняются его зависимости: формы
  // memo'ят по нему, и новый объект на каждый рендер обесценил бы это
  const writer = useMemo<DocWriter>(() => ({ apply: (ops) => applyOpsNow(ops), lockAt }), [applyOpsNow, lockAt])

  const rename = useCallback((kind: NamedKind, from: string, to: string): string | null => {
    const current = mdRef.current
    if (current === undefined) return null
    const res = renameAt(current, kind, from, to)
    if (res.refusal !== undefined) return renameRefusalText(res.refusal)
    if (res.md === current) return null
    // Узел адресуется именем: без переноса выбора инспектор закрылся бы прямо
    // во время ввода — та же болезнь, что лечит renamedNodeId у Xray. У
    // rule-provider узла на графе нет (см. CLAUDE.md) — префикса для него нет.
    const prefix = kind === 'group' ? 'group:'
      : kind === 'proxy' ? 'proxy:'
      : kind === 'provider' ? 'provider:'
      : kind === 'sub-rule' ? 'subrule:'
      : null
    const { writeDraft, selectedNode, setSelectedNode } = coreRef.current
    writeDraft(res.md.text, { history: true })
    if (prefix !== null && selectedNode === `${prefix}${from}`) setSelectedNode(`${prefix}${to}`)
    return null
  }, [])

  // `connect`/`disconnect` попадают в тот же список, что и `writer`/`lockAt`/
  // `rename` в находке ревью: раньше они были литералами внутри возвращаемого
  // объекта — новое тождество каждый рендер, — а `Dialog` в `MihomoTopology`
  // подписан на `draft.refusal`, не на сам `connect`, так что заметно это было
  // не сразу. Оборачиваем в `useCallback` по той же схеме.
  const connect = useCallback((source: string, target: string) => {
    const current = mdRef.current
    if (current === undefined) return
    const res = connectMihomo(current, source, target)
    setRefusal(res.refusal ? refusalText(res.refusal) : null)
    applyOpsNow(res.ops)
  }, [applyOpsNow])

  // Каждое ребро разрывается по ОТДЕЛЬНОМУ вызову disconnectMihomo — он
  // считает индекс элемента `proxies` по документу, который передан ему
  // САМОМУ, а не по исходному `md`: после первого удаления индексы сдвигаются,
  // и второй вызов обязан увидеть уже изменённый список. Текст в черновик
  // пишется ОДИН раз в конце — иначе пачка легла бы в историю несколькими
  // снимками, и один Ctrl+Z отменил бы только последнее ребро.
  const disconnect = useCallback((edgeIds: string[]) => {
    const current = mdRef.current
    if (current === undefined) return
    let cur = current
    let firstRefusal: string | null = null
    for (const id of edgeIds) {
      const res = disconnectMihomo(cur, id)
      if (res.refusal !== undefined) {
        if (firstRefusal === null) firstRefusal = refusalText(res.refusal)
        continue
      }
      const applied = applyMihomoOps(cur, res.ops)
      if (applied.refused.length > 0 && firstRefusal === null) firstRefusal = applied.refused[0]!.reason
      cur = applied.md
    }
    setRefusal(firstRefusal)
    if (cur !== current) coreRef.current.writeDraft(cur.text, { history: true })
  }, [])

  return {
    ...core,
    // Диагностики по наборам приклеиваются здесь, а не в useDocumentDraft:
    // состояние набора выводится из `md`, а `md` приходит ИЗ него — передать их
    // внутрь значило бы замкнуть круг. Меняются ровно два поля: `errorCount`
    // не трогаем (это предупреждения), `nodeIssues` — тоже (узла у пути
    // `rule-providers` на графе нет по устройству графа)
    issues,
    warningCount: core.warningCount + ruleSetIssues.length,
    md,
    writer,
    applyOps: applyOpsNow,
    lockAt,
    materialize,
    rename,
    connect,
    disconnect,
    trace,
    refusal,
    dismissRefusal: () => setRefusal(null),
    checkOpen,
    setCheckOpen,
    importOpen,
    setImportOpen,
    ruleSetsOpen,
    setRuleSetsOpen,
    recipesOpen,
    setRecipesOpen,
    ruleSets,
    askedSets,
  }
}
