// Строители полей и фрагменты, которые ядро переиспользует между ветвями:
// dial-поля (у выходов, конечных точек, части DNS-серверов, ntp), listen-поля
// (у входов, кроме tun), tls, transport, multiplex. Фрагмент описан один раз и
// вставляется по месту: вторая копия разошлась бы с первой на первом же ключе.
//
// Версии в since/deprecated — со страниц sing-box.sagernet.org/configuration/*
// на 2026-09-09. Панель нацелена на 1.13.x; ключи 1.14 описаны как существующие
// (пометка since), удалённые — как устаревшие с заменой: документ с ними
// открывается без потерь.

import type {
  Condition,
  Deprecation,
  EnumValue,
  FieldSchema,
  ListItemSchema,
} from '../../../shared/schema'

type Extra = Partial<Omit<FieldSchema, 'key' | 'doc' | 'kind'>>

export const str = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'string', ...extra })
export const num = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'number', ...extra })
export const bool = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'boolean', ...extra })
export const map = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'map', ...extra })

export const en = (key: string, doc: string, values: (string | EnumValue)[], extra: Extra = {}): FieldSchema => ({
  key,
  doc,
  kind: 'enum',
  enum: values.map((v) => (typeof v === 'string' ? { value: v } : v)),
  ...extra,
})

/** Список строк; `values` — известные значения элементов (network: tcp/udp) */
export const strs = (key: string, doc: string, extra: Extra & { values?: (string | EnumValue)[]; ref?: FieldSchema['ref'] } = {}): FieldSchema => {
  const { values, ref, ...rest } = extra
  const item: ListItemSchema = { kind: 'string' }
  if (values !== undefined) item.enum = values.map((v) => (typeof v === 'string' ? { value: v } : v))
  if (ref !== undefined) item.ref = ref
  return { key, doc, kind: 'list', item, ...rest }
}

export const nums = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'list', item: { kind: 'number' }, ...extra })

export const obj = (key: string, doc: string, fields: FieldSchema[], extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'object', fields, ...extra })

/** Список объектов; `item` — подпись и стартер элемента */
export const objs = (
  key: string,
  doc: string,
  fields: FieldSchema[],
  item: Pick<ListItemSchema, 'label' | 'starter'> = {},
  extra: Extra = {},
): FieldSchema => ({ key, doc, kind: 'list', item: { kind: 'object', fields, ...item }, ...extra })

export const when = (key: string, ...values: string[]): Condition => ({ key, in: values })
export const whenNot = (key: string, ...values: string[]): Condition => ({ key, notIn: values })

/** Копия фрагмента с условием на каждом поле; исходный фрагмент не трогается */
export const withWhen = (fields: FieldSchema[], cond: Condition): FieldSchema[] => fields.map((f) => ({ ...f, when: cond }))

export const removed = (since: string, replacement: string): Deprecation => ({ since, replacement })

/** Подпись элемента списка: тег, иначе номер */
export const tagLabel = (value: unknown, index: number): string => {
  const tag = (value as { tag?: unknown } | null)?.tag
  return typeof tag === 'string' && tag !== '' ? tag : `#${index + 1}`
}

// ── перечисления ──────────────────────────────────────────────────────────

export const STRATEGY_VALUES: EnumValue[] = [
  { value: 'prefer_ipv4', doc: 'Сначала IPv4, потом IPv6.' },
  { value: 'prefer_ipv6', doc: 'Сначала IPv6, потом IPv4.' },
  { value: 'ipv4_only', doc: 'Только IPv4.' },
  { value: 'ipv6_only', doc: 'Только IPv6.' },
]

export const NETWORK_VALUES: EnumValue[] = [{ value: 'tcp' }, { value: 'udp' }]

export const NETWORK_TYPE_VALUES: EnumValue[] = [{ value: 'wifi' }, { value: 'cellular' }, { value: 'ethernet' }, { value: 'other' }]

export const FINGERPRINT_VALUES: EnumValue[] = ['chrome', 'firefox', 'edge', 'safari', '360', 'qq', 'ios', 'android', 'random', 'randomized'].map((value) => ({ value }))

export const SS_METHOD_VALUES: EnumValue[] = [
  '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305',
  'none', 'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305',
  'aes-128-ctr', 'aes-192-ctr', 'aes-256-ctr', 'aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb', 'rc4-md5', 'chacha20-ietf', 'xchacha20',
].map((value) => ({ value }))

export const SNIFFER_VALUES: EnumValue[] = ['http', 'tls', 'quic', 'stun', 'dns', 'bittorrent', 'dtls', 'ssh', 'rdp', 'ntp'].map((value) => ({ value }))

