// Перечисления и фрагменты, которые Mihomo переиспользует между ветвями:
// версия IP, отпечатки, клиентский TLS с ECH/Reality/ShadowTLS/Restls/JLS,
// транспорты по `network`, smux, mKCP/Mekya, серверный TLS у входов.
// Фрагмент описан один раз и вставляется по месту — копия разошлась бы с
// первой на первом же ключе.
//
// Источники: wiki.metacubex.one/config/proxies/* и канонический docs/config.yaml
// ядра (ветка Meta, 2026-09-09).

import { bool, en, map, num, obj, str, strs, type FieldSchema, type EnumValue } from '../../../shared/schema'

// doc не исключён: dialerProxy зовут с разным текстом (NTP-поле ходит «к NTP»,
// а не «устанавливать соединение» общего описания) — своя копия Extra здесь,
// а не общая из build.ts, потому что этому единственному строителю в файле
// нужно переопределять доку, остальным — нет.
type Extra = Partial<Omit<FieldSchema, 'key' | 'kind'>>

export const IP_VERSION_VALUES: EnumValue[] = [
  { value: 'dual', doc: 'Обе версии (по умолчанию).' },
  { value: 'ipv4', doc: 'Только IPv4.' },
  { value: 'ipv6', doc: 'Только IPv6.' },
  { value: 'ipv4-prefer', doc: 'Двойной стек, предпочитая IPv4.' },
  { value: 'ipv6-prefer', doc: 'Двойной стек, предпочитая IPv6.' },
]

export const FINGERPRINT_VALUES: EnumValue[] = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', '360', 'qq', 'random', 'none'].map((value) => ({ value }))

export const CONGESTION_VALUES: EnumValue[] = ['cubic', 'new_reno', 'bbr'].map((value) => ({ value }))
export const BBR_PROFILE_VALUES: EnumValue[] = ['standard', 'conservative', 'aggressive'].map((value) => ({ value }))

/** Ссылка на цель маршрута: группа, статический сервер или встроенная цель */
export const dialerProxy = (extra: Extra = {}): FieldSchema =>
  str('dialer-proxy', 'Через какую группу или сервер устанавливать соединение — цепочка прокси.', { ref: 'proxy-target', ...extra })

export const ECH_OPTS_FIELDS: FieldSchema[] = [
  bool('enable', 'Включить Encrypted Client Hello.'),
  str('config', 'Конфигурация ECH в base64; пусто — запросить через DNS.'),
  str('query-server-name', 'Домен для DNS-запроса конфигурации ECH.'),
]

export const REALITY_OPTS_FIELDS: FieldSchema[] = [
  str('public-key', 'Публичный ключ сервера Reality.'),
  str('short-id', 'Короткий идентификатор.'),
  bool('support-x25519mlkem768', 'Постквантовый обмен ключами, если сервер его поддерживает.'),
]

export const SHADOW_TLS_OPTS_FIELDS: FieldSchema[] = [
  num('version', 'Версия ShadowTLS: 1, 2 или 3; пусто — 2.', { min: 1 }),
  str('password', 'Пароль ShadowTLS.'),
]

export const RESTLS_OPTS_FIELDS: FieldSchema[] = [
  str('password', 'Пароль Restls.'),
  en('version-hint', 'Версия TLS сервера-прикрытия.', ['tls12', 'tls13']),
  str('restls-script', 'Сценарий Restls, скрывающий поведение после рукопожатия.'),
]

export const JLS_OPTS_FIELDS: FieldSchema[] = [
  str('username', 'Имя пользователя JLS.'),
  str('password', 'Пароль JLS.'),
]

/**
 * Клиентский TLS сервера: общий для vmess, vless, trojan, http, socks5,
 * anytls, trusttunnel. Имя сервера у ядра двоякое: `servername` у vmess/vless,
 * `sni` у остальных — оба ключа описаны, форма показывает тот, что стоит.
 */
export const CLIENT_TLS_FIELDS: FieldSchema[] = [
  bool('tls', 'Включить TLS.'),
  str('servername', 'Имя сервера для SNI (vmess, vless).'),
  str('sni', 'Имя сервера для SNI (trojan, hysteria, tuic, anytls и другие).'),
  strs('alpn', 'Список протоколов ALPN.'),
  bool('skip-cert-verify', 'Не проверять сертификат сервера.'),
  str('name-cert-verify', 'Проверять только DNSName сертификата, не трогая SNI.'),
  str('fingerprint', 'SHA-256 отпечаток сертификата сервера (SSL pinning).'),
  en('client-fingerprint', 'Чей отпечаток TLS-клиента изображать (uTLS).', FINGERPRINT_VALUES),
  str('certificate', 'Клиентский сертификат в PEM или путь к нему (mTLS).'),
  str('private-key', 'Клиентский ключ в PEM или путь к нему (mTLS).'),
  obj('ech-opts', 'Encrypted Client Hello.', ECH_OPTS_FIELDS),
  obj('reality-opts', 'Reality на стороне клиента.', REALITY_OPTS_FIELDS),
  obj('shadow-tls-opts', 'ShadowTLS поверх TLS; SNI берётся из servername/sni.', SHADOW_TLS_OPTS_FIELDS),
  obj('restls-opts', 'Restls поверх TLS.', RESTLS_OPTS_FIELDS),
  obj('jls-opts', 'JLS поверх TLS.', JLS_OPTS_FIELDS),
]

