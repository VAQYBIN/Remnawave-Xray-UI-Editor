// Коммутация кабелем и правки структуры документа. Каждая операция возвращает
// НОВЫЙ документ либо причину отказа; вход не мутируется никогда — его ещё
// держит React, и правка на месте не вызвала бы перерисовку.
//
// Пустой результат сам по себе ничего не объясняет, а кабель, отскакивающий
// молча, читается как поломка редактора, — поэтому причина обязательна и
// переводится на русский в одном месте.

import { GROUP_OUTBOUND_TYPES, panelFillsGroup } from '../../singbox/outbounds'
import { rulesOf } from '../../singbox/rules'
import type { SingboxDoc, SingboxRule } from '../../singbox/types'

type NodeKind = 'inbound' | 'rule' | 'group' | 'out' | 'hosts' | 'builtin'

function split(id: string): { kind: NodeKind; rest: string } | null {
  const at = id.indexOf(':')
  if (at < 0) return null
  const kind = id.slice(0, at)
  if (
    kind !== 'inbound' &&
    kind !== 'rule' &&
    kind !== 'group' &&
    kind !== 'out' &&
    kind !== 'hosts' &&
    kind !== 'builtin'
  ) {
    return null
  }
  return { kind, rest: id.slice(at + 1) }
}

export function isValidSingboxConnection(source: string, target: string): boolean {
  const from = split(source)
  const to = split(target)
  if (from === null || to === null) return false
  // Узел подстановки закрыт с обеих сторон: его содержимое создаёт панель, и
  // кабелем оно не задаётся — ребро сюда рисует граф по факту заполнения
  if (from.kind === 'hosts' || to.kind === 'hosts') return false
  // Вход не привязан к маршруту у sing-box: связь задаёт правило полем inbound,
  // а не кабель
  if (from.kind === 'inbound' || to.kind === 'inbound') return false
  if (to.kind === 'rule' || to.kind === 'builtin') return false
  return from.kind === 'rule' || from.kind === 'group'
}

export type SingboxRefusal =
  | 'invalid-pair'
  | 'already-connected'
  | 'panel-fills-group'
  | 'panel-hosts-edge'
  | 'rule-target-required'
  | 'not-found'

export function singboxRefusalText(refusal: SingboxRefusal): string {
  switch (refusal) {
    case 'invalid-pair':
      return 'Такие узлы не соединяются.'
    case 'already-connected':
      return 'Связь уже есть — документ от повтора не изменится.'
    case 'panel-fills-group':
      return 'Список этой группы заполняет панель: она затрёт его целиком тегами серверов подписки, и дописанное здесь исчезнет при первой же выдаче. Чтобы править список руками, закрепите его — это ключ remnawave.includeProxies: false в форме группы.'
    case 'panel-hosts-edge':
      return 'Эту связь создаёт панель, а не документ: серверы подписки она подставит в группу сама. Записи под это ребро в документе нет — разрывать нечего.'
    case 'rule-target-required':
      return 'У правила цель обязательна: правило без выхода ядру не конфиг. Связь можно сменить, но не убрать.'
    case 'not-found':
      return 'Узел или связь в документе не найдены.'
  }
}

export interface SingboxEditResult {
  doc?: SingboxDoc
  /** undefined — правка построена; иначе документа нет, и здесь причина */
  refusal?: SingboxRefusal
}

/** Глубокая копия: вход — документ, который ещё держит React */
function clone(doc: SingboxDoc): SingboxDoc {
  return structuredClone(doc) as SingboxDoc
}

function findOutbound(doc: SingboxDoc, tag: string): number {
  const list = Array.isArray(doc.outbounds) ? doc.outbounds : []
  return list.findIndex((o) => o.tag === tag)
}

/**
 * Где физически лежит выход с этим тегом. Списка два: `outbounds` и `endpoints`
 * (wireguard и прочие «конечные точки» ядра 1.11+), а узел на графе у них ОДИН —
 * `out:<tag>`. Без этой развилки удаление такого узла отвечало бы «не найдено»
 * про карточку, которую пользователь видит на холсте.
 */
function findOutboundSlot(
  doc: SingboxDoc,
  tag: string,
): { key: 'outbounds' | 'endpoints'; at: number } | null {
  const at = findOutbound(doc, tag)
  if (at >= 0) return { key: 'outbounds', at }
  const endpoints = Array.isArray(doc.endpoints) ? doc.endpoints : []
  const found = endpoints.findIndex((e) => e.tag === tag)
  return found < 0 ? null : { key: 'endpoints', at: found }
}

