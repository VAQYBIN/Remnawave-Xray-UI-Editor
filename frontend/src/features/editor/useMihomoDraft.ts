// Черновик шаблона Mihomo: ядро плюс операции правки ТЕКСТА. Единица правки —
// TextEdit[], а не новая модель: документ никогда не печатается заново.

import { useState } from 'react'
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
  connectMihomo,
  disconnectMihomo,
  type MihomoRefusal,
} from '../../entities/graph/mihomo/mutations'
import type { PathParts } from '../../entities/xray'
import type { GraphContext } from '../../entities/graph/types'
import { useDocumentDraft, type DocumentDraft } from './useDocumentDraft'
import { mihomoAdapter } from './mihomoAdapter'

// Контекст графа у шаблона пуст: сквадов здесь нет. Константа, а не литерал в
// вызове — иначе новый объект на каждый рендер сбрасывал бы мемоизацию.
const NO_CONTEXT: GraphContext = {}

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