// ── фрагменты ─────────────────────────────────────────────────────────────

/** Поля объекта domain_resolver; по форме совпадают с действием route DNS-правила без `action` */
export const DOMAIN_RESOLVER_FIELDS: FieldSchema[] = [
  str('server', 'Тег DNS-сервера, которым разрешать домены.', { ref: 'dns-server' }),
  en('strategy', 'Какие адреса запрашивать.', STRATEGY_VALUES),
  bool('disable_cache', 'Не кэшировать ответы.'),
  bool('disable_optimistic_cache', 'Не отдавать протухший кэш до обновления.', { since: '1.14.0' }),
  num('rewrite_ttl', 'Переписать TTL ответа, секунд.'),
  str('client_subnet', 'EDNS0 client-subnet для запроса.'),
  bool('remove_client_subnet', 'Не отправлять client-subnet.', { since: '1.14.0' }),
  str('timeout', 'Таймаут запроса, например 10s.', { since: '1.14.0' }),
]

export const domainResolverObject = (key: string, doc: string, extra: Extra = {}): FieldSchema =>
  obj(key, doc, DOMAIN_RESOLVER_FIELDS, extra)

/** Dial-поля: как ядро устанавливает исходящее соединение */
export const DIAL_FIELDS: FieldSchema[] = [
  str('detour', 'Через какой выход устанавливать это соединение — цепочка прокси. При заданном detour остальные dial-поля не действуют.', { ref: 'outbound' }),
  str('bind_interface', 'Имя сетевого интерфейса, с которого выходить.'),
  str('inet4_bind_address', 'Исходящий адрес IPv4.'),
  str('inet6_bind_address', 'Исходящий адрес IPv6.'),
  bool('bind_address_no_port', 'Не резервировать порт при привязке адреса (Linux).', { since: '1.13.0' }),
  num('routing_mark', 'Метка netfilter для исходящих соединений (Linux).'),
  bool('reuse_addr', 'Переиспользовать адрес слушателя.'),
  str('netns', 'Сетевое пространство имён Linux: имя, путь или тег.', { since: '1.12.0' }),
  str('connect_timeout', 'Таймаут установки соединения, например 5s.'),
  bool('tcp_fast_open', 'TCP Fast Open.'),
  bool('tcp_multi_path', 'Multipath TCP.'),
  bool('disable_tcp_keep_alive', 'Отключить TCP keep-alive.', { since: '1.13.0' }),
  str('tcp_keep_alive', 'Первый keep-alive через это время, по умолчанию 5m.', { since: '1.13.0' }),
  str('tcp_keep_alive_interval', 'Интервал keep-alive, по умолчанию 75s.', { since: '1.13.0' }),
  bool('udp_fragment', 'Разрешить фрагментацию UDP.'),
  domainResolverObject('domain_resolver', 'Каким DNS-сервером разрешать домен сервера. С 1.14 при доменном адресе обязателен.', { since: '1.12.0' }),
  en('network_strategy', 'Стратегия выбора сети у графических клиентов.', ['default', 'hybrid', 'fallback'], { since: '1.11.0' }),
  strs('network_type', 'Предпочитаемые типы сети.', { values: NETWORK_TYPE_VALUES, since: '1.11.0' }),
  strs('fallback_network_type', 'Запасные типы сети.', { values: NETWORK_TYPE_VALUES, since: '1.11.0' }),
  str('fallback_delay', 'Задержка перед запасной сетью, по умолчанию 300ms.', { since: '1.11.0' }),
  en('domain_strategy', 'Какие адреса запрашивать для домена сервера.', STRATEGY_VALUES, {
    deprecated: removed('1.12.0', 'объект domain_resolver с полем strategy'),
  }),
]

