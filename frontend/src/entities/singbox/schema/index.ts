// Корень схемы sing-box и помощники поверх общего разбора. Ветви собраны из
// своих файлов; здесь только сборка, спуск по пути и теги для ссылок.
//
// Целевая версия ядра у панели — 1.13.x; ключи 1.14 помечены since, удалённые
// — deprecated с заменой. Схема ОПИСЫВАЕТ, а не ограничивает: незнакомый ключ
// проходит в документ и не считается ошибкой (см. parse.ts).

import {
  fieldAt,
  fieldsAt,
  type DocSection,
  type EnumValue,
  type FieldSchema,
  type RefKind,
  type SchemaPath,
} from '../../../shared/schema'
import { outboundsOf } from '../outbounds'
import { ruleSetTagsOf } from '../rules'
import type { SingboxDoc } from '../types'
import { DNS_FIELDS } from './dns'
import { ENDPOINT_FIELDS } from './endpoints'
import { INBOUND_FIELDS } from './inbounds'
import { CERTIFICATE_FIELDS, EXPERIMENTAL_FIELDS, LOG_FIELDS, NTP_FIELDS } from './misc'
import { OUTBOUND_FIELDS } from './outbounds'
import { ROUTE_FIELDS } from './route'
import { DIAL_FIELDS, obj, objs, str, tagLabel } from './shared'

export * from './shared'
export * from './outbounds'
export * from './endpoints'
export * from './inbounds'
export * from './dns'
export * from './route'
export * from './misc'

export const SINGBOX_SCHEMA: FieldSchema[] = [
  obj('log', 'Журнал ядра: уровень и вывод.', LOG_FIELDS),
  obj('dns', 'Разрешение имён: свои серверы и свои правила, отдельные от маршрута.', DNS_FIELDS, {
    starter: () => ({
      servers: [
        { tag: 'dns-remote', type: 'tls', server: '1.1.1.1' },
        { tag: 'dns-local', type: 'local' },
      ],
      final: 'dns-local',
    }),
  }),
  obj('ntp', 'Синхронизация времени: нужна там, где системные часы врут, а TLS этого не прощает.', NTP_FIELDS),
  obj('certificate', 'Хранилище доверенных сертификатов.', CERTIFICATE_FIELDS, { since: '1.12.0' }),
  objs('endpoints', 'Конечные точки WireGuard и Tailscale (ядро 1.11 и новее).', ENDPOINT_FIELDS, {
    label: tagLabel,
    starter: () => ({ type: 'wireguard', tag: '', address: [], private_key: '', peers: [] }),
  }),
  objs('inbounds', 'Входы клиента: чем ядро принимает трафик системы.', INBOUND_FIELDS, {
    label: tagLabel,
    starter: () => ({ type: 'mixed', tag: '', listen: '127.0.0.1', listen_port: 2080 }),
  }),
  objs('outbounds', 'Выходы: серверы, группы выбора и прямой выход. Серверы подписки панель дописывает в КОНЕЦ этого списка.', OUTBOUND_FIELDS, {
    label: tagLabel,
    starter: () => ({ type: 'direct', tag: '' }),
  }),
  obj('route', 'Маршрутизация: правила, наборы правил и выход по умолчанию.', ROUTE_FIELDS, { starter: () => ({}) }),
  obj('experimental', 'Экспериментальные разделы: Clash API и файл кэша.', EXPERIMENTAL_FIELDS, {
    starter: () => ({ cache_file: { enabled: true } }),
  }),
  objs('http_clients', 'Именованные HTTP-клиенты: через них ядро скачивает наборы правил.', [str('tag', 'Имя клиента.'), ...DIAL_FIELDS], { label: tagLabel }, { since: '1.14.0' }),
  objs('services', 'Встроенные службы ядра (например, DERP или resolved).', [str('type', 'Тип службы.'), str('tag', 'Имя службы.')], { label: tagLabel }, { since: '1.13.0' }),
]

export function singboxFieldsAt(path: SchemaPath, doc: unknown): FieldSchema[] | undefined {
  return fieldsAt(SINGBOX_SCHEMA, path, doc)
}

export function singboxFieldAt(path: SchemaPath, doc: unknown): FieldSchema | undefined {
  return fieldAt(SINGBOX_SCHEMA, path, doc)
}

/** Известные значения перечисления по пути; пусто, если поле не перечисление */
export function singboxEnum(path: SchemaPath, doc: unknown): EnumValue[] {
  return singboxFieldAt(path, doc)?.enum ?? []
}

const tagsOf = (list: unknown): string[] =>
  (Array.isArray(list) ? list : [])
    .map((item) => (item as { tag?: unknown } | null)?.tag)
    .filter((t): t is string => typeof t === 'string' && t !== '')

/**
 * Теги документа для полей со ссылкой. Выходы — по ОБОИМ спискам: узел
 * out:<tag> граф рисует и по endpoints, и не назови мы такой тег, форма правила
 * предложила бы выбрать не всё, что на холсте.
 * `Partial`, а не полный `Record`: `RefKind` шире видов ссылок sing-box
 * (`provider`/`proxy-target`/`sub-rule` — понятия Mihomo), и документ этого
 * ядра о них сказать ничего не может; потребители и так принимают частичную
 * карту (`Partial<Record<RefKind, string[]>>` у форм и `SchemaForm`).
 */
export function singboxRefs(doc: SingboxDoc): Partial<Record<RefKind, string[]>> {
  return {
    outbound: [...tagsOf(outboundsOf(doc)), ...tagsOf(doc.endpoints)],
    inbound: tagsOf(doc.inbounds),
    'dns-server': tagsOf(doc.dns?.servers),
    'rule-set': ruleSetTagsOf(doc),
  }
}

/**
 * Разделы панели «Документ». Правила маршрута живут на холсте, наборы и
 * списки DNS — своими разделами: у секции-объекта они пропускаются, иначе
 * появились бы дважды.
 */
export const SINGBOX_DOC_SECTIONS: DocSection[] = [
  { title: 'Общие', path: ['log'], kind: 'object' },
  { title: 'DNS', path: ['dns'], kind: 'object', skip: ['servers', 'rules'] },
  { title: 'DNS-серверы', path: ['dns', 'servers'], kind: 'list' },
  { title: 'DNS-правила', path: ['dns', 'rules'], kind: 'list' },
  { title: 'Маршрут', path: ['route'], kind: 'object', skip: ['rules', 'rule_set'] },
  { title: 'Наборы правил', path: ['route', 'rule_set'], kind: 'list' },
  { title: 'Экспериментальное', path: ['experimental'], kind: 'object' },
  { title: 'NTP', path: ['ntp'], kind: 'object' },
  { title: 'Сертификаты', path: ['certificate'], kind: 'object' },
]