export const SMUX_FIELDS: FieldSchema[] = [
  bool('enabled', 'Включить мультиплексирование.'),
  en('protocol', 'Протокол мультиплексирования.', ['smux', 'yamux', 'h2mux']),
  num('max-connections', 'Максимум соединений; несовместимо с max-streams.'),
  num('min-streams', 'Минимум потоков до открытия нового соединения; несовместимо с max-streams.'),
  num('max-streams', 'Максимум потоков в соединении; несовместимо с двумя полями выше.'),
  bool('padding', 'Дополнять пакеты (нужен sing-box ≥ 1.3-beta9 на сервере).'),
  bool('statistic', 'Показывать нижележащие соединения в панели.'),
  bool('only-tcp', 'Не применять smux к UDP.'),
  obj('brutal-opts', 'TCP Brutal.', [bool('enabled', 'Включить Brutal.'), str('up', 'Отдача, например 50 Mbps.'), str('down', 'Приём, например 100 Mbps.')]),
]

export const WS_OPTS_FIELDS: FieldSchema[] = [
  str('path', 'Путь WebSocket.'),
  map('headers', 'Заголовки запроса (Host и другие).'),
  num('max-early-data', 'Размер ранних данных.'),
  str('early-data-header-name', 'Заголовок для ранних данных, например Sec-WebSocket-Protocol.'),
  bool('v2ray-http-upgrade', 'HTTPUpgrade вместо WebSocket.'),
  bool('v2ray-http-upgrade-fast-open', 'Быстрое открытие HTTPUpgrade.'),
]

export const H2_OPTS_FIELDS: FieldSchema[] = [
  strs('host', 'Домены HTTP/2.'),
  str('path', 'Путь HTTP/2.'),
]

export const HTTP_OPTS_FIELDS: FieldSchema[] = [
  str('method', 'Метод HTTP-запроса.'),
  strs('path', 'Пути запроса; клиент выбирает случайный.'),
  map('headers', 'Заголовки; значение — список строк.', { values: 'strings' }),
]

export const GRPC_OPTS_FIELDS: FieldSchema[] = [
  str('grpc-service-name', 'Имя gRPC-службы.'),
  str('grpc-user-agent', 'User-Agent gRPC-клиента.'),
  num('ping-interval', 'Интервал проверки живости, секунд; 0 — выключено.'),
  num('max-connections', 'Максимум соединений; несовместимо с max-streams.'),
  num('min-streams', 'Минимум потоков до нового соединения.'),
  num('max-streams', 'Максимум потоков в соединении.'),
]

const XMUX_FIELDS: FieldSchema[] = [
  str('max-concurrency', 'Одновременных потоков, например 16-32.'),
  str('max-connections', 'Максимум соединений.'),
  str('c-max-reuse-times', 'Сколько раз переиспользовать соединение.'),
  str('h-max-request-times', 'Максимум запросов на соединение.'),
  str('h-max-reusable-secs', 'Секунд жизни соединения.'),
  num('h-keep-alive-period', 'Период keep-alive.'),
]

