// Инспектор выбранного узла шаблона sing-box — третья сборка того же приёма,
// что у Xray (`NodeInspector`) и Mihomo (`MihomoInspector`): разводка по
// префиксу id узла и та же оболочка `.wb-inspector`.
//
// Единица правки — операция писателя (`DocOp`), а не новый объект модели: форма
// не знает, где лежит запись, и эмитит правку по АБСОЛЮТНОМУ пути. Инспектор
// оборачивает `draft.applyOps` писателем, который умеет ровно две вещи сверх
// голой записи операций — отказать на пустом теге и провести выбор за узлом,
// когда правка сменила тег или тип записи, адресующей узел (группа и сервер
// живут под разными префиксами id).

import { useMemo, useState } from 'react'
import {
  groupsOf,
  nodeIdOf,
  panelFillsGroup,
  ROUTE_RULE_ACTION_VALUES,
  rulesOf,
  singboxRefs,
  type SingboxDoc,
  type SingboxInbound,
  type SingboxOutbound,
  type SingboxRule,
} from '../../entities/singbox'
import { outboundSlot } from '../../entities/graph/singbox/mutations'
import { applyOps, valueAt, type DocWriter, type SchemaPath } from '../../shared/schema'
import { Button } from '../../shared/ui'
import { SingboxDocPanel } from './SingboxDocPanel'
import { SingboxInboundForm } from '../inspector/SingboxInboundForm'
import { SingboxOutboundForm } from '../inspector/SingboxOutboundForm'
import { SingboxRuleForm } from '../inspector/SingboxRuleForm'
import type { SingboxDraft } from '../editor/useSingboxDraft'

type Kind = 'inbound' | 'rule' | 'group' | 'out' | 'hosts' | 'builtin' | 'settings' | 'other'

const KIND_LABEL: Record<Kind, string> = {
  inbound: 'вход',
  rule: 'правило',
  group: 'группа',
  out: 'выход',
  hosts: 'подстановка',
  builtin: 'встроенное действие',
  settings: 'документ',
  other: 'узел',
}

/** Подпись кнопки удаления. У видов без записи в документе её нет вовсе */
const REMOVE_LABEL: Partial<Record<Kind, string>> = {
  inbound: 'Удалить вход',
  rule: 'Удалить правило',
  group: 'Удалить группу',
  out: 'Удалить выход',
}

/**
 * Пустой тег форма не пишет. Узел графа адресуется тегом, и стереть его значит
 * убрать узел с холста вместе с единственным способом на него сослаться:
 * ссылки правил и групп повисли бы, а вернуться к записи можно было бы только
 * через вкладку JSON.
 */
const EMPTY_TAG_NOTE =
  'Тег — адрес узла на холсте, и пустым он не остаётся: узел исчез бы, а ссылки на него повисли. Наберите новое имя поверх старого.'

/**
 * Псевдоузлы: id, которого в графе нет вовсе. `doc:settings` открывает панель
 * «Документ» — единственный вход к разделам без узлов на холсте (`log`, `dns`,
 * наборы правил, `route.final` и т.д.). Прежние псевдоузлы наборов и DNS-
 * серверов (`doc:rule-sets`, `doc:dns-servers`) сюда не входят — их место
 * заняла общая панель, и адресуют её теперь пути `entities/graph/singbox/locate.ts`.
 */
const PSEUDO_NODES: Record<string, Kind> = {
  'doc:settings': 'settings',
}

function kindOf(nodeId: string): Kind {
  const pseudo = PSEUDO_NODES[nodeId]
  if (pseudo !== undefined) return pseudo
  const prefix = nodeId.slice(0, nodeId.indexOf(':'))
  return prefix === 'inbound' ||
    prefix === 'rule' ||
    prefix === 'group' ||
    prefix === 'out' ||
    prefix === 'hosts' ||
    prefix === 'builtin'
    ? prefix
    : 'other'
}

/**
 * Узел подстановки. Правит его панель, а не документ: она перезапишет списки
 * этих групп целиком тегами серверов подписки. Полей, которые тут можно было бы
 * менять, нет вовсе — отсюда справка вместо формы и отсутствие кнопки удаления.
 */
function HostsCard({ doc }: { doc: SingboxDoc }) {
  const filled = groupsOf(doc).filter(panelFillsGroup)
  return (
    <>
      <p>
        Серверы подписки подставит панель — в документе их нет. Списки таких групп ({filled.length})
        она перезапишет целиком, что бы в них ни стояло.
      </p>
      {filled.length > 0 && (
        <p className="muted mono">
          {filled.map((g) => g.tag ?? '(без тега)').join(', ')}
        </p>
      )}
      <p className="muted">
        Удалить узел нельзя: записи под него в документе нет. Чтобы список группы остался вашим,
        поставьте в её форме ключ remnawave.includeProxies = false.
      </p>
    </>
  )
}

