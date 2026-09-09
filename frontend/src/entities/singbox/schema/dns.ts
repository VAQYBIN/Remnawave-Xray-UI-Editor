// DNS: серверы всех типов (1.12 и новее — типизированные, legacy-форма
// описана как устаревшая), правила с действиями и корневые ключи.
//
// Поля действия у правила лежат ПЛОСКО, рядом с матчерами: `server`,
// `disable_cache` и прочие — это поля действия route, которое подразумевается
// при отсутствующем `action`. Условие `in: ['', 'route']` и означает «действие
// не задано или route».
//
// Источник: sing-box.sagernet.org/configuration/dns/* на 2026-09-09.

import type { EnumValue, FieldSchema } from '../../../shared/schema'
import {
  DIAL_FIELDS,
  NETWORK_TYPE_VALUES,
  STRATEGY_VALUES,
  TLS_FIELDS,
  bool,
  en,
  map,
  num,
  nums,
  obj,
  objs,
  removed,
  str,
  strs,
  tagLabel,
  when,
  withWhen,
} from './shared'

export const DNS_SERVER_TYPE_VALUES: EnumValue[] = [
  { value: 'local', doc: 'Системный резолвер устройства.' },
  { value: 'hosts', doc: 'Файл hosts и предопределённые записи (ядро 1.12 и новее).' },
  { value: 'tcp', doc: 'DNS поверх TCP.' },
  { value: 'udp', doc: 'DNS поверх UDP.' },
  { value: 'tls', doc: 'DNS поверх TLS (DoT).' },
  { value: 'quic', doc: 'DNS поверх QUIC (DoQ).' },
  { value: 'https', doc: 'DNS поверх HTTPS (DoH).' },
  { value: 'h3', doc: 'DNS поверх HTTP/3.' },
  { value: 'dhcp', doc: 'Сервер из DHCP.' },
  { value: 'mdns', doc: 'Многоадресный DNS (ядро 1.14 и новее).' },
  { value: 'fakeip', doc: 'Выдаёт подставные адреса из заданного диапазона.' },
  { value: 'tailscale', doc: 'Резолвер узла Tailscale.' },
  { value: 'openconnect', doc: 'Резолвер OpenConnect (ядро 1.14 и новее).' },
  { value: 'openvpn', doc: 'Резолвер OpenVPN (ядро 1.14 и новее).' },
  { value: 'resolved', doc: 'systemd-resolved (ядро 1.12 и новее).' },
]

const NET_SERVERS = ['tcp', 'udp', 'tls', 'quic', 'https', 'h3']
const TLS_SERVERS = ['tls', 'quic', 'https', 'h3']
const DIAL_SERVERS = [...NET_SERVERS, 'dhcp', 'tailscale', 'openconnect', 'openvpn', 'resolved']
const LEGACY = when('type', '')