export const XHTTP_OPTS_FIELDS: FieldSchema[] = [
  str('path', 'Путь XHTTP.'),
  str('host', 'Заголовок Host.'),
  en('mode', 'Режим XHTTP.', ['auto', 'stream-one', 'stream-up', 'packet-up']),
  map('headers', 'Дополнительные заголовки.'),
  bool('no-grpc-header', 'Не слать gRPC-заголовок.'),
  str('x-padding-bytes', 'Размер дополнения, например 100-1000.'),
  bool('x-padding-obfs-mode', 'Обфускация дополнения.'),
  str('x-padding-key', 'Ключ дополнения.'),
  str('x-padding-header', 'Заголовок дополнения.'),
  en('x-padding-placement', 'Где стоит дополнение.', ['queryInHeader', 'cookie', 'header', 'query']),
  en('x-padding-method', 'Способ дополнения.', ['repeat-x', 'tokenish']),
  en('uplink-http-method', 'Метод восходящих запросов.', ['POST', 'PUT', 'PATCH', 'DELETE']),
  en('session-placement', 'Где передаётся идентификатор сессии.', ['path', 'query', 'cookie', 'header']),
  str('session-key', 'Ключ идентификатора сессии.'),
  en('seq-placement', 'Где передаётся номер последовательности.', ['path', 'query', 'cookie', 'header']),
  str('seq-key', 'Ключ номера последовательности.'),
  en('uplink-data-placement', 'Где передаются восходящие данные.', ['body', 'cookie', 'header']),
  str('uplink-data-key', 'Ключ восходящих данных.'),
  num('uplink-chunk-size', 'Размер порции восходящих данных вне тела.'),
  num('sc-max-each-post-bytes', 'Максимум байт в одном POST.'),
  num('sc-min-posts-interval-ms', 'Минимальный интервал между POST, мс.'),
  obj('reuse-settings', 'Переиспользование соединений (XMUX).', XMUX_FIELDS),
  obj('download-settings', 'Отдельное соединение для загрузки: свои path, host, headers, reuse-settings и параметры сервера.', [
    str('path', 'Путь.'), str('host', 'Host.'), map('headers', 'Заголовки.'), obj('reuse-settings', 'XMUX загрузки.', XMUX_FIELDS),
    str('server', 'Сервер загрузки.'), num('port', 'Порт.'), bool('tls', 'TLS.'), strs('alpn', 'ALPN.'),
    obj('ech-opts', 'ECH.', ECH_OPTS_FIELDS), obj('reality-opts', 'Reality.', REALITY_OPTS_FIELDS),
    obj('shadow-tls-opts', 'ShadowTLS.', SHADOW_TLS_OPTS_FIELDS), obj('restls-opts', 'Restls.', RESTLS_OPTS_FIELDS), obj('jls-opts', 'JLS.', JLS_OPTS_FIELDS),
    bool('skip-cert-verify', 'Не проверять сертификат.'), str('name-cert-verify', 'DNSName сертификата.'), str('fingerprint', 'Отпечаток сертификата.'),
    str('certificate', 'Клиентский сертификат.'), str('private-key', 'Клиентский ключ.'), str('servername', 'SNI.'),
    en('client-fingerprint', 'Отпечаток TLS-клиента.', FINGERPRINT_VALUES),
  ]),
]

export const KCP_FIELDS: FieldSchema[] = [
  num('mtu', 'Максимальный размер пакета.'),
  num('tti', 'Интервал передачи, мс.'),
  num('uplink-capacity', 'Ёмкость отдачи, МБ/с.'),
  num('downlink-capacity', 'Ёмкость приёма, МБ/с.'),
  bool('congestion', 'Контроль перегрузки.'),
  num('write-buffer', 'Буфер записи, байт.'),
  num('read-buffer', 'Буфер чтения, байт.'),
  str('seed', 'Seed аутентификации AES-GCM; пусто — умолчание.'),
  en('header', 'Маскировка заголовка.', ['none', 'srtp', 'utp', 'wechat-video', 'dtls', 'wireguard']),
]

export const MKCP_OPTS_FIELDS: FieldSchema[] = KCP_FIELDS

export const MEKYA_OPTS_FIELDS: FieldSchema[] = [
  str('url', 'Адрес Mekya-сервера.'),
  num('max-write-delay', 'Максимальная задержка агрегации после первого пакета, мс.'),
  num('max-request-size', 'Максимальный размер одного HTTP-запроса, байт.'),
  num('polling-interval-initial', 'Начальный интервал опроса, мс.'),
  num('h2-pool-size', 'Размер пула соединений HTTP/2.'),
  obj('kcp', 'Параметры KCP внутри Mekya.', KCP_FIELDS),
]

export const IP_STACK_FIELDS: FieldSchema[] = [
  en('mode', 'Реализация IP-стека.', ['auto', 'gvisor', 'mips']),
  en('congestion-controller', 'Алгоритм перегрузки TCP (кроме gVisor).', ['cubic', 'reno', 'bbr', 'bbr3']),
]

/** Серверный TLS у входов: сертификат, mTLS, ECH */
export const TLS_SERVER_FIELDS: FieldSchema[] = [
  str('certificate', 'Сертификат сервера в PEM или путь к нему.'),
  str('private-key', 'Ключ сервера в PEM или путь к нему.'),
  en('client-auth-type', 'Проверка клиентского сертификата (mTLS).', ['', 'request', 'require-any', 'verify-if-given', 'require-and-verify']),
  str('client-auth-cert', 'Сертификат для проверки клиентов.'),
  str('ech-key', 'Ключи ECH (mihomo generate ech-keypair).'),
]