/** Что делает встроенное действие ядра. Текст — из словаря: второй разошёлся бы с первым */
function BuiltinCard({ action }: { action: string }) {
  const doc = ROUTE_RULE_ACTION_VALUES.find((e) => e.value === action)?.doc
  return (
    <>
      <p>{doc ?? 'Встроенное действие ядра.'}</p>
      <p className="muted">
        Записи в документе у него нет: узел нарисован по полю action правила, и правится оно в форме
        самого правила.
      </p>
    </>
  )
}

/** Где в документе лежит запись выбранного узла — для порядка и удаления */
function recordSlot(
  doc: SingboxDoc,
  kind: Kind,
  name: string,
): { list: SchemaPath; index: number; length: number } | null {
  if (kind === 'rule') {
    const rules = rulesOf(doc)
    const index = Number(name)
    return rules[index] === undefined ? null : { list: ['route', 'rules'], index, length: rules.length }
  }
  if (kind === 'inbound') {
    const list = Array.isArray(doc.inbounds) ? doc.inbounds : []
    const index = list.findIndex((i) => i.tag === name)
    return index < 0 ? null : { list: ['inbounds'], index, length: list.length }
  }
  if (kind === 'out' || kind === 'group') {
    const slot = outboundSlot(doc, name)
    if (slot === null) return null
    const length = (slot.key === 'endpoints' ? doc.endpoints : doc.outbounds)?.length ?? 0
    return { list: [slot.key], index: slot.at, length }
  }
  return null
}

interface Props {
  draft: SingboxDraft
  doc: SingboxDoc
  /** Узел, который просят показать; используется, только пока выбора нет */
  nodeId: string
  /** Закрытие инспектора; по умолчанию просто снимается выбор узла */
  onClose?: () => void
}

