// Маршрут: корневые ключи, правила с действиями, наборы правил. Поля действия
// у правила лежат плоско, как у DNS: `outbound` — поле действия route, которое
// подразумевается при отсутствующем `action`.
//
// Источник: sing-box.sagernet.org/configuration/route/*, rule-set/* на 2026-09-09.

import type { EnumValue, FieldSchema } from '../../../shared/schema'
import {
  NETWORK_TYPE_VALUES,
  SNIFFER_VALUES,
  STRATEGY_VALUES,
  bool,
  domainResolverObject,
  en,
  num,
  nums,
  obj,
  objs,
  removed,
  str,
  strs,
  tagLabel,
  when,
} from './shared'

export const ROUTE_RULE_ACTION_VALUES: EnumValue[] = [
  { value: 'route', doc: 'Отправить в выход из поля outbound.' },
  { value: 'route-options', doc: 'Изменить параметры маршрута. Подбор правил продолжается.' },
  { value: 'reject', doc: 'Отклонить соединение.' },
  { value: 'hijack-dns', doc: 'Перехватить DNS-запрос во внутренний резолвер.' },
  { value: 'sniff', doc: 'Определить протокол соединения. Подбор правил продолжается.' },
  { value: 'resolve', doc: 'Разрешить домен в адреса. Подбор правил продолжается.' },
  { value: 'bypass', doc: 'Пропустить мимо ядра в системный стек (Linux с auto_redirect, ядро 1.13 и новее).' },
]

/** Матчеры, общие для правила маршрута и headless-правила набора */
const COMMON_MATCHERS: FieldSchema[] = [
  strs('domain', 'Полное совпадение домена.'),
  strs('domain_suffix', 'Суффикс домена. Без ведущей точки совпадает и сам домен, и его поддомены; с ведущей точкой — только поддомены.'),
  strs('domain_keyword', 'Подстрока в домене.'),
  strs('domain_regex', 'Регулярное выражение по домену.'),
  strs('source_ip_cidr', 'Подсеть источника.'),
  strs('ip_cidr', 'Подсеть адреса назначения.'),
  nums('source_port', 'Порт источника.'),
  strs('source_port_range', 'Диапазон портов источника, например 1000:2000.'),
  nums('port', 'Порт назначения.'),
  strs('port_range', 'Диапазон портов назначения, например 1000:2000.'),
  strs('process_name', 'Имя процесса.'),
  strs('process_path', 'Путь процесса.'),
  strs('process_path_regex', 'Регулярное выражение по пути процесса.'),
  strs('package_name', 'Пакет Android.'),
  strs('package_name_regex', 'Регулярное выражение по пакету Android.', { since: '1.14.0' }),
  strs('network_type', 'Тип сети графического клиента.', { values: NETWORK_TYPE_VALUES, since: '1.11.0' }),
  bool('network_is_expensive', 'Сеть с тарификацией.', { since: '1.11.0' }),
  bool('network_is_constrained', 'Режим экономии трафика (Apple).', { since: '1.11.0' }),
  obj('network_interface_address', 'Адреса по типам сети: тип → подсети.', [], { since: '1.13.0' }),
  strs('default_interface_address', 'Подсети интерфейса по умолчанию.', { since: '1.13.0' }),
  strs('wifi_ssid', 'SSID сети Wi-Fi.'),
  strs('wifi_bssid', 'BSSID сети Wi-Fi.'),
  bool('invert', 'Обратить результат проверки условий.'),
  en('type', 'logical — правило объединяет вложенные правила по «и» либо «или».', ['logical']),
  en('mode', 'Для логического правила: and — все вложенные, or — хотя бы одно.', ['and', 'or']),
]

const routeLike = when('action', '', 'route', 'bypass')
const options = when('action', '', 'route', 'bypass', 'route-options')

