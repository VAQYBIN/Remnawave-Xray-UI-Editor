// Правила маршрута: из чего они состоят и что редактор о них знает.
//
// Деление условий на проверяемые и непроверяемые — не вкусовщина, а граница
// знания редактора. Всё, что зависит от клиента (режим Clash), от системы
// (процесс, интерфейс, Wi-Fi), от источника соединения или от результата
// сниффинга, документ не содержит и содержать не может.

import type { SingboxDoc, SingboxRule } from './types'

/**
 * Условия, ответ на которые даёт сама цель трассировки.
 *
 * `network` стоит здесь, хотя транспорт — свойство соединения, а не документа:
 * цель трассировки в проекте общая (`TraceTarget`), и транспорт в ней вводит сам
 * пользователь. Оставить условие останавливающим значило бы объяснять остановку
 * фразой «транспорт цели трассировки неизвестен» — то есть соврать человеку про
 * то, что он только что набрал, и отправить его искать несуществующую причину.
 */
export const CHECKABLE_CONDITIONS: ReadonlySet<string> = new Set([
  'domain',
  'domain_suffix',
  'domain_keyword',
  'domain_regex',
  'ip_cidr',
  'ip_is_private',
  'port',
  'port_range',
  'network',
])

// Списка «непроверяемых условий» здесь намеренно НЕТ. Проверяемые перечислены
// выше, а всё остальное непроверяемо по определению — включая поле, которое
// ядро добавит завтра. Закрытый список опасен ровно наоборот: незнакомое поле
// не попало бы в него и молча сошло бы за проверенное.
//
// Действия, завершающие подбор (`route`, `bypass`, `reject`, `hijack-dns`),
// тоже не перечисляются: терминально всё, что не входит в список ниже.

/** Действия, после которых подбор продолжается со следующего правила */
export const NON_TERMINAL_ACTIONS: ReadonlySet<string> = new Set([
  'route-options',
  'sniff',
  'resolve',
])

/**
 * Поля правила, которые условиями НЕ являются. Список закрытый: всё
 * незнакомое считается условием, и трассировка на нём остановится. Обратный
 * выбор («незнакомое — служебное») дал бы уверенный неверный ответ.
 */
const SERVICE_KEYS: ReadonlySet<string> = new Set([
  'action',
  'outbound',
  'type',
  'mode',
  'rules',
  'invert',
  'server',
  'strategy',
  'disable_cache',
  'rewrite_ttl',
  'client_subnet',
  'override_address',
  'override_port',
  'udp_disable_domain_unmapping',
  'udp_connect',
  'udp_timeout',
  'timeout',
  'sniffer',
  'method',
  'no_drop',
])

export function rulesOf(doc: SingboxDoc): SingboxRule[] {
  return Array.isArray(doc.route?.rules) ? doc.route.rules : []
}

export function ruleSetTagsOf(doc: SingboxDoc): string[] {
  const sets = Array.isArray(doc.route?.rule_set) ? doc.route.rule_set : []
  return sets.map((s) => s.tag).filter((tag): tag is string => typeof tag === 'string')
}

/** Правило без `action` ядро считает маршрутным — старая форма записи всё ещё жива */
export function ruleAction(rule: SingboxRule): string {
  return typeof rule.action === 'string' ? rule.action : 'route'
}

export function ruleTarget(rule: SingboxRule): string | undefined {
  if (ruleAction(rule) !== 'route') return undefined
  return typeof rule.outbound === 'string' ? rule.outbound : undefined
}

export function isLogicalRule(rule: SingboxRule): boolean {
  return rule.type === 'logical'
}

export function conditionKeysOf(rule: SingboxRule): string[] {
  return Object.keys(rule).filter((key) => !SERVICE_KEYS.has(key))
}
