// Записи `proxy-providers.<имя>` и `rule-providers.<имя>`: внешние источники
// серверов и наборов правил. Общий вид источника (http/file/inline) и заголовки
// скачивания повторяются у обоих — списки типов не объединены намеренно: у
// провайдера серверов нет `behavior`/`format`, у набора правил нет `override`.
// Источник: wiki.metacubex.one/config/proxy-providers,
// wiki.metacubex.one/config/rule-providers, docs/config.yaml ядра (ветка Meta,
// 2026-09-09).

import { bool, en, map, num, obj, objs, str, strs, when, type FieldSchema } from '../../../shared/schema'
import { IP_VERSION_VALUES, dialerProxy } from './shared'
import { PROXY_FIELDS } from './proxies'

const SOURCE_TYPES = [
  { value: 'http', doc: 'Скачать по url.' },
  { value: 'file', doc: 'Взять из локального файла (path).' },
  { value: 'inline', doc: 'Содержимое задано прямо в шаблоне (payload).' },
]

const HEALTH_CHECK_FIELDS: FieldSchema[] = [
  bool('enable', 'Включить периодическую проверку живости.'),
  str('url', 'Адрес проверки живости.'),
  num('interval', 'Период проверки, секунд.'),
  bool('lazy', 'Не проверять, пока провайдер не используется.'),
  num('timeout', 'Таймаут проверки, мс.'),
  str('expected-status', 'Ожидаемые коды ответа.'),
]

const OVERRIDE_FIELDS: FieldSchema[] = [
  str('additional-prefix', 'Префикс к именам всех серверов провайдера.'),
  str('additional-suffix', 'Суффикс к именам.'),
  objs('proxy-name', 'Замена имени по регулярному выражению.', [str('pattern', 'Шаблон.'), str('target', 'Замена (поддерживает $1).')], { label: (v, i) => `замена #${i + 1}` }),
  bool('skip-cert-verify', 'Не проверять сертификаты.'),
  str('name-cert-verify', 'DNSName для проверки сертификата.'),
  bool('udp', 'Разрешить UDP.'),
  bool('udp-over-tcp', 'UDP поверх TCP.'),
  bool('tfo', 'TCP Fast Open.'),
  bool('mptcp', 'Multipath TCP.'),
  str('down', 'Скорость приёма, например 50 Mbps.'),
  str('up', 'Скорость отдачи.'),
  dialerProxy(),
  str('interface-name', 'Исходящий интерфейс.'),
  num('routing-mark', 'fwmark (Linux).'),
  en('ip-version', 'Версия IP.', IP_VERSION_VALUES),
  strs('override-expr', 'Выражения в стиле yq v4; применяются после фиксированных полей по порядку.'),
]

/** Запись `proxy-providers.<имя>` */
export const PROVIDER_FIELDS: FieldSchema[] = [
  en('type', 'Откуда брать список серверов.', SOURCE_TYPES),
  str('url', 'Адрес скачивания.', { when: when('type', 'http') }),
  str('path', 'Локальный путь файла или кэша.', { when: when('type', 'http', 'file') }),
  num('interval', 'Период обновления, секунд.', { when: when('type', 'http') }),
  str('proxy', 'Через какую группу или сервер скачивать.', { ref: 'proxy-target', when: when('type', 'http') }),
  num('size-limit', 'Предел размера файла, байт; 0 — без предела.', { when: when('type', 'http') }),
  str('age-secret-key', 'Ключ расшифровки age-armor.', { when: when('type', 'http', 'file') }),
  map('header', 'HTTP-заголовки скачивания; значение — список строк.', { values: 'strings', when: when('type', 'http') }),
  obj('health-check', 'Проверка живости серверов провайдера.', HEALTH_CHECK_FIELDS),
  str('filter', 'Регулярное выражение: в провайдер попадут только подходящие имена.'),
  str('exclude-filter', 'Регулярное выражение: подходящие имена исключаются.'),
  str('exclude-type', 'Типы серверов, которые не берутся, через |.'),
  dialerProxy({ when: when('type', 'inline') }),
  objs('payload', 'Серверы прямо в шаблоне (type: inline).', PROXY_FIELDS, { label: (v, i) => ((v as { name?: unknown } | null)?.name as string) || `сервер #${i + 1}`, starter: () => ({ name: '', type: 'ss', server: '', port: 443 }) }, { when: when('type', 'inline') }),
  obj('override', 'Перекрытие полей серверов при загрузке.', OVERRIDE_FIELDS),
  obj('remnawave', 'Ключи панели Remnawave; в подписку не попадают.', [
    bool('include-proxies', 'true — панель подменит payload полными объектами подставленных хостов (для цепочки через dialer-proxy).', { panelKey: true }),
  ], { panelKey: true }),
]

/** Запись `rule-providers.<имя>` */
export const RULE_PROVIDER_FIELDS: FieldSchema[] = [
  en('type', 'Откуда брать содержимое набора.', SOURCE_TYPES),
  en('behavior', 'Формат содержимого.', [
    { value: 'domain', doc: 'Список доменов.' },
    { value: 'ipcidr', doc: 'Список подсетей.' },
    { value: 'classical', doc: 'Классические строки правил.' },
  ]),
  en('format', 'Формат файла.', [
    { value: 'yaml', doc: 'YAML (по умолчанию).' },
    { value: 'text', doc: 'Текст, по записи на строку.' },
    { value: 'mrs', doc: 'Двоичный формат mihomo; только domain и ipcidr.' },
  ], { when: when('type', 'http', 'file') }),
  str('url', 'Адрес скачивания.', { when: when('type', 'http') }),
  str('path', 'Локальный путь файла.', { when: when('type', 'http', 'file') }),
  str('path-in-bundle', 'Путь внутри BundleMRS.7z для распаковки при отсутствии файла.', { when: when('type', 'http', 'file') }),
  num('interval', 'Период обновления, секунд.', { when: when('type', 'http') }),
  str('proxy', 'Через какую группу или сервер скачивать.', { ref: 'proxy-target', when: when('type', 'http') }),
  num('size-limit', 'Предел размера файла, байт.', { when: when('type', 'http') }),
  map('header', 'HTTP-заголовки скачивания.', { values: 'strings', when: when('type', 'http') }),
  strs('payload', 'Содержимое прямо в шаблоне (type: inline).', { when: when('type', 'inline') }),
]
