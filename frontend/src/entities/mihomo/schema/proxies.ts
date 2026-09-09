// Запись `proxies[]`: сервер клиента. Общие поля видны всем типам, кроме тех,
// у которых нет сети (`direct`, `dns`, `rematch`, `tailscale`, `zerotier`);
// протокольные привязаны к `type`, транспортные — к `network`. Список типов —
// канонический docs/config.yaml ядра (ветка Meta, 2026-09-09) плюс
// wiki.metacubex.one/config/proxies/*.
//
// В шаблоне подписки серверы почти всегда подставляет панель; статические
// записи здесь — direct-«псевдоним», WireGuard/WARP, цепочки. Полнота схемы —
// решение владельца (часть 2, вопрос 1): форма обязана уметь любой тип, который
// умеет ядро, а не только те, что кладёт панель.

import { bool, en, map, num, obj, objs, str, strs, when, whenNot, withWhen, type EnumValue, type FieldSchema } from '../../../shared/schema'
import {
  BBR_PROFILE_VALUES, CLIENT_TLS_FIELDS, CONGESTION_VALUES, ECH_OPTS_FIELDS, GRPC_OPTS_FIELDS, H2_OPTS_FIELDS,
  HTTP_OPTS_FIELDS, IP_STACK_FIELDS, IP_VERSION_VALUES, MEKYA_OPTS_FIELDS, MKCP_OPTS_FIELDS,
  SMUX_FIELDS, WS_OPTS_FIELDS, XHTTP_OPTS_FIELDS, dialerProxy,
} from './shared'

export const PROXY_TYPE_VALUES: EnumValue[] = [
  { value: 'direct', doc: 'Прямой выход с заданным интерфейсом или fwmark.' },
  { value: 'dns', doc: 'Перехват DNS-запросов во встроенный резолвер.' },
  { value: 'http', doc: 'HTTP(S)-прокси.' },
  { value: 'socks5', doc: 'SOCKS5.' },
  { value: 'ss', doc: 'Shadowsocks.' },
  { value: 'ssr', doc: 'ShadowsocksR.' },
  { value: 'snell', doc: 'Snell.' },
  { value: 'vmess', doc: 'VMess.' },
  { value: 'vless', doc: 'VLESS.' },
  { value: 'trojan', doc: 'Trojan.' },
  { value: 'hysteria', doc: 'Hysteria (первая версия).' },
  { value: 'hysteria2', doc: 'Hysteria 2.' },
  { value: 'tuic', doc: 'TUIC v4/v5.' },
  { value: 'wireguard', doc: 'WireGuard.' },
  { value: 'tailscale', doc: 'Tailscale (tsnet).' },
  { value: 'zerotier', doc: 'ZeroTier.' },
  { value: 'openvpn', doc: 'OpenVPN.' },
  { value: 'masque', doc: 'MASQUE (HTTP/3 или HTTP/2).' },
  { value: 'shadowquic', doc: 'ShadowQUIC.' },
  { value: 'ssh', doc: 'SSH-туннель.' },
  { value: 'mieru', doc: 'Mieru.' },
  { value: 'sudoku', doc: 'Sudoku.' },
  { value: 'anytls', doc: 'AnyTLS.' },
  { value: 'trusttunnel', doc: 'TrustTunnel.' },
  { value: 'gost-relay', doc: 'Ретранслятор GOST для цепочек через dialer-proxy.' },
  { value: 'rematch', doc: 'Повторный подбор правил с другой меткой или подсписком.' },
]

/** Типы без собственного сетевого адреса: общие поля server/port им не нужны */
const NO_ADDRESS = ['direct', 'dns', 'rematch', 'tailscale', 'zerotier']

export const SS_CIPHER_VALUES: EnumValue[] = [
  'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm', 'aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb', 'aes-128-ctr', 'aes-192-ctr', 'aes-256-ctr',
  'rc4-md5', 'chacha20-ietf', 'xchacha20', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305',
].map((value) => ({ value }))