export const DNS_SERVER_FIELDS: FieldSchema[] = [
  en('type', 'Транспорт запроса. Пусто — старый формат сервера с полем address (удалён в ядре 1.14).', DNS_SERVER_TYPE_VALUES),
  str('tag', 'Имя сервера: по нему на него ссылаются правила DNS.'),
  str('server', 'Адрес DNS-сервера.', { when: when('type', ...NET_SERVERS) }),
  num('server_port', 'Порт сервера; пусто — стандартный для транспорта.', { when: when('type', ...NET_SERVERS) }),
  str('path', 'Путь запроса DoH, по умолчанию /dns-query.', { when: when('type', 'https', 'h3') }),
  map('headers', 'Дополнительные заголовки DoH.', { when: when('type', 'https', 'h3') }),
  obj('tls', 'TLS соединения с сервером.', TLS_FIELDS, { when: when('type', ...TLS_SERVERS) }),
  bool('prefer_go', 'Резолвить самостоятельно, а не через платформу.', { when: when('type', 'local'), since: '1.13.0' }),
  strs('neighbor_domain', 'Суффиксы имён соседей, разрешаемых через mDNS.', { when: when('type', 'local'), since: '1.14.0' }),
  strs('path', 'Пути к файлам hosts; пусто — системный.', { when: when('type', 'hosts') }),
  map('predefined', 'Предопределённые записи: домен → адрес.', { when: when('type', 'hosts') }),
  str('interface', 'Интерфейс, на котором слушать DHCP; пусто — умолчание.', { when: when('type', 'dhcp') }),
  strs('interface', 'Интерфейсы для mDNS-запросов; пусто — все.', { when: when('type', 'mdns') }),
  str('inet4_range', 'Диапазон подставных адресов IPv4 для fakeip.', { when: when('type', 'fakeip') }),
  str('inet6_range', 'Диапазон подставных адресов IPv6 для fakeip.', { when: when('type', 'fakeip') }),
  str('endpoint', 'Тег конечной точки, через которую резолвить.', { ref: 'outbound', when: when('type', 'tailscale', 'openconnect', 'openvpn') }),
  str('service', 'Тег службы resolved.', { when: when('type', 'resolved') }),
  bool('accept_default_resolvers', 'Принимать резолверы по умолчанию для запросов вне зоны.', { when: when('type', 'tailscale', 'openconnect', 'openvpn', 'resolved') }),
  bool('accept_search_domain', 'Повторять однокомпонентные запросы с доменами поиска.', { when: when('type', 'tailscale', 'openconnect', 'openvpn'), since: '1.14.0' }),

  // ── legacy-форма: без type ──
  str('address', 'Адрес сервера старого формата, например tls://1.1.1.1 или local.', { when: LEGACY, deprecated: removed('1.12.0', 'сервер с полем type и адресом в server') }),
  str('address_resolver', 'Тег сервера, которым резолвить домен адреса.', { when: LEGACY, ref: 'dns-server', deprecated: removed('1.12.0', 'поле domain_resolver') }),
  en('address_strategy', 'Стратегия резолва домена адреса.', STRATEGY_VALUES, { when: LEGACY, deprecated: removed('1.12.0', 'поле strategy внутри domain_resolver') }),
  en('strategy', 'Какие адреса запрашивать по умолчанию.', STRATEGY_VALUES, { when: LEGACY, deprecated: removed('1.12.0', 'поле strategy в правиле DNS') }),
  str('client_subnet', 'Подсеть клиента для EDNS0 (client-subnet).', { when: LEGACY, deprecated: removed('1.12.0', 'поле client_subnet в правиле DNS') }),

  // ── dial-поля: сетевым серверам ──
  ...withWhen(DIAL_FIELDS, when('type', ...DIAL_SERVERS, '')),
]

export const DNS_RULE_ACTION_VALUES: EnumValue[] = [
  { value: 'route', doc: 'Отправить запрос серверу из поля server. Действие по умолчанию.' },
  { value: 'route-options', doc: 'Изменить параметры запроса, подбор продолжается.' },
  { value: 'reject', doc: 'Отклонить запрос.' },
  { value: 'predefined', doc: 'Ответить заранее заданной записью (ядро 1.12 и новее).' },
  { value: 'evaluate', doc: 'Спросить сервер и запомнить ответ под тегом (ядро 1.14 и новее).' },
  { value: 'respond', doc: 'Ответить ранее запомненным ответом (ядро 1.14 и новее).' },
]

const routeLike = when('action', '', 'route', 'evaluate')
const options = when('action', '', 'route', 'evaluate', 'route-options')