/** Имя узла-цели по его id: и группа, и выход адресуются одним и тем же тегом */
function targetTag(id: string): string | null {
  const to = split(id)
  return to === null || (to.kind !== 'group' && to.kind !== 'out') ? null : to.rest
}

/** Правило по индексу из id узла. Индекс приходит строкой, и нецелый — не «нулевое правило» */
function ruleAt(doc: SingboxDoc, index: number): SingboxRule | undefined {
  return Number.isInteger(index) ? rulesOf(doc)[index] : undefined
}

export function connectSingbox(doc: SingboxDoc, source: string, target: string): SingboxEditResult {
  if (!isValidSingboxConnection(source, target)) return { refusal: 'invalid-pair' }
  const from = split(source)!
  const tag = targetTag(target)
  if (tag === null) return { refusal: 'invalid-pair' }

  if (from.kind === 'rule') {
    const index = Number(from.rest)
    const rule = ruleAt(doc, index)
    if (rule === undefined) return { refusal: 'not-found' }
    // Тот же выход при живом action связью ещё не является: правку надо
    // выполнить, иначе отказ «уже соединено» соврал бы про действующий маршрут
    if (rule.outbound === tag && rule.action === undefined) return { refusal: 'already-connected' }
    const next = clone(doc)
    const edited = next.route!.rules![index]!
    edited.outbound = tag
    // Действие маршрутное: правило с action: reject и полем outbound ядро
    // прочитает как reject, и кабель тянулся бы вхолостую
    delete edited.action
    return { doc: next }
  }

  const at = findOutbound(doc, from.rest)
  if (at < 0) return { refusal: 'not-found' }
  const group = doc.outbounds![at]!
  if (!GROUP_OUTBOUND_TYPES.has(group.type)) return { refusal: 'invalid-pair' }
  if (panelFillsGroup(group)) return { refusal: 'panel-fills-group' }
  const listed = Array.isArray(group.outbounds) ? group.outbounds : []
  if (listed.includes(tag)) return { refusal: 'already-connected' }
  const next = clone(doc)
  next.outbounds![at]!.outbounds = [...listed, tag]
  return { doc: next }
}

const EDGE_RE = /^e:sb(in|rule|group):(.+?)->(.+)$/

export function disconnectSingbox(doc: SingboxDoc, edgeId: string): SingboxEditResult {
  const match = EDGE_RE.exec(edgeId)
  if (match === null) return { refusal: 'not-found' }
  const [, from, owner, target] = match
  if (target === 'hosts:panel') return { refusal: 'panel-hosts-edge' }
  if (from === 'rule') return { refusal: 'rule-target-required' }
  // Ребро «вход → правило» нарисовано полем inbound самого правила: разрыв
  // кабеля правил бы не тот конец связи
  if (from === 'in') return { refusal: 'invalid-pair' }

  const at = findOutbound(doc, owner!)
  if (at < 0) return { refusal: 'not-found' }
  const group = doc.outbounds![at]!
  if (panelFillsGroup(group)) return { refusal: 'panel-fills-group' }
  const tag = targetTag(target!)
  if (tag === null) return { refusal: 'not-found' }
  const listed = Array.isArray(group.outbounds) ? group.outbounds : []
  if (!listed.includes(tag)) return { refusal: 'not-found' }
  const next = clone(doc)
  next.outbounds![at]!.outbounds = listed.filter((t) => t !== tag)
  return { doc: next }
}

/** Новое правило. `at === undefined` — в конец: у sing-box выигрывает ПЕРВОЕ совпавшее */
export function addRule(doc: SingboxDoc, rule: SingboxRule, at?: number): SingboxDoc {
  const next = clone(doc)
  next.route ??= {}
  const rules = Array.isArray(next.route.rules) ? next.route.rules : []
  const index = at === undefined ? rules.length : Math.max(0, Math.min(at, rules.length))
  next.route.rules = [...rules.slice(0, index), rule, ...rules.slice(index)]
  return next
}

/** Где лежит выход с тегом — наружу, с индексом: инспектору нужен порядок в списке */
export function outboundSlot(doc: SingboxDoc, tag: string): { key: 'outbounds' | 'endpoints'; at: number } | null {
  return findOutboundSlot(doc, tag)
}