/** Listen-поля: как вход слушает. У tun свой набор, listen-полей у него нет */
export const LISTEN_FIELDS: FieldSchema[] = [
  str('listen', 'Адрес, который слушает вход.'),
  num('listen_port', 'Порт, который слушает вход.'),
  str('bind_interface', 'Интерфейс, к которому привязан слушатель.', { since: '1.12.0' }),
  num('routing_mark', 'Метка netfilter (Linux).', { since: '1.12.0' }),
  bool('reuse_addr', 'Переиспользовать адрес слушателя.', { since: '1.12.0' }),
  str('netns', 'Сетевое пространство имён Linux.', { since: '1.12.0' }),
  bool('tcp_fast_open', 'TCP Fast Open.'),
  bool('tcp_multi_path', 'Multipath TCP.'),
  bool('disable_tcp_keep_alive', 'Отключить TCP keep-alive.', { since: '1.13.0' }),
  str('tcp_keep_alive', 'Первый keep-alive через это время, по умолчанию 5m.', { since: '1.13.0' }),
  str('tcp_keep_alive_interval', 'Интервал keep-alive, по умолчанию 75s.', { since: '1.13.0' }),
  bool('udp_fragment', 'Разрешить фрагментацию UDP.'),
  str('udp_timeout', 'Время жизни NAT-записи UDP, по умолчанию 5m.'),
  str('detour', 'Передать принятое соединение другому входу.', { ref: 'inbound' }),
  bool('sniff', 'Определять протокол соединения.', { deprecated: removed('1.11.0', 'правило маршрута с action: sniff') }),
  bool('sniff_override_destination', 'Подменять адрес назначения найденным доменом.', { deprecated: removed('1.11.0', 'действие sniff и route-options') }),
  str('sniff_timeout', 'Время на определение протокола.', { deprecated: removed('1.11.0', 'поле timeout действия sniff') }),
  en('domain_strategy', 'Как разрешать домен назначения.', STRATEGY_VALUES, { deprecated: removed('1.11.0', 'правило маршрута с action: resolve') }),
  bool('udp_disable_domain_unmapping', 'Не сопоставлять UDP-ответы обратно с доменом.', { deprecated: removed('1.11.0', 'поле udp_disable_domain_unmapping действия route-options') }),
]

const TLS_VERSION_VALUES: EnumValue[] = ['1.0', '1.1', '1.2', '1.3'].map((value) => ({ value }))

/** Клиентский TLS. Серверных ключей (key, key_path, acme, client_authentication) здесь нет */
export const TLS_FIELDS: FieldSchema[] = [
  bool('enabled', 'Включить TLS.'),
  en('engine', 'Реализация TLS.', ['go', 'apple', 'windows'], { since: '1.14.0' }),
  bool('disable_sni', 'Не отправлять имя сервера в ClientHello.'),
  str('server_name', 'Имя сервера для проверки сертификата и SNI.'),
  bool('insecure', 'Принимать любой сертификат.'),
  strs('alpn', 'Список протоколов ALPN.'),
  en('min_version', 'Минимальная версия TLS.', TLS_VERSION_VALUES),
  en('max_version', 'Максимальная версия TLS.', TLS_VERSION_VALUES),
  strs('cipher_suites', 'Разрешённые шифры для TLS 1.0–1.2.'),
  strs('curve_preferences', 'Предпочитаемые кривые.', { since: '1.13.0' }),
  str('certificate', 'Доверенный сертификат сервера в PEM.'),
  str('certificate_path', 'Путь к файлу доверенного сертификата.'),
  strs('certificate_public_key_sha256', 'Отпечатки публичного ключа сервера (base64 SHA-256).', { since: '1.13.0' }),
  strs('client_certificate', 'Клиентский сертификат в PEM (mTLS).', { since: '1.13.0' }),
  str('client_certificate_path', 'Путь к клиентскому сертификату.', { since: '1.13.0' }),
  strs('client_key', 'Клиентский ключ в PEM.', { since: '1.13.0' }),
  str('client_key_path', 'Путь к клиентскому ключу.', { since: '1.13.0' }),
  bool('fragment', 'Дробить ClientHello на несколько сегментов TCP.', { since: '1.12.0' }),
  str('fragment_fallback_delay', 'Ждать столько перед откатом без дробления, по умолчанию 500ms.', { since: '1.12.0' }),
  bool('record_fragment', 'Дробить ClientHello на несколько TLS-записей.', { since: '1.12.0' }),
  str('spoof', 'Поддельное имя сервера для подмены SNI.', { since: '1.14.0' }),
  en('spoof_method', 'Способ подмены.', ['wrong-sequence', 'wrong-checksum', 'wrong-ack', 'wrong-md5', 'wrong-timestamp'], { since: '1.14.0' }),
  bool('kernel_tx', 'kTLS на отправку (Linux).', { since: '1.13.0' }),
  bool('kernel_rx', 'kTLS на приём (Linux).', { since: '1.13.0' }),
  str('handshake_timeout', 'Таймаут рукопожатия, по умолчанию 15s.', { since: '1.14.0' }),
  obj('ech', 'Encrypted Client Hello.', [
    bool('enabled', 'Включить ECH.'),
    strs('config', 'Конфигурация ECH в PEM.'),
    str('config_path', 'Путь к файлу конфигурации ECH.'),
    str('query_server_name', 'Домен для запроса HTTPS-записи с конфигурацией.', { since: '1.13.0' }),
    bool('pq_signature_schemes_enabled', 'Постквантовые схемы подписи.', { deprecated: removed('1.12.0', 'ключ удалён в 1.13, уберите его') }),
    bool('dynamic_record_sizing_disabled', 'Отключить динамический размер записей.', { deprecated: removed('1.12.0', 'ключ удалён в 1.13, уберите его') }),
  ]),
  obj('utls', 'Отпечаток TLS-клиента (uTLS).', [
    bool('enabled', 'Включить uTLS.'),
    en('fingerprint', 'Чей отпечаток изображать; пусто — chrome.', FINGERPRINT_VALUES),
  ]),
  obj('reality', 'Reality на стороне клиента.', [
    bool('enabled', 'Включить Reality.'),
    str('public_key', 'Публичный ключ сервера.'),
    str('short_id', 'Короткий идентификатор: hex до 8 знаков.'),
  ]),
]