export const ROUTE_RULE_FIELDS: FieldSchema[] = [
  strs('inbound', 'Теги входов, с которых пришло соединение.', { ref: 'inbound' }),
  num('ip_version', 'Версия IP: 4 или 6.'),
  strs('network', 'Транспорт: tcp, udp или icmp.', { values: [{ value: 'tcp' }, { value: 'udp' }, { value: 'icmp', doc: 'Ядро 1.13 и новее.' }] }),
  strs('auth_user', 'Пользователи входа.'),
  strs('protocol', 'Протокол, определённый сниффингом. Редактор его предсказать не может.', { values: SNIFFER_VALUES }),
  strs('client', 'Клиент, определённый сниффингом.', { values: [{ value: 'chromium' }, { value: 'safari' }, { value: 'firefox' }, { value: 'quic-go' }], since: '1.10.0' }),
  ...COMMON_MATCHERS,
  bool('source_ip_is_private', 'Источник из частного диапазона.'),
  bool('ip_is_private', 'Адрес назначения принадлежит частному диапазону.'),
  strs('user', 'Пользователь системы (Linux).'),
  nums('user_id', 'UID пользователя (Linux).'),
  str('clash_mode', 'Режим, выбранный в клиенте через Clash API. Документом не задаётся.'),
  obj('interface_address', 'Адреса по интерфейсам: имя → подсети.', [], { since: '1.13.0' }),
  strs('preferred_by', 'Выходы, предпочитающие адрес назначения.', { since: '1.13.0' }),
  strs('source_mac_address', 'MAC-адреса источника.', { since: '1.14.0' }),
  strs('source_hostname', 'Имена хостов источника из DHCP.', { since: '1.14.0' }),
  strs('rule_set', 'Теги наборов правил. Содержимое набора лежит по ссылке, редактор его не скачивает.', { ref: 'rule-set' }),
  bool('rule_set_ip_cidr_match_source', 'ip_cidr наборов сравнивать с источником.'),
  strs('geosite', 'Категории geosite.', { deprecated: removed('1.8.0', 'наборы правил rule_set') }),
  strs('geoip', 'Категории geoip.', { deprecated: removed('1.8.0', 'наборы правил rule_set') }),
  strs('source_geoip', 'Категории geoip источника.', { deprecated: removed('1.8.0', 'наборы правил rule_set') }),
  bool('rule_set_ipcidr_match_source', 'Старое имя rule_set_ip_cidr_match_source.', { deprecated: removed('1.10.0', 'rule_set_ip_cidr_match_source') }),

  // ── действие и его поля ──
  en('action', 'Что сделать с соединением. Без этого поля правило считается маршрутным.', ROUTE_RULE_ACTION_VALUES),
  str('outbound', 'Тег выхода, в который уйдёт совпавшее соединение.', { ref: 'outbound', when: routeLike }),
  str('override_address', 'Подменить адрес назначения.', { when: options }),
  num('override_port', 'Подменить порт назначения.', { when: options }),
  en('network_strategy', 'Стратегия выбора сети.', ['default', 'hybrid', 'fallback'], { when: options, since: '1.11.0' }),
  strs('network_type', 'Предпочитаемые типы сети.', { values: NETWORK_TYPE_VALUES, when: when('action', 'route-options'), since: '1.11.0' }),
  strs('fallback_network_type', 'Запасные типы сети.', { values: NETWORK_TYPE_VALUES, when: options, since: '1.11.0' }),
  str('fallback_delay', 'Задержка перед запасной сетью.', { when: options, since: '1.11.0' }),
  bool('udp_disable_domain_unmapping', 'Не сопоставлять UDP-ответы обратно с доменом.', { when: options }),
  bool('udp_connect', 'Подключённый UDP.', { when: options }),
  str('udp_timeout', 'Время жизни UDP-сессии.', { when: options }),
  bool('tls_fragment', 'Дробить ClientHello на сегменты.', { when: options, since: '1.12.0' }),
  str('tls_fragment_fallback_delay', 'Откат без дробления через это время, по умолчанию 500ms.', { when: options, since: '1.12.0' }),
  bool('tls_record_fragment', 'Дробить ClientHello на TLS-записи.', { when: options, since: '1.12.0' }),
  str('tls_spoof', 'Поддельное имя сервера.', { when: options, since: '1.14.0' }),
  en('tls_spoof_method', 'Способ подмены.', ['wrong-sequence', 'wrong-checksum', 'wrong-ack', 'wrong-md5', 'wrong-timestamp'], { when: options, since: '1.14.0' }),
  en('method', 'Как отклонять: default — сброс, drop — молча, reply — ответ ICMP.', ['default', 'drop', 'reply'], { when: when('action', 'reject') }),
  bool('no_drop', 'Не переходить в drop после частых срабатываний.', { when: when('action', 'reject') }),
  strs('sniffer', 'Какие снифферы включить; пусто — все.', { values: SNIFFER_VALUES, when: when('action', 'sniff') }),
  str('timeout', 'Время на определение протокола, по умолчанию 300ms.', { when: when('action', 'sniff') }),
  str('server', 'Тег DNS-сервера для резолва.', { ref: 'dns-server', when: when('action', 'resolve') }),
  en('strategy', 'Какие адреса запрашивать.', STRATEGY_VALUES, { when: when('action', 'resolve') }),
  bool('disable_cache', 'Не кэшировать ответ.', { when: when('action', 'resolve'), since: '1.12.0' }),
  bool('disable_optimistic_cache', 'Не отдавать протухший кэш.', { when: when('action', 'resolve'), since: '1.14.0' }),
  num('rewrite_ttl', 'Переписать TTL ответа.', { when: when('action', 'resolve'), since: '1.12.0' }),
  str('client_subnet', 'EDNS0 client-subnet.', { when: when('action', 'resolve'), since: '1.12.0' }),
]

