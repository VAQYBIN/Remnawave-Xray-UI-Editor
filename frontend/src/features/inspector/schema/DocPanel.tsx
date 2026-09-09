// Общая панель «Документ»: разделы корня, у которых узлов на холсте нет.
// Раздел-объект рисуется формой по схеме, раздел-список — карточками с формой
// на элемент, раздел-отображение — карточками по имени записи. Панель не знает
// ни ядра, ни писателя: спуск по схеме, значение по пути и формы записей
// приходят пропсами — так `SingboxDocPanel` и `MihomoDocPanel` остаются
// тонкими обёртками, а не двумя копиями одной разметки.

import type { ReactNode } from 'react'
import {
  isRecord,
  uniqueName,
  type DocSection,
  type DocWriter,
  type FieldSchema,
  type RefKind,
  type SchemaPath,
} from '../../../shared/schema'
import { Button, CollapsibleSection } from '../../../shared/ui'
import { SchemaForm } from './SchemaForm'

export type DocRefs = Partial<Record<RefKind, string[]>>

export interface DocEntryFormProps {
  value: Record<string, unknown>
  path: SchemaPath
  writer: DocWriter
  refs: DocRefs
}

export interface DocListSpec<TDoc> {
  addLabel: string
  removeLabel: (index: number) => string
  titleOf: (item: unknown, index: number) => string
  starter: (doc: TDoc) => unknown
  Form: (props: DocEntryFormProps) => ReactNode
}

export interface DocMapSpec<TDoc> {
  addLabel: string
  removeLabel: (name: string) => string
  /** Основа имени новой записи; уникальность — `uniqueName` по ключам раздела */
  baseName: string
  starter: (doc: TDoc, name: string) => unknown
  Form: (props: DocEntryFormProps) => ReactNode
}

export interface DocPanelProps<TDoc> {
  sections: DocSection[]
  doc: TDoc
  writer: DocWriter
  refs: DocRefs
  fieldsAt: (path: SchemaPath, doc: TDoc) => FieldSchema[] | undefined
  fieldAt: (path: SchemaPath, doc: TDoc) => FieldSchema | undefined
  /** Значение по пути: у модельных ядер — сам документ, у Mihomo — снимок значений */
  valueOf: (doc: TDoc, path: SchemaPath) => unknown
  lists?: Record<string, DocListSpec<TDoc>>
  maps?: Record<string, DocMapSpec<TDoc>>
}

function OrderButtons({ path, index, length, writer }: { path: SchemaPath; index: number; length: number; writer: DocWriter }) {
  return (
    <div className="list-editor-order">
      <button type="button" className="chip-order" aria-label={`Переместить элемент ${index + 1} выше`} disabled={index === 0}
        onClick={() => writer.apply([{ op: 'move', path, from: index, to: index - 1 }])}>↑</button>
      <button type="button" className="chip-order" aria-label={`Переместить элемент ${index + 1} ниже`} disabled={index === length - 1}
        onClick={() => writer.apply([{ op: 'move', path, from: index, to: index + 1 }])}>↓</button>
    </div>
  )
}

function ListSection<TDoc>({ section, spec, p }: { section: DocSection; spec: DocListSpec<TDoc>; p: DocPanelProps<TDoc> }) {
  const raw = p.valueOf(p.doc, section.path)
  const items = Array.isArray(raw) ? raw : []
  return (
    <div className="list-editor">
      {items.length === 0 && <p className="muted">Записей пока нет — кнопка ниже заведёт первую.</p>}
      {items.map((item, i) => (
        // Ключ — позиция: она и есть адрес записи, а имени у неё может не быть
        <div key={i} className="list-editor-card">
          <div className="list-editor-body">
            <span className="eyebrow">{spec.titleOf(item, i)}</span>
            <spec.Form value={isRecord(item) ? item : {}} path={[...section.path, i]} writer={p.writer} refs={p.refs} />
          </div>
          <OrderButtons path={section.path} index={i} length={items.length} writer={p.writer} />
          <button type="button" className="chip-x" aria-label={spec.removeLabel(i)}
            onClick={() => p.writer.apply([{ op: 'remove', path: [...section.path, i] }])}>✕</button>
        </div>
      ))}
      <Button onClick={() => p.writer.apply([{ op: 'insert', path: section.path, index: items.length, value: spec.starter(p.doc) }])}>
        {spec.addLabel}
      </Button>
    </div>
  )
}

/**
 * Раздел-отображение: записи адресуются именем. Новая запись заводится под
 * именем-заготовкой (`provider`, `provider-2`, …) — имя правится в форме
 * записи, как у групп; порядка у записей нет, YAML-отображение его не обещает.
 */
function MapSection<TDoc>({ section, spec, p }: { section: DocSection; spec: DocMapSpec<TDoc>; p: DocPanelProps<TDoc> }) {
  const raw = p.valueOf(p.doc, section.path)
  const entries = isRecord(raw) ? Object.entries(raw) : []
  return (
    <div className="list-editor">
      {entries.length === 0 && <p className="muted">Записей пока нет — кнопка ниже заведёт первую.</p>}
      {entries.map(([name, item]) => (
        <div key={name} className="list-editor-card">
          <div className="list-editor-body">
            <span className="eyebrow">{name}</span>
            <spec.Form value={isRecord(item) ? item : {}} path={[...section.path, name]} writer={p.writer} refs={p.refs} />
          </div>
          <button type="button" className="chip-x" aria-label={spec.removeLabel(name)}
            onClick={() => p.writer.apply([{ op: 'remove', path: [...section.path, name] }])}>✕</button>
        </div>
      ))}
      <Button
        onClick={() => {
          const name = uniqueName(entries.map(([n]) => n), spec.baseName)
          p.writer.apply([{ op: 'set', path: [...section.path, name], value: spec.starter(p.doc, name) }])
        }}
      >
        {spec.addLabel}
      </Button>
    </div>
  )
}

function ObjectSection<TDoc>({ section, p }: { section: DocSection; p: DocPanelProps<TDoc> }) {
  const value = p.valueOf(p.doc, section.path)
  // Пустой путь — сам корень документа: он есть всегда, даже когда пуст
  const field = section.path.length === 0 ? undefined : p.fieldAt(section.path, p.doc)
  if (!isRecord(value) && section.path.length > 0) {
    return (
      <>
        <p className="muted">{field?.doc ?? ''} Раздела в документе нет.</p>
        <Button onClick={() => p.writer.apply([{ op: 'set', path: section.path, value: field?.starter?.() ?? {} }])}>Завести раздел</Button>
      </>
    )
  }
  return (
    <SchemaForm
      fields={p.fieldsAt(section.path, p.doc) ?? []}
      value={isRecord(value) ? value : {}}
      path={section.path}
      writer={p.writer}
      refs={p.refs}
      skip={section.skip}
    />
  )
}

export function DocPanel<TDoc>(p: DocPanelProps<TDoc>) {
  return (
    <>
      {p.sections.map((section) => {
        const key = section.path.join('.')
        const list = p.lists?.[key]
        const map = p.maps?.[key]
        return (
          <CollapsibleSection key={key} title={section.title} region>
            {section.kind === 'list' && list ? (
              <ListSection section={section} spec={list} p={p} />
            ) : section.kind === 'map' && map ? (
              <MapSection section={section} spec={map} p={p} />
            ) : (
              <ObjectSection section={section} p={p} />
            )}
          </CollapsibleSection>
        )
      })}
    </>
  )
}