export const NETWORK_VALUES: EnumValue[] = [
  { value: 'tcp' }, { value: 'ws', doc: 'WebSocket.' }, { value: 'http', doc: 'HTTP-маскировка.' }, { value: 'h2', doc: 'HTTP/2.' },
  { value: 'grpc' }, { value: 'xhttp', doc: 'XHTTP (SplitHTTP).' }, { value: 'mkcp', doc: 'mKCP.' }, { value: 'mekya', doc: 'Mekya.' },
]

const TLS_MIRROR_FIELDS: FieldSchema[] = [
  str('primary-key', 'Главный ключ, 32 байта в base64.'),
  strs('explicit-nonce-ciphersuites', 'Шифросьюты TLS 1.2 с явным nonce (числа).'),
  obj('defer-instance-derived-write-time', 'Задержка перед первой записью.', [num('base-nanoseconds', 'Фиксированная задержка, нс.'), num('uniform-random-multiplier-nanoseconds', 'Верхняя граница случайной добавки, нс.')]),
  obj('transport-layer-padding', 'Дополнение транспортного уровня.', [bool('enabled', 'Включить.')]),
  obj('connection-enrolment', 'Подтверждение регистрации соединения (совместимость с v2ray).', [str('primary-egress-outbound', 'Тег управляющего выхода; у mihomo пусто.')]),
  bool('sequence-watermarking-enabled', 'Водяные знаки последовательности.'),
  obj('embedded-traffic-generator', 'Генератор HTTP-трафика-носителя; шаги описаны в тексте.', []),
]

const PLUGIN_OPTS_FIELDS: FieldSchema[] = [
  en('mode', 'Режим плагина: tls/http у obfs, websocket у v2ray-plugin и gost-plugin.', ['tls', 'http', 'websocket']),
  str('host', 'Домен маскировки или Host.'),
  str('path', 'Путь (websocket).'),
  bool('tls', 'TLS у websocket (wss).'),
  bool('mux', 'Мультиплексирование websocket.'),
  map('headers', 'Заголовки websocket.'),
  str('fingerprint', 'Отпечаток сертификата сервера.'),
  str('certificate', 'Клиентский сертификат (mTLS).'),
  str('private-key', 'Клиентский ключ (mTLS).'),
  bool('skip-cert-verify', 'Не проверять сертификат.'),
  str('name-cert-verify', 'DNSName для проверки сертификата.'),
  bool('v2ray-http-upgrade', 'HTTPUpgrade вместо WebSocket.'),
  bool('v2ray-http-upgrade-fast-open', 'Быстрое открытие HTTPUpgrade.'),
  obj('ech-opts', 'ECH у websocket.', ECH_OPTS_FIELDS),
  str('password', 'Пароль shadow-tls, restls, jls.'),
  num('version', 'Версия shadow-tls: 1, 2 или 3.', { min: 1 }),
  strs('alpn', 'ALPN у shadow-tls/jls.'),
  str('version-hint', 'Версия TLS сервера-прикрытия у restls: tls12 или tls13.'),
  str('restls-script', 'Сценарий restls.'),
  str('username', 'Имя пользователя jls.'),
  // kcptun
  str('key', 'Общий секрет kcptun.'),
  en('crypt', 'Шифр kcptun.', ['aes', 'aes-128', 'aes-128-gcm', 'aes-192', 'salsa20', 'blowfish', 'twofish', 'cast5', '3des', 'tea', 'xtea', 'xor', 'none', 'null']),
  num('conn', 'Число UDP-соединений kcptun.'),
  num('autoexpire', 'Срок жизни UDP-соединения, секунд; 0 — не истекает.'),
  num('scavengettl', 'Сколько живёт истёкшее соединение, секунд.'),
  num('mtu', 'MTU пакетов UDP.'),
  num('ratelimit', 'Ограничение скорости, байт/с; 0 — без ограничения.'),
  num('sndwnd', 'Окно отправки, пакетов.'),
  num('rcvwnd', 'Окно приёма, пакетов.'),
  num('datashard', 'Reed-Solomon: доля данных.'),
  num('parityshard', 'Reed-Solomon: доля чётности.'),
  num('dscp', 'DSCP.'),
  bool('nocomp', 'Без сжатия.'),
  bool('acknodelay', 'Слать ACK сразу.'),
  num('nodelay', 'nodelay kcptun.'), num('interval', 'interval kcptun.'), num('resend', 'resend kcptun.'),
  num('sockbuf', 'Буфер сокета, байт.'), num('smuxver', 'Версия smux: 1 или 2.'), num('smuxbuf', 'Буфер де-мультиплексора, байт.'),
  num('framesize', 'Максимальный кадр smux.'), num('streambuf', 'Буфер потока, байт.'), num('keepalive', 'Интервал heartbeat, секунд.'),
]