export const DNS_RULE_FIELDS: FieldSchema[] = [
  // ── матчеры ──
  strs('inbound', 'Теги входов, с которых пришёл запрос.', { ref: 'inbound' }),
  num('ip_version', 'Вид запроса: 4 — A, 6 — AAAA.', { since: '1.14.0' }),
  strs('query_type', 'Типы DNS-запросов: A, AAAA, HTTPS или число.'),
  strs('query_client_subnet', 'Подсети client-subnet запроса.', { since: '1.14.0' }),
  bool('query_dnssec', 'Запрос с битом DNSSEC OK.', { since: '1.14.0' }),
  en('network', 'Транспорт запроса.', [{ value: 'tcp' }, { value: 'udp' }]),
  strs('auth_user', 'Пользователи входа.'),
  strs('protocol', 'Протокол, определённый сниффингом.'),
  strs('domain', 'Полное совпадение домена.'),
  strs('domain_suffix', 'Суффикс домена.'),
  strs('domain_keyword', 'Подстрока в домене.'),
  strs('domain_regex', 'Регулярное выражение по домену.'),
  strs('source_ip_cidr', 'Подсеть источника.'),
  bool('source_ip_is_private', 'Источник из частного диапазона.'),
  nums('source_port', 'Порт источника.'),
  strs('source_port_range', 'Диапазон портов источника, например 1000:2000.'),
  nums('port', 'Порт назначения.'),
  strs('port_range', 'Диапазон портов назначения.'),
  strs('process_name', 'Имя процесса.'),
  strs('process_path', 'Путь процесса.'),
  strs('process_path_regex', 'Регулярное выражение по пути процесса.'),
  strs('package_name', 'Пакет Android.'),
  strs('package_name_regex', 'Регулярное выражение по пакету Android.', { since: '1.14.0' }),
  strs('user', 'Пользователь системы (Linux).'),
  nums('user_id', 'UID пользователя (Linux).'),
  str('clash_mode', 'Режим, выбранный в клиенте через Clash API.'),
  strs('network_type', 'Тип сети графического клиента.', { values: NETWORK_TYPE_VALUES, since: '1.11.0' }),
  bool('network_is_expensive', 'Сеть с тарификацией.', { since: '1.11.0' }),
  bool('network_is_constrained', 'Режим экономии трафика (Apple).', { since: '1.11.0' }),
  obj('interface_address', 'Адреса по интерфейсам: имя → подсети.', [], { since: '1.13.0' }),
  obj('network_interface_address', 'Адреса по типам сети: тип → подсети.', [], { since: '1.13.0' }),
  strs('default_interface_address', 'Подсети интерфейса по умолчанию.', { since: '1.13.0' }),
  strs('source_mac_address', 'MAC-адреса источника.', { since: '1.14.0' }),
  strs('source_hostname', 'Имена хостов источника из DHCP.', { since: '1.14.0' }),
  strs('preferred_by', 'Домены, предпочитаемые указанными серверами.', { since: '1.14.0' }),
  strs('wifi_ssid', 'SSID сети Wi-Fi.'),
  strs('wifi_bssid', 'BSSID сети Wi-Fi.'),
  strs('rule_set', 'Теги наборов правил.', { ref: 'rule-set' }),
  bool('rule_set_ip_cidr_match_source', 'ip_cidr наборов сравнивать с источником.'),
  bool('match_response', 'Сравнивать поля ответа.', { since: '1.14.0' }),
  bool('ip_accept_any', 'Ответ содержит хотя бы один адрес.', { since: '1.12.0' }),
  str('response_rcode', 'Код ответа.', { since: '1.14.0' }),
  strs('response_answer', 'Записи answer ответа.', { since: '1.14.0' }),
  strs('response_ns', 'Записи ns ответа.', { since: '1.14.0' }),
  strs('response_extra', 'Записи extra ответа.', { since: '1.14.0' }),
  bool('invert', 'Обратить результат проверки условий.'),
  strs('ip_cidr', 'Подсети адреса в ответе.', { deprecated: removed('1.14.0', 'match_response: true и поля ответа') }),
  bool('ip_is_private', 'Адрес в ответе частный.', { deprecated: removed('1.14.0', 'match_response: true и поля ответа') }),
  bool('rule_set_ip_cidr_accept_empty', 'Пустой ответ считать совпадением.', { deprecated: removed('1.14.0', 'сопоставление ответа') }),
  strs('outbound', 'Выходы, чьи домены серверов резолвить этим правилом.', { deprecated: removed('1.12.0', 'поле domain_resolver у выхода') }),

  // ── действие и его поля ──
  en('action', 'Что сделать с запросом. Без этого поля — route.', DNS_RULE_ACTION_VALUES),
  str('server', 'Тег DNS-сервера, которому уйдёт запрос.', { ref: 'dns-server', when: routeLike }),
  str('tag', 'Метка запомненного ответа.', { when: when('action', 'evaluate'), since: '1.14.0' }),
  bool('speculative', 'Спрашивать наперёд.', { when: routeLike, since: '1.14.0' }),
  en('strategy', 'Какие адреса запрашивать.', STRATEGY_VALUES, { when: routeLike, deprecated: removed('1.14.0', 'strategy сервера или domain_resolver') }),
  bool('disable_cache', 'Не кэшировать ответ.', { when: options }),
  bool('disable_optimistic_cache', 'Не отдавать протухший кэш.', { when: options, since: '1.14.0' }),
  num('rewrite_ttl', 'Переписать TTL ответа.', { when: options }),
  str('timeout', 'Таймаут запроса.', { when: options, since: '1.14.0' }),
  str('client_subnet', 'Подсеть клиента для EDNS0 (client-subnet).', { when: options }),
  bool('remove_client_subnet', 'Не отправлять client-subnet.', { when: options, since: '1.14.0' }),
  en('method', 'Как отклонять: default — REFUSED, drop — молча.', ['default', 'drop'], { when: when('action', 'reject') }),
  bool('no_drop', 'Не переходить в drop после частых срабатываний.', { when: when('action', 'reject') }),
  en('rcode', 'Код ответа.', ['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN', 'NOTIMP', 'REFUSED'], { when: when('action', 'predefined') }),
  strs('answer', 'Записи answer текстом.', { when: when('action', 'predefined') }),
  strs('ns', 'Записи ns текстом.', { when: when('action', 'predefined') }),
  strs('extra', 'Записи extra текстом.', { when: when('action', 'predefined') }),
  bool('race', 'Сопоставлять правила параллельно.', { since: '1.14.0' }),

  // ── логическое правило ──
  en('type', 'logical — правило объединяет вложенные правила по «и» либо «или».', ['logical']),
  en('mode', 'Для логического правила: and — все вложенные, or — хотя бы одно.', ['and', 'or']),
]