// `network_type` описан дважды: у route-options это отдельное поле действия,
// а общий матчер того же имени стоит в COMMON_MATCHERS без условия. Чтобы в
// видимом наборе ключ был один, матчер получает условие «не route-options».
// Элементы COMMON_MATCHERS разделяются с HEADLESS_RULE_FIELDS (тот же спред
// массива, те же объекты) — правка на месте протекла бы туда, поэтому слот
// заменяется свежим объектом, а не мутируется.
{
  const idx = ROUTE_RULE_FIELDS.findIndex((f) => f.key === 'network_type' && f.when === undefined)
  ROUTE_RULE_FIELDS[idx] = { ...ROUTE_RULE_FIELDS[idx], when: { key: 'action', notIn: ['route-options'] } }
}

ROUTE_RULE_FIELDS.push(
  objs('rules', 'Вложенные правила логического правила.', ROUTE_RULE_FIELDS, {
    label: (_v, i) => `правило #${i + 1}`,
    starter: () => ({}),
  }),
)

/** Правило внутри набора: без входов, режима Clash, наборов и действия */
export const HEADLESS_RULE_FIELDS: FieldSchema[] = [
  strs('query_type', 'Типы DNS-запросов.'),
  strs('network', 'Транспорт: tcp или udp.', { values: [{ value: 'tcp' }, { value: 'udp' }] }),
  ...COMMON_MATCHERS,
]

HEADLESS_RULE_FIELDS.push(
  objs('rules', 'Вложенные правила логического правила.', HEADLESS_RULE_FIELDS, {
    label: (_v, i) => `правило #${i + 1}`,
    starter: () => ({}),
  }),
)

const remote = when('type', 'remote')

