// Панель «Документ» sing-box — тонкая обёртка над общей `DocPanel`: своё здесь
// только описание списков (`LISTS`) и подпись элемента по тегу (`tagOr`).
// Разметка карточек и разделов — общая, чтобы у Mihomo не завелась вторая
// копия той же вёрстки.

import { DocPanel, type DocListSpec, type DocRefs } from '../inspector/schema/DocPanel'
import {
  SINGBOX_DOC_SECTIONS,
  singboxFieldAt,
  singboxFieldsAt,
  startDnsRule,
  startDnsServer,
  startRuleSet,
  type SingboxDoc,
  type SingboxRule,
  type SingboxRuleSet,
} from '../../entities/singbox'
import { valueAt, type DocWriter } from '../../shared/schema'
import { SingboxDnsRuleForm } from '../inspector/SingboxDnsRuleForm'
import { SingboxDnsServerForm } from '../inspector/SingboxDnsServerForm'
import { SingboxRuleSetForm } from '../inspector/SingboxRuleSetForm'

/** Списки панели: кнопка добавления, подпись удаления, стартер и форма элемента */
const LISTS: Record<string, DocListSpec<SingboxDoc>> = {
  'dns.servers': {
    addLabel: '+ Сервер',
    removeLabel: (i) => `Удалить сервер #${i + 1}`,
    titleOf: (item, i) => tagOr(item, `сервер #${i + 1}`),
    starter: startDnsServer,
    Form: (p) => <SingboxDnsServerForm value={p.value} path={p.path} writer={p.writer} refs={p.refs} />,
  },
  'dns.rules': {
    addLabel: '+ DNS-правило',
    removeLabel: (i) => `Удалить DNS-правило #${i + 1}`,
    titleOf: (_item, i) => `правило #${i + 1}`,
    starter: startDnsRule,
    Form: (p) => <SingboxDnsRuleForm value={p.value as SingboxRule} path={p.path} writer={p.writer} refs={p.refs} />,
  },
  'route.rule_set': {
    addLabel: '+ Набор правил',
    removeLabel: (i) => `Удалить набор #${i + 1}`,
    titleOf: (item, i) => tagOr(item, `набор #${i + 1}`),
    starter: startRuleSet,
    Form: (p) => <SingboxRuleSetForm value={p.value as SingboxRuleSet} path={p.path} writer={p.writer} refs={p.refs} />,
  },
}

function tagOr(item: unknown, fallback: string): string {
  const tag = (item as { tag?: unknown } | null)?.tag
  return typeof tag === 'string' && tag !== '' ? tag : fallback
}

export function SingboxDocPanel({ doc, writer, refs }: { doc: SingboxDoc; writer: DocWriter; refs: DocRefs }) {
  return (
    <DocPanel
      sections={SINGBOX_DOC_SECTIONS}
      doc={doc}
      writer={writer}
      refs={refs}
      fieldsAt={singboxFieldsAt}
      fieldAt={singboxFieldAt}
      valueOf={valueAt}
      lists={LISTS}
    />
  )
}