// Вложенные правила логического правила описаны тем же списком: своя копия
// разошлась бы с оригиналом на первом же поле. Ссылка на себя — после
// объявления, иначе TS не даст сослаться на ещё не созданный массив
DNS_RULE_FIELDS.push(
  objs('rules', 'Вложенные правила логического правила.', DNS_RULE_FIELDS, {
    label: (_v, i) => `правило #${i + 1}`,
    starter: () => ({}),
  }),
)

export const DNS_FIELDS: FieldSchema[] = [
  objs('servers', 'DNS-серверы: у каждого свой тег, тип и адрес.', DNS_SERVER_FIELDS, {
    label: tagLabel,
    starter: () => ({ tag: '', type: 'udp', server: '' }),
  }),
  objs('rules', 'Правила DNS: какой запрос каким сервером разрешать. Считаются отдельно от правил маршрута.', DNS_RULE_FIELDS, {
    label: (_v, i) => `правило #${i + 1}`,
    starter: () => ({}),
  }),
  str('final', 'Сервер для запросов, не совпавших ни с одним правилом DNS; пусто — первый в списке.', { ref: 'dns-server' }),
  en('strategy', 'Какие адреса запрашивать по умолчанию.', STRATEGY_VALUES),
  bool('disable_cache', 'Отключить кэш DNS.'),
  bool('disable_expire', 'Не считать кэш просроченным.'),
  bool('independent_cache', 'Держать отдельный кэш для каждого сервера.', { deprecated: removed('1.14.0', 'optimistic и store_dns в cache_file') }),
  num('cache_capacity', 'Ёмкость LRU-кэша; меньше 1024 не учитывается.', { since: '1.11.0' }),
  bool('optimistic', 'Отдавать протухший кэш сразу и обновлять в фоне.', { since: '1.14.0' }),
  str('timeout', 'Таймаут одного запроса, по умолчанию 10s.', { since: '1.14.0' }),
  bool('reverse_mapping', 'Запоминать соответствие адреса и домена для обратного поиска.'),
  str('client_subnet', 'EDNS0 client-subnet по умолчанию.', { since: '1.9.0' }),
  obj('fakeip', 'Старый блок fakeip.', [
    bool('enabled', 'Включить fakeip.'),
    str('inet4_range', 'Диапазон IPv4.'),
    str('inet6_range', 'Диапазон IPv6.'),
  ], { deprecated: removed('1.12.0', 'сервер с type: fakeip в списке servers') }),
]
