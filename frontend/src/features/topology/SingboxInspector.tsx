// Инспектор выбранного узла шаблона sing-box — третья сборка того же приёма,
// что у Xray (`NodeInspector`) и Mihomo (`MihomoInspector`): разводка по
// префиксу id узла и та же оболочка `.wb-inspector`.
//
// Отличие от Mihomo — в единице правки. Там форма отдавала сплайс по тексту,
// потому что документ владеет якорями и комментарием-маркером; здесь форма
// отдаёт НОВЫЙ элемент модели, а инспектор кладёт его в копию документа одной
// записью `changeDoc`. Собирается документ ровно в одном месте — в мутациях
// графа, и форма не обязана знать, где лежит правимый элемент.

import { useState } from 'react'
import {
  fieldFor,
  GROUP_OUTBOUND_TYPES,
  groupsOf,
  outboundsOf,
  panelFillsGroup,
  ruleSetTagsOf,
  rulesOf,
  type SingboxDoc,
  type SingboxInbound,
  type SingboxOutbound,
  type SingboxRule,
} from '../../entities/singbox'
import {
  moveRule,
  outboundByTag,
  removeAt,
  singboxRefusalText,
  withOutboundAt,
} from '../../entities/graph/singbox/mutations'
import { Button } from '../../shared/ui'
import { SingboxInboundForm } from '../inspector/SingboxInboundForm'
import { SingboxOutboundForm } from '../inspector/SingboxOutboundForm'
import { SingboxRuleForm } from '../inspector/SingboxRuleForm'
import type { SingboxDraft } from '../editor/useSingboxDraft'

type Kind = 'inbound' | 'rule' | 'group' | 'out' | 'hosts' | 'builtin' | 'other'

