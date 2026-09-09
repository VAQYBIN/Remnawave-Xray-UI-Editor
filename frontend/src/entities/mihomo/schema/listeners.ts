// Запись `listeners[]`: дополнительные входы сверх портов корня, и элемент
// `tunnels[]`: проброс локального порта на цель. Список типов входа шире, чем
// протоколов сервера (`proxies.ts`) — вход принимает клиентов, а не соединяется
// с сервером, отсюда свои протоколы (mixed, tun, tunnel, hysteria2-realm) и
// свои поля прикрытия (shadow-tls/res-tls/jls/reality на входе). Источник:
// wiki.metacubex.one/config/listeners и docs/config.yaml ядра (ветка Meta,
// 2026-09-09).

import { bool, en, map, num, obj, objs, str, strs, when, whenNot, type EnumValue, type FieldSchema } from '../../../shared/schema'
import { BBR_PROFILE_VALUES, CONGESTION_VALUES, KCP_FIELDS, TLS_SERVER_FIELDS } from './shared'
import { SS_CIPHER_VALUES } from './proxies'
import { TUN_FIELDS } from './tun'

export const LISTENER_TYPE_VALUES: EnumValue[] = [
  { value: 'socks', doc: 'SOCKS5.' }, { value: 'http', doc: 'HTTP(S).' }, { value: 'mixed', doc: 'HTTP(S) и SOCKS на одном порту.' },
  { value: 'redir', doc: 'Прозрачный (redirect).' }, { value: 'tproxy', doc: 'Прозрачный (TPROXY).' }, { value: 'tun', doc: 'TUN-интерфейс.' },
  { value: 'shadowsocks' }, { value: 'vmess' }, { value: 'vless' }, { value: 'trojan' }, { value: 'anytls' }, { value: 'mieru' }, { value: 'sudoku' },
  { value: 'tuic' }, { value: 'shadowquic' }, { value: 'hysteria2' }, { value: 'hysteria2-realm', doc: 'HTTP-сервер Realm для Hysteria 2.' },
  { value: 'trusttunnel' }, { value: 'tunnel', doc: 'Проброс порта на цель.' }, { value: 'snell' },
]

const lt = (...values: string[]) => when('type', ...values)
const USERS_LIST = objs('users', 'Пользователи входа.', [str('username', 'Имя.'), str('password', 'Пароль.'), str('uuid', 'UUID (vmess, vless).'), num('alterId', 'alterId (vmess).'), str('flow', 'Поток XTLS (vless).')], { label: (v, i) => ((v as { username?: unknown } | null)?.username as string) || `пользователь #${i + 1}` })

const SHADOW_TLS_SERVER: FieldSchema = obj('shadow-tls', 'ShadowTLS на входе.', [
  bool('enable', 'Включить.'), num('version', 'Версия 1–3.'), str('password', 'Пароль (v2).'),
  objs('users', 'Пользователи (v3).', [str('name', 'Имя.'), str('password', 'Пароль.')], { label: (v, i) => ((v as { name?: unknown } | null)?.name as string) || `#${i + 1}` }),
  obj('handshake', 'Куда проксировать рукопожатие.', [str('dest', 'Адрес:порт.'), str('proxy', 'Через какой прокси.')]),
])
const RES_TLS_SERVER: FieldSchema = obj('res-tls', 'Restls на входе.', [
  bool('enable', 'Включить.'), str('dest', 'Адрес:порт прикрытия.'), str('password', 'Пароль.'), str('restls-script', 'Сценарий.'),
  num('min-record-len', 'Минимальная длина записи.'), str('proxy', 'Через какой прокси.'), num('rate-limit', 'Ограничение fallback, бит/с.'),
])
const JLS_SERVER: FieldSchema = obj('jls-config', 'JLS на входе.', [
  bool('enable', 'Включить.'), objs('users', 'Пользователи.', [str('username', 'Имя.'), str('password', 'Пароль.')], { label: (v, i) => ((v as { username?: unknown } | null)?.username as string) || `#${i + 1}` }),
  str('dest', 'Адрес:порт прикрытия.'), str('sni', 'SNI прикрытия.'), strs('alpn', 'ALPN.'), str('proxy', 'Через какой прокси.'), num('rate-limit', 'Ограничение, бит/с.'),
])
const REALITY_SERVER: FieldSchema = obj('reality-config', 'Reality на входе; несовместим с certificate/private-key.', [
  str('dest', 'Адрес:порт прикрытия.'), str('private-key', 'Приватный ключ (mihomo generate reality-keypair).'), strs('short-id', 'Короткие идентификаторы.'), strs('server-names', 'Имена серверов.'),
  obj('limit-fallback-upload', 'Ограничение отдачи непрошедших проверку.', [num('after-bytes', 'После байт.'), num('bytes-per-sec', 'Базовая скорость.'), num('burst-bytes-per-sec', 'Пиковая скорость.')]),
  obj('limit-fallback-download', 'Ограничение приёма непрошедших проверку.', [num('after-bytes', 'После байт.'), num('bytes-per-sec', 'Базовая скорость.'), num('burst-bytes-per-sec', 'Пиковая скорость.')]),
])