export const tlsObject = (extra: Extra = {}): FieldSchema => obj('tls', 'Настройки TLS соединения с сервером.', TLS_FIELDS, extra)

/** Транспорт V2Ray; поля зависят от `type` */
export const TRANSPORT_FIELDS: FieldSchema[] = [
  en('type', 'Вид транспорта.', [
    { value: 'http', doc: 'HTTP/2.' },
    { value: 'ws', doc: 'WebSocket.' },
    { value: 'quic', doc: 'QUIC — дополнительных полей нет.' },
    { value: 'grpc', doc: 'gRPC.' },
    { value: 'httpupgrade', doc: 'HTTPUpgrade.' },
  ]),
  strs('host', 'Список доменов: клиент выбирает случайный.', { when: when('type', 'http') }),
  str('host', 'Домен в заголовке Host.', { when: when('type', 'httpupgrade') }),
  str('path', 'Путь HTTP-запроса.', { when: when('type', 'http', 'ws', 'httpupgrade') }),
  str('method', 'Метод HTTP-запроса.', { when: when('type', 'http') }),
  map('headers', 'Дополнительные заголовки HTTP.', { when: when('type', 'http', 'ws', 'httpupgrade') }),
  str('idle_timeout', 'Простой соединения до проверки живости, по умолчанию 15s.', { when: when('type', 'http', 'grpc') }),
  str('ping_timeout', 'Ожидание ответа на проверку живости, по умолчанию 15s.', { when: when('type', 'http', 'grpc') }),
  num('max_early_data', 'Размер ранних данных в запросе; 0 — выключено.', { when: when('type', 'ws') }),
  str('early_data_header_name', 'Заголовок для ранних данных; Sec-WebSocket-Protocol для совместимости с Xray.', { when: when('type', 'ws') }),
  str('service_name', 'Имя gRPC-службы, по умолчанию TunService.', { when: when('type', 'grpc') }),
  bool('permit_without_stream', 'Слать проверки живости без активных потоков.', { when: when('type', 'grpc') }),
]

export const transportObject = (extra: Extra = {}): FieldSchema => obj('transport', 'Транспорт поверх TLS: WebSocket, gRPC, HTTP/2, HTTPUpgrade, QUIC.', TRANSPORT_FIELDS, extra)

export const MULTIPLEX_FIELDS: FieldSchema[] = [
  bool('enabled', 'Включить мультиплексирование.'),
  en('protocol', 'Протокол мультиплексирования; пусто — h2mux.', ['smux', 'yamux', 'h2mux']),
  num('max_connections', 'Максимум соединений.'),
  num('min_streams', 'Минимум потоков до открытия нового соединения.'),
  num('max_streams', 'Максимум потоков в соединении; несовместимо с двумя полями выше.'),
  bool('padding', 'Дополнять пакеты.'),
  obj('brutal', 'TCP Brutal: требует модуль ядра Linux.', [
    bool('enabled', 'Включить Brutal.'),
    num('up_mbps', 'Отдача, Мбит/с.'),
    num('down_mbps', 'Приём, Мбит/с.'),
  ]),
]

export const multiplexObject = (extra: Extra = {}): FieldSchema => obj('multiplex', 'Мультиплексирование соединений.', MULTIPLEX_FIELDS, extra)

export const UDP_OVER_TCP_FIELDS: FieldSchema[] = [
  bool('enabled', 'Включить UDP поверх TCP.'),
  num('version', 'Версия протокола: 1 или 2; пусто — 2.', { min: 1 }),
]