export function SingboxInspector({ draft, doc, nodeId, onClose }: Props) {
  // Причина отказа привязана к узлу: без привязки текст про прошлый узел
  // остался бы висеть над формой следующего и читался бы как отказ по нему
  const [note, setNote] = useState<{ nodeId: string; text: string } | null>(null)

  // Источник ОДИН — выбранный в черновике узел. Проп остаётся входом «покажи
  // вот этот узел» и работает, пока выбора нет вовсе, — на этом стоят прямые
  // рендеры в тестах.
  const shownId = draft.selectedNode ?? nodeId
  const kind = kindOf(shownId)
  const name = shownId.slice(shownId.indexOf(':') + 1)
  const slot = recordSlot(doc, kind, name)
  const refs = useMemo(() => singboxRefs(doc), [doc])

  function refuse(text: string) {
    setNote({ nodeId: shownId, text })
  }

  /**
   * Писатель инспектора: и формы, и панель «Документ» правят через него. Он
   * добавляет ровно две вещи сверх голой записи операций в черновик — отказ на
   * пустом теге (EMPTY_TAG_NOTE) и перенос выбора за узлом, когда правка
   * сменила тег или тип записи. `lockAt` берётся у черновика как есть: замок —
   * свойство документа (панель заполнит список группы), а не инспектора.
   */
  const writer = useMemo<DocWriter>(
    () => ({
      apply(ops) {
        // Пустой тег — отказ с объяснением: узел адресуется тегом, и стереть его
        // значит убрать узел с холста вместе со способом на него сослаться
        if (ops.some((op) => op.op === 'set' && op.path[op.path.length - 1] === 'tag' && op.value === '')) {
          refuse(EMPTY_TAG_NOTE)
          return
        }
        setNote(null)
        draft.applyOps(ops)
        // Выбор ведём за узлом: смена тега или типа меняет id (группа и сервер
        // живут под разными префиксами) — правила своего тега не имеют, у них
        // ведёт выбор перестановка, а не эта правка
        if (slot === null || kind === 'rule') return
        const touched = ops.some(
          (op) =>
            op.op === 'set' &&
            op.path.length === slot.list.length + 2 &&
            (op.path.at(-1) === 'tag' || op.path.at(-1) === 'type'),
        )
        if (!touched) return
        const record = valueAt(applyOps(doc, ops), [...slot.list, slot.index]) as { type?: unknown; tag?: unknown }
        const nextId = nodeIdOf(record, slot.list[0] as 'inbounds' | 'outbounds' | 'endpoints')
        if (nextId !== null && nextId !== shownId) draft.setSelectedNode(nextId)
      },
      lockAt: draft.lockAt,
    }),
    [draft, doc, kind, shownId, slot],
  )

  function move(dir: -1 | 1) {
    if (slot === null) return
    draft.applyOps([{ op: 'move', path: slot.list, from: slot.index, to: slot.index + dir }])
    // Для правила порядок и есть его адрес — переставленное ведёт выбор за собой
    if (kind === 'rule') draft.setSelectedNode(`rule:${slot.index + dir}`)
  }

  function remove() {
    if (slot === null) return
    draft.applyOps([{ op: 'remove', path: [...slot.list, slot.index] }])
    draft.setSelectedNode(null)
  }

  const removeLabel = REMOVE_LABEL[kind]

  return (
    <aside className="wb-inspector">
      <div className="wb-inspector-head">
        <div className="row">
          <span className="eyebrow">{KIND_LABEL[kind]}</span>
          <span className="spacer" />
          <Button
            variant="ghost"
            onClick={() => (onClose ? onClose() : draft.setSelectedNode(null))}
            aria-label="Закрыть"
          >
            ✕
          </Button>
        </div>
        <span className="mono">{shownId}</span>

        {slot !== null && (
          <div className="row">
            <span className="muted">
              порядок: {slot.index + 1} из {slot.length}
            </span>
            <span className="spacer" />
            <Button variant="ghost" disabled={slot.index <= 0} aria-label="Переместить выше" onClick={() => move(-1)}>
              Выше
            </Button>
            <Button
              variant="ghost"
              disabled={slot.index >= slot.length - 1}
              aria-label="Переместить ниже"
              onClick={() => move(1)}
            >
              Ниже
            </Button>
          </div>
        )}
      </div>

      <div className="wb-inspector-body">
        <div className="inspector-form">
          {note !== null && note.nodeId === shownId && (
            <p className="field-error" role="alert">
              {note.text}
            </p>
          )}
          {(kind === 'out' || kind === 'group') &&
            (slot === null ? (
              <p className="muted">Выхода «{name}» в документе больше нет.</p>
            ) : (
              <SingboxOutboundForm
                // Сама форма — чистая функция value, своего состояния не
                // держит. Ключ нужен из-за `NumberField` внутри неё: у него
                // локальный текстовый буфер набора (позволяет напечатать
                // «-2.5» посимвольно, не откатываясь на каждый нераспознанный
                // символ), и он ресинхронизируется, только когда проп `value`
                // меняется. Если у нового выхода то же число оказалось бы
                // равно ПОСЛЕДНЕМУ СИНХРОННОМУ значению прежнего поля (а не
                // тому, что буфер показывает сейчас, если ввод был
                // недописанным), ресинхронизация не сработает и на экране
                // останется недописанный текст соседа. Ключ на всю форму
                // размонтирует буфер целиком при переходе между выходами —
                // дешевле и надёжнее точечной защиты внутри одного поля
                key={shownId}
                value={valueAt(doc, [...slot.list, slot.index]) as SingboxOutbound}
                path={[...slot.list, slot.index]}
                writer={writer}
                refs={refs}
                isEndpoint={slot.list[0] === 'endpoints'}
              />
            ))}
          {kind === 'rule' &&
            (slot === null ? (
              <p className="muted">Правила #{Number(name) + 1} в документе больше нет.</p>
            ) : (
              <SingboxRuleForm
                key={shownId}
                value={rulesOf(doc)[slot.index]! as SingboxRule}
                path={[...slot.list, slot.index]}
                writer={writer}
                refs={refs}
              />
            ))}
          {kind === 'inbound' &&
            (slot === null ? (
              <p className="muted">Входа «{name}» в документе больше нет.</p>
            ) : (
              <SingboxInboundForm
                key={shownId}
                value={(Array.isArray(doc.inbounds) ? doc.inbounds : [])[slot.index]! as SingboxInbound}
                path={[...slot.list, slot.index]}
                writer={writer}
                refs={refs}
              />
            ))}
          {kind === 'settings' && <SingboxDocPanel doc={doc} writer={writer} refs={refs} />}
          {kind === 'hosts' && <HostsCard doc={doc} />}
          {kind === 'builtin' && <BuiltinCard action={name} />}
          {kind === 'other' && <p className="muted">Для этого узла формы нет.</p>}
        </div>
      </div>

      {removeLabel !== undefined && (
        <div className="wb-inspector-foot">
          <Button variant="danger" onClick={remove}>
            {removeLabel}
          </Button>
          <span className="spacer" />
        </div>
      )}
    </aside>
  )
}