export const LISTENER_FIELDS: FieldSchema[] = [
  str('name', 'Имя входа; на него ссылается правило IN-NAME.'),
  en('type', 'Тип входа.', LISTENER_TYPE_VALUES),
  str('listen', 'Адрес прослушивания; по умолчанию 0.0.0.0.', { when: whenNot('type', 'tun') }),
  str('port', 'Порт либо список диапазонов: 200,204,401-429.', { when: whenNot('type', 'tun') }),
  num('routing-mark', 'fwmark сокета (Linux).', { when: whenNot('type', 'tun') }),
  str('rule', 'Подсписок правил вместо основного списка.', { ref: 'sub-rule' }),
  str('proxy', 'Отдавать весь трафик входа этой группе или серверу, минуя правила.', { ref: 'proxy-target' }),
  bool('udp', 'Разрешить UDP.', { when: lt('socks', 'mixed', 'tproxy', 'snell') }),
  { ...USERS_LIST, when: lt('socks', 'http', 'mixed', 'vmess', 'vless', 'trojan', 'shadowquic') },
  ...TLS_SERVER_FIELDS.map((f) => ({ ...f, when: lt('socks', 'http', 'mixed', 'vmess', 'vless', 'trojan', 'anytls', 'tuic', 'hysteria2') })),
  bool('allow-insecure', 'Разрешить вход без TLS (только за nginx/caddy).', { when: lt('vless', 'trojan', 'anytls') }),
  // shadowsocks
  str('password', 'Пароль.', { when: lt('shadowsocks') }),
  en('cipher', 'Шифр.', SS_CIPHER_VALUES, { when: lt('shadowsocks') }),
  obj('simple-obfs', 'simple-obfs на входе.', [bool('enable', 'Включить.'), en('mode', 'Режим.', ['http', 'tls'])], { when: lt('shadowsocks') }),
  obj('kcp-tun', 'kcptun на входе.', [bool('enable', 'Включить.'), str('key', 'Секрет.'), str('crypt', 'Шифр.'), str('mode', 'Профиль.'), num('conn', 'Соединений.'), num('autoexpire', 'Срок жизни.'), num('scavengettl', 'TTL истёкших.'), num('ratelimit', 'Ограничение.'), num('mtu', 'MTU.'), num('sndwnd', 'Окно отправки.'), num('rcvwnd', 'Окно приёма.'), num('datashard', 'Данные RS.'), num('parityshard', 'Чётность RS.'), num('dscp', 'DSCP.'), bool('nocomp', 'Без сжатия.'), bool('acknodelay', 'ACK сразу.'), num('nodelay', 'nodelay.'), num('interval', 'interval.'), num('resend', 'resend.'), num('sockbuf', 'Буфер.'), num('smuxver', 'Версия smux.'), num('smuxbuf', 'Буфер smux.'), num('framesize', 'Кадр.'), num('streambuf', 'Буфер потока.'), num('keepalive', 'Keepalive.')], { when: lt('shadowsocks') }),
  { ...SHADOW_TLS_SERVER, when: lt('shadowsocks', 'snell', 'vmess', 'vless', 'trojan', 'anytls') },
  { ...RES_TLS_SERVER, when: lt('shadowsocks', 'snell', 'vmess', 'vless', 'trojan', 'anytls') },
  { ...JLS_SERVER, when: lt('shadowsocks', 'snell', 'vmess', 'vless', 'trojan', 'anytls') },
  { ...REALITY_SERVER, when: lt('vmess', 'vless', 'trojan') },
  // snell
  str('psk', 'Общий ключ Snell.', { when: lt('snell') }),
  num('version', 'Версия Snell 1–5.', { when: lt('snell') }),
  obj('obfs-opts', 'Обфускация Snell.', [en('mode', 'Режим.', ['http', 'tls']), str('host', 'Домен.')], { when: lt('snell') }),
  // vmess / vless / trojan
  str('ws-path', 'Путь WebSocket; непусто — транспорт ws.', { when: lt('vmess', 'vless', 'trojan') }),
  str('grpc-service-name', 'Имя gRPC-службы; непусто — транспорт grpc.', { when: lt('vmess', 'vless', 'trojan') }),
  obj('mkcp-config', 'mKCP на входе.', [bool('enable', 'Включить.'), ...KCP_FIELDS], { when: lt('vmess') }),
  obj('mekya-config', 'Mekya на входе.', [bool('enable', 'Включить.'), num('max-write-size', 'Максимум байт в ответе.'), num('max-write-duration-ms', 'Максимум длительности ответа, мс.'), num('max-simultaneous-write-connection', 'Ожидающих запросов на сессию.'), num('packet-writing-buffer', 'Буфер записи.'), obj('kcp', 'KCP.', KCP_FIELDS)], { when: lt('vmess') }),
  obj('tlsmirror-config', 'TLS-mirror на входе.', [str('dest', 'Адрес прикрытия.'), str('primary-key', 'Главный ключ.'), str('proxy', 'Прокси.'), strs('explicit-nonce-ciphersuites', 'Шифросьюты.'), bool('sequence-watermarking-enabled', 'Водяные знаки.')], { when: lt('vmess') }),
  obj('xhttp-config', 'XHTTP на входе.', [str('path', 'Путь.'), str('host', 'Host.'), en('mode', 'Режим.', ['auto', 'stream-one', 'stream-up', 'packet-up']), bool('no-sse-header', 'Без SSE-заголовка.'), str('x-padding-bytes', 'Дополнение.'), bool('x-padding-obfs-mode', 'Обфускация дополнения.'), str('x-padding-key', 'Ключ.'), str('x-padding-header', 'Заголовок.'), str('x-padding-placement', 'Место.'), str('x-padding-method', 'Способ.'), str('uplink-http-method', 'Метод.'), str('session-placement', 'Место сессии.'), str('session-key', 'Ключ сессии.'), str('session-table', 'Таблица сессий.'), str('session-length', 'Длина идентификатора.'), str('seq-placement', 'Место номера.'), str('seq-key', 'Ключ номера.'), str('uplink-data-placement', 'Место данных.'), str('uplink-data-key', 'Ключ данных.'), num('uplink-chunk-size', 'Порция.'), num('sc-max-buffered-posts', 'Буфер POST.'), str('sc-stream-up-server-secs', 'Секунды stream-up.'), num('sc-max-each-post-bytes', 'Максимум байт POST.')], { when: lt('vless') }),
  str('decryption', 'VLESS encryption на сервере.', { when: lt('vless') }),
  obj('ss-option', 'Shadowsocks внутри Trojan.', [bool('enabled', 'Включить.'), en('method', 'Шифр.', ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305']), str('password', 'Пароль.')], { when: lt('trojan') }),
  // tuic / hysteria2 / shadowquic
  strs('token', 'Токены TUIC v4.', { when: lt('tuic') }),
  map('users', 'Пользователи uuid → пароль (tuic v5, hysteria2) или имя → пароль (anytls, mieru).', { when: lt('tuic', 'hysteria2', 'anytls', 'mieru') }),
  en('congestion-controller', 'Алгоритм перегрузки.', CONGESTION_VALUES, { when: lt('tuic', 'shadowquic') }),
  en('bbr-profile', 'Профиль BBR.', BBR_PROFILE_VALUES, { when: lt('tuic', 'hysteria2', 'shadowquic') }),
  num('max-idle-time', 'Максимальный простой, мс.', { when: lt('tuic', 'hysteria2', 'shadowquic') }),
  num('authentication-timeout', 'Таймаут аутентификации, мс.', { when: lt('tuic') }),
  strs('alpn', 'ALPN.', { when: lt('tuic', 'hysteria2', 'shadowquic') }),
  num('max-udp-relay-packet-size', 'Максимальный UDP-пакет.', { when: lt('tuic') }),
  str('up', 'Скорость отдачи.', { when: lt('hysteria2', 'shadowquic') }),
  str('down', 'Скорость приёма.', { when: lt('hysteria2', 'shadowquic') }),
  str('obfs', 'Обфускация: salamander или gecko.', { when: lt('hysteria2') }),
  str('obfs-password', 'Пароль обфускации.', { when: lt('hysteria2') }),
  num('obfs-min-packet-size', 'Минимальный пакет (gecko).', { when: lt('hysteria2') }),
  num('obfs-max-packet-size', 'Максимальный пакет (gecko).', { when: lt('hysteria2') }),
  bool('ignore-client-bandwidth', 'Не учитывать полосу клиента.', { when: lt('hysteria2', 'shadowquic') }),
  str('masquerade', 'Маскировка при неудачной аутентификации: file://, http://, https://.', { when: lt('hysteria2') }),
  obj('realm-opts', 'Realm.', [bool('enable', 'Включить.'), str('server-url', 'Сервер Realm.'), str('token', 'Токен.'), str('realm-id', 'Realm.'), strs('stun-servers', 'STUN.'), str('proxy', 'Прокси к server-url.'), bool('skip-cert-verify', 'Не проверять сертификат.'), str('name-cert-verify', 'DNSName.'), str('sni', 'SNI.'), str('fingerprint', 'Отпечаток.'), str('certificate', 'Сертификат.'), str('private-key', 'Ключ.'), strs('alpn', 'ALPN.')], { when: lt('hysteria2') }),
  obj('jls-upstream', 'Куда уводить не прошедших JLS (shadowquic).', [str('addr', 'Адрес:порт.'), str('sni', 'SNI.'), str('proxy', 'Прокси.'), num('rate-limit', 'Ограничение.')], { when: lt('shadowquic') }),
  strs('quic-versions', 'Версии QUIC.', { when: lt('shadowquic') }),
  bool('zero-rtt', '0-RTT.', { when: lt('shadowquic') }),
  num('cwnd', 'Окно перегрузки.', { when: lt('shadowquic') }),
  num('max-datagram-frame-size', 'Кадр датаграммы.', { when: lt('shadowquic') }),
  num('recv-window-conn', 'Окно приёма соединения.', { when: lt('shadowquic') }),
  num('recv-window', 'Окно приёма.', { when: lt('shadowquic') }),
  bool('disable-mtu-discovery', 'Не искать MTU.', { when: lt('shadowquic') }),
  // hysteria2-realm
  num('max-realms', 'Максимум realm; 0 — без предела.', { when: lt('hysteria2-realm') }),
  num('max-realms-per-ip', 'Максимум realm на IP.', { when: lt('hysteria2-realm') }),
  str('trusted-proxy-header', 'Заголовок с настоящим IP клиента.', { when: lt('hysteria2-realm') }),
  str('realm-name-pattern', 'Регулярное выражение имён realm.', { when: lt('hysteria2-realm') }),
  // mieru / sudoku / anytls
  en('transport', 'Транспорт Mieru.', ['TCP', 'UDP'], { when: lt('mieru') }),
  str('traffic-pattern', 'Строка base64 сетевого поведения.', { when: lt('mieru') }),
  bool('user-hint-is-mandatory', 'Отклонять клиентов без подсказки пользователя.', { when: lt('mieru') }),
  str('key', 'Ключ Sudoku.', { when: lt('sudoku') }),
  en('aead-method', 'AEAD.', ['chacha20-poly1305', 'aes-128-gcm', 'none'], { when: lt('sudoku') }),
  num('padding-min', 'Минимальное дополнение, %.', { when: lt('sudoku') }),
  num('padding-max', 'Максимальное дополнение, %.', { when: lt('sudoku') }),
  en('table-type', 'Таблица байтов.', ['prefer_ascii', 'prefer_entropy', 'up_ascii_down_entropy', 'up_entropy_down_ascii'], { when: lt('sudoku') }),
  str('custom-table', 'Своя таблица.', { when: lt('sudoku') }),
  strs('custom-tables', 'Список таблиц.', { when: lt('sudoku') }),
  num('handshake-timeout', 'Таймаут рукопожатия, секунд.', { when: lt('sudoku') }),
  bool('enable-pure-downlink', 'Чистый нисходящий поток.', { when: lt('sudoku') }),
  obj('httpmask', 'HTTP-маскировка.', [bool('disable', 'Отключить.'), en('mode', 'Режим.', ['legacy', 'stream', 'poll', 'auto', 'ws']), str('path-root', 'Префикс путей.')], { when: lt('sudoku') }),
  str('fallback', 'Куда отдавать обычные HTTP-запросы.', { when: lt('sudoku') }),
  str('padding-scheme', 'Схема дополнения AnyTLS.', { when: lt('anytls') }),
  // tunnel
  strs('network', 'Сети проброса: tcp, udp.', { values: ['tcp', 'udp'], when: lt('tunnel') }),
  str('target', 'Цель проброса host:port.', { when: lt('tunnel') }),
  // tun — те же поля, что у корневого tun (без enable)
  ...TUN_FIELDS.filter((f) => f.key !== 'enable').map((f) => ({ ...f, when: lt('tun') })),
]

/** Элемент `tunnels[]` в развёрнутой форме; однострочная форма (`tcp/udp,addr,target,proxy`) — скаляр, форма его показывает на чтение */
export const TUNNEL_FIELDS: FieldSchema[] = [
  strs('network', 'Сети: tcp, udp.', { values: ['tcp', 'udp'] }),
  str('address', 'Локальный адрес:порт.'),
  str('target', 'Цель host:port.'),
  str('proxy', 'Через какую группу или сервер.', { ref: 'proxy-target' }),
]