export const RULE_SET_FIELDS: FieldSchema[] = [
  str('tag', 'Имя набора: по нему на набор ссылаются правила.'),
  en('type', 'Откуда берётся набор.', [
    { value: 'remote', doc: 'Скачивается по ссылке.' },
    { value: 'local', doc: 'Читается из файла на устройстве.' },
    { value: 'inline', doc: 'Записан прямо в конфиге (ядро 1.10 и новее).' },
  ]),
  en('format', 'Формат набора: binary (.srs) или source (.json).', ['binary', 'source'], { when: when('type', 'remote', 'local') }),
  str('path', 'Путь к локальному файлу набора.', { when: when('type', 'local') }),
  str('url', 'Ссылка на удалённый набор.', { when: remote }),
  str('initial_path', 'Локальный файл, с которого начать до первой загрузки.', { when: remote, since: '1.14.0' }),
  str('http_client', 'Тег HTTP-клиента для загрузки.', { when: remote, since: '1.14.0' }),
  str('update_interval', 'Как часто обновлять набор, например 1d.', { when: remote }),
  str('download_detour', 'Через какой выход скачивать набор.', { ref: 'outbound', when: remote, deprecated: removed('1.14.0', 'http_client') }),
  objs('rules', 'Правила набора.', HEADLESS_RULE_FIELDS, {
    label: (_v, i) => `правило #${i + 1}`,
    starter: () => ({}),
  }, { when: when('type', 'inline') }),
]

export const ROUTE_FIELDS: FieldSchema[] = [
  objs('rules', 'Правила маршрутизации по порядку: выигрывает первое совпавшее.', ROUTE_RULE_FIELDS, {
    label: (_v, i) => `правило #${i + 1}`,
    starter: () => ({ domain: [], outbound: 'direct' }),
  }),
  objs('rule_set', 'Наборы правил: локальные файлы, удалённые .srs по ссылке или встроенные.', RULE_SET_FIELDS, {
    label: tagLabel,
    starter: () => ({ type: 'remote', tag: '', format: 'binary', url: '' }),
  }),
  str('final', 'Выход для трафика, не совпавшего ни с одним правилом. Если поле пусто, ядро возьмёт ПЕРВЫЙ выход из outbounds.', { ref: 'outbound' }),
  bool('auto_detect_interface', 'Определять исходящий интерфейс автоматически.'),
  bool('override_android_vpn', 'Перехватывать ли трафик другого VPN на Android.'),
  str('default_interface', 'Исходящий интерфейс по умолчанию.'),
  num('default_mark', 'Метка исходящих соединений в Linux.'),
  domainResolverObject('default_domain_resolver', 'Каким DNS-сервером разрешать домены при исходящих соединениях.', { since: '1.12.0' }),
  en('default_network_strategy', 'Стратегия выбора сети по умолчанию.', ['default', 'hybrid', 'fallback'], { since: '1.11.0' }),
  strs('default_network_type', 'Предпочитаемые типы сети.', { values: NETWORK_TYPE_VALUES, since: '1.11.0' }),
  strs('default_fallback_network_type', 'Запасные типы сети.', { values: NETWORK_TYPE_VALUES, since: '1.11.0' }),
  str('default_fallback_delay', 'Задержка перед запасной сетью.', { since: '1.11.0' }),
  str('default_http_client', 'Каким HTTP-клиентом скачивать удалённые наборы правил.', { since: '1.14.0' }),
  bool('find_process', 'Искать процесс соединения даже без правил по процессу.'),
  bool('find_neighbor', 'Опрашивать соседей по сети.', { since: '1.14.0' }),
  strs('dhcp_lease_files', 'Файлы аренды DHCP для имён хостов.', { since: '1.14.0' }),
  obj('geoip', 'Старая база geoip.', [], { deprecated: removed('1.8.0', 'наборы правил rule_set') }),
  obj('geosite', 'Старая база geosite.', [], { deprecated: removed('1.8.0', 'наборы правил rule_set') }),
  en('default_domain_strategy', 'Стратегия резолва доменов по умолчанию.', STRATEGY_VALUES, { deprecated: removed('1.12.0', 'default_domain_resolver') }),
]
