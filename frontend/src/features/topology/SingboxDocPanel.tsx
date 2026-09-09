// Панель «Документ»: разделы корня, у которых узлов на холсте нет. Раздел-объект
// рисуется формой по схеме, раздел-список — карточками с формой на элемент.
// Панель не знает, откуда пришёл писатель: ей всё равно, черновик это или
// ловушка теста.

import type { ReactNode } from 'react'
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
import { isRecord, valueAt, type DocSection, type DocWriter, type RefKind, type SchemaPath } from '../../shared/schema'
import { Button, CollapsibleSection } from '../../shared/ui'
import { SchemaForm } from '../inspector/schema/SchemaForm'
import { SingboxDnsRuleForm } from '../inspector/SingboxDnsRuleForm'
import { SingboxDnsServerForm } from '../inspector/SingboxDnsServerForm'
import { SingboxRuleSetForm } from '../inspector/SingboxRuleSetForm'

type Refs = Partial<Record<RefKind, string[]>>

/** Списки панели: кнопка добавления, подпись удаления, стартер и форма элемента */
const LISTS: Record<string, {
  addLabel: string
  removeLabel: (i: number) => string
  titleOf: (item: unknown, i: number) => string
  starter: (doc: SingboxDoc) => unknown
  Form: (props: { value: Record<string, unknown>; path: SchemaPath; writer: DocWriter; refs: Refs }) => ReactNode
}> = {
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

function ListSection({ section, doc, writer, refs }: { section: DocSection; doc: SingboxDoc; writer: DocWriter; refs: Refs }) {
  const spec = LISTS[section.path.join('.')]!
  const raw = valueAt(doc, section.path)
  const items = Array.isArray(raw) ? raw : []
  return (
    <div className="list-editor">
      {items.length === 0 && <p className="muted">Записей пока нет — кнопка ниже заведёт первую.</p>}
      {items.map((item, i) => (
        // Ключ — позиция: она и есть адрес записи, а тега у неё может не быть
        <div key={i} className="list-editor-card">
          <div className="list-editor-body">
            <span className="eyebrow">{spec.titleOf(item, i)}</span>
            <spec.Form value={isRecord(item) ? item : {}} path={[...section.path, i]} writer={writer} refs={refs} />
          </div>
          <div className="list-editor-order">
            <button type="button" className="chip-x" aria-label={`Переместить элемент ${i + 1} выше`} disabled={i === 0} onClick={() => writer.apply([{ op: 'move', path: section.path, from: i, to: i - 1 }])}>↑</button>
            <button type="button" className="chip-x" aria-label={`Переместить элемент ${i + 1} ниже`} disabled={i === items.length - 1} onClick={() => writer.apply([{ op: 'move', path: section.path, from: i, to: i + 1 }])}>↓</button>
          </div>
          <button type="button" className="chip-x" aria-label={spec.removeLabel(i)} onClick={() => writer.apply([{ op: 'remove', path: [...section.path, i] }])}>✕</button>
        </div>
      ))}
      <Button onClick={() => writer.apply([{ op: 'insert', path: section.path, index: items.length, value: spec.starter(doc) }])}>{spec.addLabel}</Button>
    </div>
  )
}

function ObjectSection({ section, doc, writer, refs }: { section: DocSection; doc: SingboxDoc; writer: DocWriter; refs: Refs }) {
  const value = valueAt(doc, section.path)
  const field = singboxFieldAt(section.path, doc)
  if (!isRecord(value)) {
    return (
      <>
        <p className="muted">{field?.doc ?? ''} Раздела в документе нет.</p>
        <Button onClick={() => writer.apply([{ op: 'set', path: section.path, value: field?.starter?.() ?? {} }])}>Завести раздел</Button>
      </>
    )
  }
  return <SchemaForm fields={singboxFieldsAt(section.path, doc) ?? []} value={value} path={section.path} writer={writer} refs={refs} skip={section.skip} />
}

export function SingboxDocPanel({ doc, writer, refs }: { doc: SingboxDoc; writer: DocWriter; refs: Refs }) {
  return (
    <>
      {SINGBOX_DOC_SECTIONS.map((section) => (
        <CollapsibleSection key={section.path.join('.')} title={section.title} region>
          {section.kind === 'list' ? (
            <ListSection section={section} doc={doc} writer={writer} refs={refs} />
          ) : (
            <ObjectSection section={section} doc={doc} writer={writer} refs={refs} />
          )}
        </CollapsibleSection>
      ))}
    </>
  )
}