const KIND_LABEL: Record<Kind, string> = {
  inbound: 'вход',
  rule: 'правило',
  group: 'группа',
  out: 'выход',
  hosts: 'подстановка',
  builtin: 'встроенное действие',
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
 * Выход, объявленный в `endpoints`, форма записать не умеет: `withOutboundAt`
 * ищет элемент только в `outbounds` и возвращает тот же документ. Молча
 * проглотить правку хуже, чем назвать причину, — набранное иначе пропадало бы
 * без единого слова.
 */
const ENDPOINT_NOTE =
  'Этот выход объявлен в endpoints — форма записать его не умеет. Правьте его на вкладке JSON.'

/**
 * Пустой тег форма не пишет. Узел графа адресуется тегом, и стереть его значит
 * убрать узел с холста вместе с единственным способом на него сослаться:
 * ссылки правил и групп повисли бы, а вернуться к записи можно было бы только
 * через вкладку JSON.
 */
const EMPTY_TAG_NOTE =
  'Тег — адрес узла на холсте, и пустым он не остаётся: узел исчез бы, а ссылки на него повисли. Наберите новое имя поверх старого.'

function kindOf(nodeId: string): Kind {
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
 * Теги выходов документа — подсказка спискам форм. Считаются по обоим спискам:
 * узел `out:<tag>` граф рисует и по `endpoints`, и не назови мы такой тег,
 * форма правила предложила бы выбрать не всё, что на холсте.
 */
function outboundTagsOf(doc: SingboxDoc): string[] {
  const endpoints = Array.isArray(doc.endpoints) ? doc.endpoints : []
  return [...outboundsOf(doc), ...endpoints]
    .map((o) => o.tag)
    .filter((t): t is string => typeof t === 'string' && t !== '')
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
  const doc = fieldFor('route-rule', 'action')?.enum?.find((e) => e.value === action)?.doc
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

  // Источник ОДИН — выбранный в черновике узел. Кнопки «Выше»/«Ниже»/«Удалить»
  // действуют на выбор, и разойдись эти два источника, кнопка удалила бы не то,
  // что на экране. Проп остаётся входом «покажи вот этот узел» и работает, пока
  // выбора нет вовсе, — на этом стоят прямые рендеры в тестах.
  const shownId = draft.selectedNode ?? nodeId
  const kind = kindOf(shownId)
  const name = shownId.slice(shownId.indexOf(':') + 1)
  const ruleIndex = kind === 'rule' ? Number(name) : -1
  const ruleCount = rulesOf(doc).length
  const outbound = kind === 'out' || kind === 'group' ? outboundByTag(doc, name) : undefined

  function refuse(text: string) {
    setNote({ nodeId: shownId, text })
  }

  /**
   * Выбор ведём за узлом: id узла собран из тега, и смена тега (а у выхода — ещё
   * и смена типа: группа и сервер живут под разными префиксами) оставила бы
   * выбор на несуществующем узле — инспектор закрылся бы прямо во время ввода.
   * Та же болезнь лечится переносом выбора у Mihomo и у Xray.
   */
  function follow(nextId: string) {
    if (nextId !== shownId) draft.setSelectedNode(nextId)
  }

  /**
   * Правка выхода: форма отдала новый элемент, инспектор кладёт его в копию
   * документа. Тег для поиска — ПРЕЖНИЙ: форма вправе его переименовать.
   */
  function changeOutbound(next: SingboxOutbound) {
    const nextTag = typeof next.tag === 'string' ? next.tag : ''
    if (nextTag === '') return refuse(EMPTY_TAG_NOTE)
    const nextDoc = withOutboundAt(doc, name, next)
    if (nextDoc === doc) return refuse(ENDPOINT_NOTE)
    setNote(null)
    draft.changeDoc(nextDoc)
    follow(`${GROUP_OUTBOUND_TYPES.has(next.type) ? 'group' : 'out'}:${nextTag}`)
  }

  /** Правило адресуется индексом — переименовывать тут нечего, вести выбор не за чем */
  function changeRule(next: SingboxRule) {
    const rules = rulesOf(doc)
    if (rules[ruleIndex] === undefined) return refuse(singboxRefusalText('not-found'))
    const nextDoc = structuredClone(doc)
    nextDoc.route!.rules = rules.map((rule, i) => (i === ruleIndex ? next : rule))
    setNote(null)
    draft.changeDoc(nextDoc)
  }

  function changeInbound(next: SingboxInbound) {
    const nextTag = typeof next.tag === 'string' ? next.tag : ''
    if (nextTag === '') return refuse(EMPTY_TAG_NOTE)
    const list = Array.isArray(doc.inbounds) ? doc.inbounds : []
    const at = list.findIndex((i) => i.tag === name)
    if (at < 0) return refuse(singboxRefusalText('not-found'))
    const nextDoc = structuredClone(doc)
    nextDoc.inbounds = list.map((inbound, i) => (i === at ? next : inbound))
    setNote(null)
    draft.changeDoc(nextDoc)
    follow(`inbound:${nextTag}`)
  }

  function move(dir: -1 | 1) {
    const res = moveRule(doc, ruleIndex, dir)
    if (res.doc === undefined) return refuse(singboxRefusalText(res.refusal!))
    setNote(null)
    draft.changeDoc(res.doc)
    // Число правил не изменилось, но правило переехало — ведём выбор за ним
    draft.setSelectedNode(`rule:${ruleIndex + dir}`)
  }

  function remove() {
    const res = removeAt(doc, shownId)
    if (res.doc === undefined) return refuse(singboxRefusalText(res.refusal!))
    setNote(null)
    draft.changeDoc(res.doc)
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

        {kind === 'rule' && (
          <div className="row">
            <span className="muted">
              порядок: {ruleIndex + 1} из {ruleCount}
            </span>
            <span className="spacer" />
            <Button
              variant="ghost"
              disabled={ruleIndex <= 0}
              aria-label="Переместить правило выше"
              onClick={() => move(-1)}
            >
              Выше
            </Button>
            <Button
              variant="ghost"
              disabled={ruleIndex >= ruleCount - 1}
              aria-label="Переместить правило ниже"
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
            (outbound === undefined ? (
              <p className="muted">Выхода «{name}» в документе больше нет.</p>
            ) : (
              <SingboxOutboundForm
                // Форма держит локальный текст полей-списков и читает значение
                // при монтировании: без ключа переход на соседний выход показал
                // бы списки прежнего
                key={shownId}
                value={outbound}
                knownTags={outboundTagsOf(doc)}
                onChange={changeOutbound}
              />
            ))}
          {kind === 'rule' &&
            (rulesOf(doc)[ruleIndex] === undefined ? (
              <p className="muted">Правила #{ruleIndex + 1} в документе больше нет.</p>
            ) : (
              <SingboxRuleForm
                key={shownId}
                value={rulesOf(doc)[ruleIndex]!}
                outboundTags={outboundTagsOf(doc)}
                ruleSetTags={ruleSetTagsOf(doc)}
                onChange={changeRule}
              />
            ))}
          {kind === 'inbound' &&
            (() => {
              const inbound = (Array.isArray(doc.inbounds) ? doc.inbounds : []).find(
                (i) => i.tag === name,
              )
              return inbound === undefined ? (
                <p className="muted">Входа «{name}» в документе больше нет.</p>
              ) : (
                <SingboxInboundForm key={shownId} value={inbound} onChange={changeInbound} />
              )
            })()}
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