const WG_PEER_FIELDS: FieldSchema[] = [
  str('server', 'Адрес пира.'), num('port', 'Порт пира.'), str('public-key', 'Публичный ключ пира.'),
  str('pre-shared-key', 'Общий ключ.'), strs('allowed-ips', 'Разрешённые подсети; обязательны у пира.'), strs('reserved', 'Зарезервированные байты (числа или base64).'),
]

const AMNEZIA_FIELDS: FieldSchema[] = [
  num('version', 'Версия реализации AmneziaWG; 3 — новая, остальные — прежняя.'),
  num('jc', 'Jc.'), num('jmin', 'Jmin.'), num('jmax', 'Jmax.'), num('s1', 'S1.'), num('s2', 'S2.'), num('s3', 'S3 (v1.5+).'), num('s4', 'S4 (v1.5+).'),
  str('h1', 'H1 (число или диапазон в v2+).'), str('h2', 'H2.'), str('h3', 'H3.'), str('h4', 'H4.'),
  str('i1', 'I1 (v1.5+).'), str('i2', 'I2.'), str('i3', 'I3.'), str('i4', 'I4.'), str('i5', 'I5.'),
  str('j1', 'J1 (только v1.5).'), str('j2', 'J2 (только v1.5).'), str('j3', 'J3 (только v1.5).'), num('itime', 'itime (только v1.5).'),
  str('header-protection-key', 'Ключ защиты заголовка (v3+).'), str('content-padding-addition', 'Дополнение содержимого, например 0-32 (v3+).'),
  num('rekey-after-time', 'Секунд до смены ключа (v3+).'), num('rekey-timeout', 'Таймаут смены ключа (v3+).'), num('reject-after-time', 'Секунд до отказа (v3+).'),
  num('keepalive-timeout', 'Таймаут keepalive (v3+).'), num('max-handshake-attempts', 'Попыток рукопожатия (v3+).'),
  bool('random-trailers', 'Случайные хвосты (v3.1+).'), bool('disable-cookies', 'Отключить cookies (v3.1+).'),
]

const REALM_OPTS_FIELDS: FieldSchema[] = [
  bool('enable', 'Включить Realm.'), str('server-url', 'Адрес сервера Realm.'), str('token', 'Токен.'), str('realm-id', 'Идентификатор realm.'),
  strs('stun-servers', 'STUN-серверы.'), str('sni', 'SNI к server-url.'), bool('skip-cert-verify', 'Не проверять сертификат server-url.'),
  str('name-cert-verify', 'DNSName сертификата server-url.'), str('fingerprint', 'Отпечаток сертификата server-url.'),
  str('certificate', 'Клиентский сертификат.'), str('private-key', 'Клиентский ключ.'), strs('alpn', 'ALPN к server-url.'), str('proxy', 'Через какой прокси ходить к server-url.', { ref: 'proxy-target' }),
]

const QUIC_TUNING: FieldSchema[] = [
  num('recv-window-conn', 'Окно приёма соединения.'), num('recv-window', 'Окно приёма потока.'), bool('disable-mtu-discovery', 'Не искать MTU.'),
  num('cwnd', 'Начальное окно перегрузки.'), en('bbr-profile', 'Профиль BBR.', BBR_PROFILE_VALUES), num('max-datagram-frame-size', 'Максимальный кадр датаграммы.'),
]

const ip = (t: string, ...values: string[]) => when('type', t, ...values)

