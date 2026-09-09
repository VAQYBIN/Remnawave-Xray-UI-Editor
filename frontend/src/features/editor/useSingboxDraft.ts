// Черновик шаблона sing-box поверх общего ядра.
//
// Единица правки — НОВАЯ МОДЕЛЬ, а не текстовый сплайс: содержимое шаблона
// панель хранит объектом, форматирование не переживает сохранение в принципе, и
// защищать в тексте нечего — ни якорей, ни комментария-маркера, ради которых
// сплайсы заводились у Mihomo. Печать документа обратно здесь не потеря, а
// нормальный путь правки, тот же, что у Xray.

import { useCallback, useMemo, useRef, useState } from 'react'
import type { GraphContext } from '../../entities/graph/types'
import { panelFillsGroup, traceSingbox, type SingboxDoc, type SingboxTraceResult } from '../../entities/singbox'
import { applyOps, type DocOp, type DocWriter, type Lock, type SchemaPath } from '../../shared/schema'
import { formatConfig } from './useConfigDraft'
import { singboxAdapter } from './singboxAdapter'
import { useDocumentDraft, type DocumentDraft } from './useDocumentDraft'

/** Сквадов у шаблона нет; константа, а не литерал — литерал сбрасывал бы мемоизацию */
const NO_CONTEXT: GraphContext = {}

/** Текст замка списка группы: тот же довод, что у отказа кабелю panel-fills-group */
const PANEL_FILLS_LOCK =
  'Список этой группы заполняет панель: она перезапишет его целиком тегами серверов подписки. Чтобы править список руками, закрепите его кнопкой в форме группы.'

export interface SingboxDraft extends DocumentDraft<SingboxDoc> {
  doc: SingboxDoc | undefined
  /**
   * Документ, разобранный из ТЕКСТА черновика. Именно он уходит в панель:
   * человек правит текст, и отправлять вместо него результат схемы значило бы
   * отправить не тот документ, который он видел.
   */
  json: unknown | undefined
  changeDoc: (next: SingboxDoc) => void
  trace: SingboxTraceResult | undefined
  checkOpen: boolean
  setCheckOpen: (open: boolean) => void
  importOpen: boolean
  setImportOpen: (open: boolean) => void
  recipesOpen: boolean
  setRecipesOpen: (open: boolean) => void
  /** Операции по пути — единица правки форм по схеме */
  applyOps: (ops: DocOp[]) => void
  /** Замок: единственная причина у sing-box — список группы, которую заполняет панель */
  lockAt: (path: SchemaPath) => Lock | null
  writer: DocWriter
}

export interface SingboxDraftOptions {
  docKey: string
  /** Содержимое шаблона панели — объект из templateJson */
  panelJson: unknown
  baseVersion: string
}

export function useSingboxDraft({
  docKey,
  panelJson,
  baseVersion,
}: SingboxDraftOptions): SingboxDraft {
  const panelText = useMemo(() => formatConfig(panelJson), [panelJson])
  const core = useDocumentDraft({
    docKind: 'template',
    docKey,
    panelText,
    baseVersion,
    ctx: NO_CONTEXT,
    adapter: singboxAdapter,
  })

  const [checkOpen, setCheckOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [recipesOpen, setRecipesOpen] = useState(false)

  const changeDoc = useCallback(
    (next: SingboxDoc) => {
      core.writeDraft(formatConfig(next), { history: true })
    },
    [core],
  )

  const json = useMemo<unknown | undefined>(() => {
    try {
      return JSON.parse(core.text)
    } catch {
      return undefined
    }
  }, [core.text])

  const trace = useMemo<SingboxTraceResult | undefined>(() => {
    if (core.model === undefined || core.traceTarget === null) return undefined
    return traceSingbox(core.model, core.traceTarget)
  }, [core.model, core.traceTarget])

  // `core` — новый объект литерала на каждый рендер (useDocumentDraft его не
  // мемоизирует), а writer обязан держать тождество между рендерами при
  // неизменном документе — иначе память об открытой форме теряется впустую.
  // Ref со свежим core даёт applyOpsToDoc постоянное тождество, не устаревая.
  const coreRef = useRef(core)
  coreRef.current = core

  const applyOpsToDoc = useCallback((ops: DocOp[]) => {
    const { model, writeDraft } = coreRef.current
    // Модели может не быть (текст не разбирается): тогда править нечего — форма
    // и не откроется, а операция мимо документа молча ничего не сделала бы
    if (model === undefined) return
    writeDraft(formatConfig(applyOps(model, ops)), { history: true })
  }, [])

  const lockAt = useCallback(
    (path: SchemaPath): Lock | null => {
      const [head, index, key] = path
      if (head !== 'outbounds' || typeof index !== 'number' || key !== 'outbounds' || path.length !== 3) return null
      const group = core.model?.outbounds?.[index]
      if (group === undefined || !panelFillsGroup(group)) return null
      return { reason: PANEL_FILLS_LOCK }
    },
    [core.model],
  )

  const writer = useMemo<DocWriter>(() => ({ apply: applyOpsToDoc, lockAt }), [applyOpsToDoc, lockAt])

  return {
    ...core,
    doc: core.model,
    json,
    changeDoc,
    trace,
    checkOpen,
    setCheckOpen,
    importOpen,
    setImportOpen,
    recipesOpen,
    setRecipesOpen,
    applyOps: applyOpsToDoc,
    lockAt,
    writer,
  }
}
