// Черновик шаблона sing-box поверх общего ядра.
//
// Единица правки — НОВАЯ МОДЕЛЬ, а не текстовый сплайс: содержимое шаблона
// панель хранит объектом, форматирование не переживает сохранение в принципе, и
// защищать в тексте нечего — ни якорей, ни комментария-маркера, ради которых
// сплайсы заводились у Mihomo. Печать документа обратно здесь не потеря, а
// нормальный путь правки, тот же, что у Xray.

import { useCallback, useMemo, useState } from 'react'
import type { GraphContext } from '../../entities/graph/types'
import { traceSingbox, type SingboxDoc, type SingboxTraceResult } from '../../entities/singbox'
import { formatConfig } from './useConfigDraft'
import { singboxAdapter } from './singboxAdapter'
import { useDocumentDraft, type DocumentDraft } from './useDocumentDraft'

/** Сквадов у шаблона нет; константа, а не литерал — литерал сбрасывал бы мемоизацию */
const NO_CONTEXT: GraphContext = {}

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
  }
}