export const PROXY_FIELDS: FieldSchema[] = [
  str('name', 'Имя сервера: на него ссылаются группы и правила.'),
  en('type', 'Протокол сервера.', PROXY_TYPE_VALUES),
  str('server', 'Адрес сервера.', { when: whenNot('type', ...NO_ADDRESS) }),
  num('port', 'Порт сервера.', { when: whenNot('type', ...NO_ADDRESS) }),
  bool('udp', 'Разрешить UDP через сервер.', { when: whenNot('type', 'dns', 'rematch') }),
  en('ip-version', 'Какую версию IP использовать для сервера.', IP_VERSION_VALUES, { when: whenNot('type', 'dns', 'rematch') }),
  str('interface-name', 'Исходящий интерфейс для этого сервера.', { when: whenNot('type', 'dns', 'rematch') }),
  num('routing-mark', 'fwmark для этого сервера (Linux).', { when: whenNot('type', 'dns', 'rematch') }),
  bool('tfo', 'TCP Fast Open.', { when: whenNot('type', ...NO_ADDRESS) }),
  bool('mptcp', 'Multipath TCP.', { when: whenNot('type', ...NO_ADDRESS) }),
  dialerProxy({ when: whenNot('type', 'direct', 'dns', 'rematch') }),
  obj('smux', 'Мультиплексирование (sing-mux) поверх ss, vmess, vless, trojan.', SMUX_FIELDS, { when: ip('ss', 'vmess', 'vless', 'trojan') }),

  // http / socks5
  str('username', 'Имя пользователя.', { when: ip('http', 'socks5', 'ssh', 'mieru', 'shadowquic', 'trusttunnel', 'openvpn', 'gost-relay') }),
  str('password', 'Пароль.', { when: ip('http', 'socks5', 'ss', 'ssr', 'trojan', 'hysteria2', 'tuic', 'ssh', 'mieru', 'shadowquic', 'anytls', 'trusttunnel', 'openvpn', 'gost-relay') }),
  map('headers', 'Заголовки HTTP-прокси.', { when: ip('http') }),
  ...withWhen(CLIENT_TLS_FIELDS, ip('http', 'socks5', 'vmess', 'vless', 'trojan', 'anytls', 'trusttunnel', 'gost-relay', 'hysteria', 'hysteria2', 'tuic', 'shadowquic', 'snell')),

  // shadowsocks
  en('cipher', 'Шифр Shadowsocks.', SS_CIPHER_VALUES, { when: ip('ss', 'ssr') }),
  bool('udp-over-tcp', 'UDP поверх TCP (sing-box UoT).', { when: ip('ss') }),
  num('udp-over-tcp-version', 'Версия UoT: 1 или 2.', { when: ip('ss'), min: 1 }),
  en('plugin', 'Плагин обфускации.', ['obfs', 'v2ray-plugin', 'shadow-tls', 'restls', 'gost-plugin', 'jls', 'kcptun'], { when: ip('ss') }),
  obj('plugin-opts', 'Параметры плагина: набор зависит от plugin.', PLUGIN_OPTS_FIELDS, { when: ip('ss') }),

  // ssr
  str('obfs', 'Обфускация SSR либо hysteria/hysteria2 (obfs_str, salamander, gecko).', { when: ip('ssr', 'hysteria', 'hysteria2') }),
  str('protocol', 'Протокол SSR либо протокол hysteria (udp, wechat-video, faketcp).', { when: ip('ssr', 'hysteria') }),
  str('obfs-param', 'Параметр обфускации SSR.', { when: ip('ssr') }),
  str('protocol-param', 'Параметр протокола SSR.', { when: ip('ssr') }),

  // snell
  str('psk', 'Общий ключ Snell.', { when: ip('snell') }),
  num('version', 'Версия Snell: 1–5.', { when: ip('snell'), min: 1 }),
  bool('reuse', 'Переиспользование соединений (Snell v4/v5).', { when: ip('snell') }),
  obj('obfs-opts', 'Обфускация Snell.', [
    en('mode', 'Режим.', ['http', 'tls', 'shadow-tls', 'restls', 'jls']), str('host', 'Домен маскировки.'), str('password', 'Пароль shadow-tls/restls/jls.'),
    num('version', 'Версия shadow-tls.'), strs('alpn', 'ALPN.'), str('version-hint', 'Версия TLS restls.'), str('username', 'Имя пользователя jls.'),
  ], { when: ip('snell') }),

  // vmess / vless
  str('uuid', 'UUID пользователя.', { when: ip('vmess', 'vless', 'tuic') }),
  num('alterId', 'alterId VMess.', { when: ip('vmess') }),
  en('cipher', 'Шифр VMess.', ['auto', 'aes-128-gcm', 'chacha20-poly1305', 'none'], { when: ip('vmess') }),
  str('flow', 'Поток XTLS: xtls-rprx-vision у VLESS; xtls-rprx-origin/direct у Trojan.', { when: ip('vless', 'trojan') }),
  bool('flow-show', 'Показывать поток (Trojan XTLS).', { when: ip('trojan') }),
  en('packet-encoding', 'Кодирование пакетов.', ['packetaddr', 'xudp'], { when: ip('vmess', 'vless') }),
  str('encryption', 'VLESS encryption: строка mlkem768x25519plus… либо пусто.', { when: ip('vless') }),
  bool('global-padding', 'Глобальное дополнение VMess.', { when: ip('vmess') }),
  bool('authenticated-length', 'Аутентифицированная длина VMess.', { when: ip('vmess') }),
  obj('tlsmirror-opts', 'TLS-mirror: TLS-носитель с настройками из servername/alpn/… этой записи.', TLS_MIRROR_FIELDS, { when: ip('vmess') }),
  en('network', 'Транспорт.', NETWORK_VALUES, { when: ip('vmess', 'vless', 'trojan') }),
  obj('ws-opts', 'Параметры WebSocket.', WS_OPTS_FIELDS, { when: when('network', 'ws') }),
  obj('h2-opts', 'Параметры HTTP/2.', H2_OPTS_FIELDS, { when: when('network', 'h2') }),
  obj('http-opts', 'Параметры HTTP-маскировки.', HTTP_OPTS_FIELDS, { when: when('network', 'http') }),
  obj('grpc-opts', 'Параметры gRPC.', GRPC_OPTS_FIELDS, { when: when('network', 'grpc') }),
  obj('xhttp-opts', 'Параметры XHTTP.', XHTTP_OPTS_FIELDS, { when: when('network', 'xhttp') }),
  obj('mkcp-opts', 'Параметры mKCP.', MKCP_OPTS_FIELDS, { when: when('network', 'mkcp') }),
  obj('mekya-opts', 'Параметры Mekya.', MEKYA_OPTS_FIELDS, { when: when('network', 'mekya') }),

  // trojan
  obj('ss-opts', 'Shadowsocks внутри Trojan (как в trojan-go).', [bool('enabled', 'Включить.'), en('method', 'Шифр.', ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305']), str('password', 'Пароль.')], { when: ip('trojan') }),

  // hysteria / hysteria2
  str('ports', 'Порты прыжков, например 1000,2000-3000; port при этом обязателен.', { when: ip('hysteria', 'hysteria2') }),
  str('hop-interval', 'Интервал смены порта, секунд или диапазон 15-30.', { when: ip('hysteria2') }),
  str('auth-str', 'Пароль Hysteria.', { when: ip('hysteria') }),
  str('up', 'Скорость отдачи, например 30 Mbps.', { when: ip('hysteria', 'hysteria2', 'shadowquic') }),
  str('down', 'Скорость приёма, например 200 Mbps.', { when: ip('hysteria', 'hysteria2', 'shadowquic') }),
  str('obfs-password', 'Пароль обфускации Hysteria 2.', { when: ip('hysteria2') }),
  num('obfs-min-packet-size', 'Минимальный размер пакета (gecko).', { when: ip('hysteria2') }),
  num('obfs-max-packet-size', 'Максимальный размер пакета (gecko).', { when: ip('hysteria2') }),
  bool('fast-open', 'Быстрое открытие (Hysteria, TUIC).', { when: ip('hysteria', 'tuic') }),
  obj('realm-opts', 'Hysteria 2 Realm.', REALM_OPTS_FIELDS, { when: ip('hysteria2') }),
  num('handshake-timeout', 'Таймаут рукопожатия, секунд; 0 — только внешний таймаут.', { when: ip('hysteria2', 'masque', 'openvpn') }),
  num('initial-stream-receive-window', 'quic-go: начальное окно потока.', { when: ip('hysteria2') }),
  num('max-stream-receive-window', 'quic-go: максимальное окно потока.', { when: ip('hysteria2') }),
  num('initial-connection-receive-window', 'quic-go: начальное окно соединения.', { when: ip('hysteria2') }),
  num('max-connection-receive-window', 'quic-go: максимальное окно соединения.', { when: ip('hysteria2') }),

  // tuic
  str('token', 'Токен TUIC v4.', { when: ip('tuic') }),
  str('ip', 'IP сервера в обход DNS (TUIC) либо адрес интерфейса (WireGuard, MASQUE).', { when: ip('tuic', 'wireguard', 'masque') }),
  num('heartbeat-interval', 'Интервал heartbeat, мс.', { when: ip('tuic') }),
  bool('disable-sni', 'Не отправлять SNI.', { when: ip('tuic') }),
  bool('reduce-rtt', '0-RTT рукопожатие.', { when: ip('tuic') }),
  num('request-timeout', 'Таймаут запроса, мс.', { when: ip('tuic') }),
  en('udp-relay-mode', 'Режим UDP-ретрансляции.', ['native', 'quic'], { when: ip('tuic') }),
  en('congestion-controller', 'Алгоритм перегрузки QUIC.', CONGESTION_VALUES, { when: ip('tuic', 'shadowquic', 'masque', 'trusttunnel') }),
  num('max-udp-relay-packet-size', 'Максимальный UDP-пакет.', { when: ip('tuic') }),
  num('max-open-streams', 'Максимум открытых потоков.', { when: ip('tuic', 'shadowquic') }),
  bool('udp-over-stream', 'UDP поверх потока (расширение Meta).', { when: ip('tuic', 'shadowquic') }),
  num('udp-over-stream-version', 'Версия UDP поверх потока.', { when: ip('tuic') }),
  ...withWhen(QUIC_TUNING, ip('hysteria', 'hysteria2', 'tuic', 'shadowquic', 'trusttunnel')),

  // wireguard
  str('ipv6', 'Адрес IPv6 интерфейса.', { when: ip('wireguard', 'masque') }),
  str('private-key', 'Приватный ключ.', { when: ip('wireguard', 'masque') }),
  str('public-key', 'Публичный ключ сервера.', { when: ip('wireguard', 'masque') }),
  str('pre-shared-key', 'Общий ключ WireGuard.', { when: ip('wireguard') }),
  strs('reserved', 'Зарезервированные байты: строка base64 или три числа.', { when: ip('wireguard') }),
  num('persistent-keepalive', 'Keepalive, секунд.', { when: ip('wireguard') }),
  obj('ip-stack', 'Реализация IP-стека и алгоритм перегрузки.', IP_STACK_FIELDS, { when: ip('wireguard', 'zerotier', 'openvpn', 'masque') }),
  bool('remote-dns-resolve', 'Резолвить домены удалённо через туннель.', { when: ip('wireguard', 'zerotier', 'openvpn', 'masque') }),
  strs('dns', 'DNS-серверы внутри туннеля (при remote-dns-resolve).', { when: ip('wireguard', 'zerotier', 'openvpn', 'masque') }),
  num('refresh-server-ip-interval', 'Пересчитывать IP сервера каждые N секунд; 0 — только при старте.', { when: ip('wireguard') }),
  objs('peers', 'Пиры WireGuard; при непустом списке server/port/public-key записи игнорируются.', WG_PEER_FIELDS, { label: (v, i) => `пир #${i + 1}` }, { when: ip('wireguard') }),
  obj('amnezia-wg-option', 'Параметры AmneziaWG.', AMNEZIA_FIELDS, { when: ip('wireguard') }),
  num('mtu', 'MTU туннеля.', { when: ip('wireguard', 'zerotier', 'openvpn', 'masque') }),

  // tailscale / zerotier
  str('hostname', 'Имя устройства Tailscale.', { when: ip('tailscale') }),
  str('auth-key', 'Ключ авторизации Tailscale.', { when: ip('tailscale') }),
  str('control-url', 'Адрес control-сервера (Headscale).', { when: ip('tailscale') }),
  str('state-dir', 'Каталог состояния.', { when: ip('tailscale', 'zerotier') }),
  bool('ephemeral', 'Эфемерный узел.', { when: ip('tailscale') }),
  bool('accept-routes', 'Принимать subnet routes.', { when: ip('tailscale') }),
  str('exit-node', 'Выходной узел: IP или auto:any.', { when: ip('tailscale') }),
  bool('exit-node-allow-lan-access', 'Доступ к LAN при выходном узле.', { when: ip('tailscale') }),
  str('planet', 'Файл planet ZeroTier.', { when: ip('zerotier') }),
  num('physical-mtu', 'MTU UDP-нагрузки ZeroTier.', { when: ip('zerotier') }),
  num('primary-port', 'Основной UDP-порт ZeroTier.', { when: ip('zerotier') }),
  num('secondary-port', 'Второй UDP-порт; -1 — выключен.', { when: ip('zerotier'), min: -1 }),
  en('tcp-fallback-mode', 'Резерв через TCP-ретранслятор.', ['auto', 'force', 'disable'], { when: ip('zerotier') }),
  str('tcp-fallback-relay', 'Адрес TCP-ретранслятора.', { when: ip('zerotier') }),
  str('remote-trace-target', 'Узел для диагностических трасс.', { when: ip('zerotier') }),
  num('remote-trace-level', 'Уровень трасс.', { when: ip('zerotier') }),
  bool('low-bandwidth', 'Экономить фоновый трафик.', { when: ip('zerotier') }),
  bool('encrypted-hello', 'Шифрованный HELLO.', { when: ip('zerotier') }),
  objs('orbit', 'Федеративные корни (moons).', [str('world', 'ID мира.'), str('seed', 'ID узла-корня.')], { label: (_v, i) => `moon #${i + 1}` }, { when: ip('zerotier') }),

  // openvpn
  en('proto', 'Транспорт OpenVPN.', ['udp', 'tcp'], { when: ip('openvpn') }),
  str('dev', 'Устройство OpenVPN; только tun.', { when: ip('openvpn') }),
  strs('data-ciphers', 'Список шифров канала данных.', { when: ip('openvpn') }),
  str('data-ciphers-fallback', 'Шифр на случай неудачного согласования.', { when: ip('openvpn') }),
  str('auth', 'HMAC: MD5, SHA1, SHA256, SHA384, SHA512.', { when: ip('openvpn') }),
  en('comp-lzo', 'Сжатие LZO.', ['yes', 'no', 'adaptive'], { when: ip('openvpn') }),
  str('ca', 'Сертификат CA в PEM.', { when: ip('openvpn') }),
  str('cert', 'Сертификат клиента в PEM.', { when: ip('openvpn') }),
  str('key', 'Ключ клиента в PEM (OpenVPN) либо ключ Sudoku.', { when: ip('openvpn', 'sudoku') }),
  str('tls-auth', 'Статический ключ tls-auth.', { when: ip('openvpn') }),
  str('key-direction', 'Направление tls-auth: 0 или 1.', { when: ip('openvpn') }),
  str('tls-crypt', 'Статический ключ tls-crypt.', { when: ip('openvpn') }),
  str('tls-crypt-v2', 'Клиентский ключ tls-crypt-v2.', { when: ip('openvpn') }),
  map('peer-info', 'Пары peer-info для сервера.', { when: ip('openvpn') }),
  num('ping', 'Интервал ping.', { when: ip('openvpn') }),
  num('ping-restart', 'Перезапуск без ответа, секунд.', { when: ip('openvpn') }),
  num('tran-window', 'Сколько секунд старый ключ данных живёт после смены.', { when: ip('openvpn') }),

  // ssh
  str('privateKey', 'Путь к приватному ключу SSH (ключ ядра в camelCase).', { when: ip('ssh') }),
  str('private-key-passphrase', 'Пароль к ключу SSH.', { when: ip('ssh') }),
  strs('host-key', 'Ожидаемые ключи хоста.', { when: ip('ssh') }),
  strs('host-key-algorithms', 'Алгоритмы ключа хоста.', { when: ip('ssh') }),

  // mieru
  str('port-range', 'Диапазон портов Mieru; несовместимо с port.', { when: ip('mieru') }),
  en('transport', 'Транспорт Mieru.', ['TCP', 'UDP'], { when: ip('mieru') }),
  en('multiplexing', 'Уровень мультиплексирования.', ['MULTIPLEXING_OFF', 'MULTIPLEXING_LOW', 'MULTIPLEXING_MIDDLE', 'MULTIPLEXING_HIGH'], { when: ip('mieru') }),
  en('handshake-mode', 'Режим рукопожатия.', ['HANDSHAKE_STANDARD', 'HANDSHAKE_NO_WAIT'], { when: ip('mieru') }),
  str('traffic-pattern', 'Строка base64, подстраивающая сетевое поведение.', { when: ip('mieru') }),

  // sudoku
  en('aead-method', 'AEAD Sudoku.', ['chacha20-poly1305', 'aes-128-gcm', 'none'], { when: ip('sudoku') }),
  num('padding-min', 'Минимальная доля дополнения, %.', { when: ip('sudoku') }),
  num('padding-max', 'Максимальная доля дополнения, %.', { when: ip('sudoku') }),
  en('table-type', 'Таблица байтов.', ['prefer_ascii', 'prefer_entropy', 'up_ascii_down_entropy', 'up_entropy_down_ascii'], { when: ip('sudoku') }),
  str('custom-table', 'Своя таблица байтов (2 x, 2 p, 4 v).', { when: ip('sudoku') }),
  strs('custom-tables', 'Список своих таблиц; перекрывает custom-table.', { when: ip('sudoku') }),
  en('multiplex', 'Мультиплексирование Sudoku.', ['off', 'auto', 'on'], { when: ip('sudoku') }),
  obj('httpmask', 'HTTP-маскировка Sudoku.', [
    bool('disable', 'Отключить маскировку.'), en('mode', 'Режим.', ['legacy', 'stream', 'poll', 'auto', 'ws']), bool('tls', 'HTTPS/WSS.'),
    str('host', 'Host/SNI.'), str('path-root', 'Префикс путей.'), en('multiplex', 'Мультиплексирование (старый ключ).', ['off', 'auto', 'on']),
  ], { when: ip('sudoku') }),
  bool('enable-pure-downlink', 'Чистый нисходящий поток Sudoku.', { when: ip('sudoku') }),

  // anytls / trusttunnel / shadowquic
  str('client-metadata', 'Метаданные клиента для сервера AnyTLS.', { when: ip('anytls') }),
  num('idle-session-check-interval', 'Интервал проверки простаивающих сессий, секунд.', { when: ip('anytls') }),
  num('idle-session-timeout', 'Таймаут простаивающей сессии, секунд.', { when: ip('anytls') }),
  num('min-idle-session', 'Минимум простаивающих сессий.', { when: ip('anytls') }),
  bool('health-check', 'Проверка живости TrustTunnel.', { when: ip('trusttunnel') }),
  bool('quic', 'QUIC вместо TCP (TrustTunnel).', { when: ip('trusttunnel') }),
  num('max-connections', 'Максимум соединений (TrustTunnel).', { when: ip('trusttunnel') }),
  num('min-streams', 'Минимум потоков до нового соединения (TrustTunnel).', { when: ip('trusttunnel') }),
  num('max-streams', 'Максимум потоков в соединении (TrustTunnel).', { when: ip('trusttunnel') }),
  strs('quic-versions', 'Версии QUIC: v1, v2.', { when: ip('shadowquic') }),
  bool('zero-rtt', '0-RTT ShadowQUIC.', { when: ip('shadowquic') }),
  num('keep-alive-interval', 'Интервал keep-alive, мс.', { when: ip('shadowquic') }),

  // masque / gost-relay / rematch
  en('network', 'Режим MASQUE.', ['h3', 'h3-l4proxy', 'h2'], { when: ip('masque') }),
  bool('mux', 'Мультиплексирование GOST relay.', { when: ip('gost-relay') }),
  bool('forward', 'Режим форварда GOST relay: сервер сам выбирает цель.', { when: ip('gost-relay') }),
  str('target-rematch-name', 'Новая метка для REMATCH-NAME.', { when: ip('rematch') }),
  str('target-sub-rule', 'Подсписок, которым продолжить подбор.', { when: ip('rematch'), ref: 'sub-rule' }),

  // zerotier network id (строка, не транспорт)
  str('network', 'ID сети ZeroTier (16 hex-символов).', { when: ip('zerotier') }),
]
