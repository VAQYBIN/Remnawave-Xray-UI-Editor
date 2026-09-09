// Корень схемы Mihomo и помощники поверх общего разбора. Ветви собраны из
// своих файлов; здесь только сборка, спуск по пути, имена для ссылок и разделы
// панели «Документ». Прежний плоский словарь docSchema.ts заменён этим деревом:
// формы, подсказки и валидация читают ОДНО описание.

import type { MihomoDoc } from '../parse'
import { groupsOf, providersOf, proxiesOf, ruleProvidersOf, subRuleNames } from '../groups'
import { BUILTIN_TARGETS } from '../resolve'
import { fieldAt, fieldsAt, nameLabel, obj, objs, strs, type DocSection, type FieldSchema, type RefKind, type SchemaPath } from '../../../shared/schema'
import { DNS_FIELDS } from './dns'
import { GROUP_FIELDS } from './groups'
import { LISTENER_FIELDS, TUNNEL_FIELDS } from './listeners'
import { EXPERIMENTAL_FIELDS, NTP_FIELDS, PROFILE_FIELDS, hostsField } from './misc'
import { PROVIDER_FIELDS, RULE_PROVIDER_FIELDS } from './providers'
import { PROXY_FIELDS } from './proxies'
import { ROOT_FIELDS } from './root'
import { SNIFFER_FIELDS } from './sniffer'
import { TUN_FIELDS } from './tun'

export * from './shared'
export * from './root'
export * from './misc'
export * from './dns'
export * from './tun'
export * from './sniffer'
export * from './proxies'
export * from './groups'
export * from './providers'
export * from './listeners'

/**
 * Отображения записей по имени (`proxy-providers`, `rule-providers`,
 * `sub-rules`) описаны как `map` с `fields` записи: `fieldsAt` спускается
 * в них по ИМЕНИ ключа так же, как в элемент списка по индексу — см. правку
 * `resolve.ts` в этой задаче.
 */
const mapOf = (key: string, doc: string, fields: FieldSchema[]): FieldSchema => ({ key, doc, kind: 'map', fields })

export const MIHOMO_SCHEMA: FieldSchema[] = [
  ...ROOT_FIELDS,
  obj('profile', 'Что ядро помнит между перезапусками.', PROFILE_FIELDS),
  obj('experimental', 'Экспериментальные тумблеры.', EXPERIMENTAL_FIELDS),
  obj('ntp', 'Синхронизация времени.', NTP_FIELDS),
  hostsField(),
  obj('dns', 'Встроенный резолвер: серверы, fake-ip, политики по доменам. Работает при enable: true.', DNS_FIELDS, {
    starter: () => ({ enable: true, 'enhanced-mode': 'fake-ip', 'fake-ip-range': '198.18.0.1/16', 'default-nameserver': ['1.1.1.1', '8.8.8.8'], nameserver: ['1.1.1.1', '8.8.8.8'] }),
  }),
  obj('tun', 'Приём всего трафика системы через виртуальный интерфейс.', TUN_FIELDS),
  obj('sniffer', 'Определение домена по содержимому соединения (SNI, Host).', SNIFFER_FIELDS),
  objs('listeners', 'Дополнительные входы сверх портов корня.', LISTENER_FIELDS, { label: nameLabel, starter: () => ({ name: '', type: 'mixed', listen: '127.0.0.1', port: 7890 }) }),
  objs('tunnels', 'Проброс локального порта на цель через прокси.', TUNNEL_FIELDS, { label: (_v, i) => `туннель #${i + 1}`, starter: () => ({ network: ['tcp', 'udp'], address: '127.0.0.1:0', target: '', proxy: '' }) }),
  objs('proxies', 'Серверы. В шаблоне подписки их подставляет панель — В КОНЕЦ этого списка; статические записи ставятся впереди.', PROXY_FIELDS, { label: nameLabel, starter: () => ({ name: '', type: 'direct', udp: true }) }),
  objs('proxy-groups', 'Группы выбора и балансировки.', GROUP_FIELDS, { label: nameLabel, starter: () => ({ name: '', type: 'select' }) }),
  mapOf('proxy-providers', 'Внешние источники серверов.', PROVIDER_FIELDS),
  mapOf('rule-providers', 'Внешние наборы правил.', RULE_PROVIDER_FIELDS),
  strs('rules', 'Правила маршрутизации: сверху вниз, побеждает первое совпавшее.'),
  mapOf('sub-rules', 'Именованные подсписки правил для SUB-RULE.', []),
]

/** Ключи корня, у которых свой раздел панели либо холст: в разделе «Общие» они не повторяются */
export const ROOT_SKIP = ['proxies', 'proxy-groups', 'proxy-providers', 'rule-providers', 'rules', 'sub-rules', 'dns', 'tun', 'sniffer', 'profile', 'ntp', 'experimental', 'listeners', 'tunnels']

export function mihomoFieldsAt(path: SchemaPath, json: unknown): FieldSchema[] | undefined {
  return fieldsAt(MIHOMO_SCHEMA, path, json)
}

export function mihomoFieldAt(path: SchemaPath, json: unknown): FieldSchema | undefined {
  return fieldAt(MIHOMO_SCHEMA, path, json)
}

/**
 * Имена документа для полей со ссылкой. Цель маршрута — ОДНО пространство:
 * группы, статические серверы и встроенные цели адресуются из правила одним
 * полем, и предложить только группы значило бы скрыть половину холста.
 */
export function mihomoRefs(md: MihomoDoc): Partial<Record<RefKind, string[]>> {
  return {
    'proxy-target': [...groupsOf(md).map((g) => g.name), ...proxiesOf(md).map((p) => p.name), ...BUILTIN_TARGETS],
    provider: providersOf(md).map((p) => p.name),
    'rule-set': ruleProvidersOf(md).map((r) => r.name),
    'sub-rule': subRuleNames(md),
  }
}

export const MIHOMO_DOC_SECTIONS: DocSection[] = [
  { title: 'Общие', path: [], kind: 'object', skip: ROOT_SKIP },
  { title: 'DNS', path: ['dns'], kind: 'object' },
  { title: 'TUN', path: ['tun'], kind: 'object' },
  { title: 'Снифер', path: ['sniffer'], kind: 'object' },
  { title: 'Профиль', path: ['profile'], kind: 'object' },
  { title: 'NTP', path: ['ntp'], kind: 'object' },
  { title: 'Экспериментальное', path: ['experimental'], kind: 'object' },
  { title: 'Входы', path: ['listeners'], kind: 'list' },
  { title: 'Туннели', path: ['tunnels'], kind: 'list' },
  { title: 'Наборы правил', path: ['rule-providers'], kind: 'map' },
  { title: 'Провайдеры', path: ['proxy-providers'], kind: 'map' },
  { title: 'Подсписки', path: ['sub-rules'], kind: 'map' },
]
