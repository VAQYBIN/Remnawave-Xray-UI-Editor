// Выходы: серверы всех протоколов, группы и прямой выход — один список полей,
// развёрнутый условиями по `type`. Один и тот же ключ у разных типов описан
// разными полями (obfs у hysteria2 — объект, у hysteria — строка): условия
// взаимно исключают друг друга, и в видимом наборе ключ один.
//
// Источник: sing-box.sagernet.org/configuration/outbound/* на 2026-09-09.
// Генератор панели подставляет в группы только vless, trojan, shadowsocks и
// hysteria2 — это записано в docs у соответствующих значений type.

import type { EnumValue, FieldSchema } from '../../../shared/schema'
import {
  DIAL_FIELDS,
  NETWORK_VALUES,
  SS_METHOD_VALUES,
  UDP_OVER_TCP_FIELDS,
  bool,
  en,
  map,
  multiplexObject,
  num,
  obj,
  removed,
  str,
  strs,
  tlsObject,
  transportObject,
  when,
  whenNot,
  withWhen,
} from './shared'

export const GROUP_TYPES = ['selector', 'urltest']

/** Типы с адресом сервера */
export const SERVER_OUTBOUND_TYPES = [
  'vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'hysteria', 'tuic', 'anytls', 'shadowtls', 'ssh', 'socks', 'http', 'naive', 'snell',
]

const TLS_TYPES = ['vless', 'vmess', 'trojan', 'hysteria2', 'hysteria', 'tuic', 'anytls', 'shadowtls', 'http', 'naive']
const TRANSPORT_TYPES = ['vless', 'vmess', 'trojan']
const MULTIPLEX_TYPES = ['vless', 'vmess', 'trojan', 'shadowsocks']
const NETWORK_TYPES = ['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'hysteria', 'tuic', 'socks', 'snell', 'direct']
/** Типы без dial-полей: группы и записи без соединения наружу */
const NO_DIAL_TYPES = [...GROUP_TYPES, 'block', 'dns', 'bridge']

export const OUTBOUND_TYPE_VALUES: EnumValue[] = [
  { value: 'direct', doc: 'Прямое соединение, минуя прокси.' },
  { value: 'selector', doc: 'Группа с ручным выбором. Панель заменит её список тегами серверов подписки.' },
  { value: 'urltest', doc: 'Группа с автовыбором по задержке. Панель заменит её список тегами серверов подписки.' },
  { value: 'vless', doc: 'Сервер VLESS.' },
  { value: 'trojan', doc: 'Сервер Trojan.' },
  { value: 'shadowsocks', doc: 'Сервер Shadowsocks.' },
  { value: 'hysteria2', doc: 'Сервер Hysteria2.' },
  { value: 'vmess', doc: 'Сервер VMess. Панель такие серверы в группы не добавляет.' },
  { value: 'hysteria', doc: 'Сервер Hysteria первой версии. Панель такие серверы в группы не добавляет.' },
  { value: 'tuic', doc: 'Сервер TUIC. Панель такие серверы в группы не добавляет.' },
  { value: 'anytls', doc: 'Сервер AnyTLS (ядро 1.12 и новее). Панель такие серверы в группы не добавляет.' },
  { value: 'shadowtls', doc: 'ShadowTLS: маскировка TLS-рукопожатия под чужой сайт.' },
  { value: 'ssh', doc: 'SSH-туннель.' },
  { value: 'tor', doc: 'Встроенный Tor; в сборку по умолчанию не входит.' },
  { value: 'socks', doc: 'Прокси SOCKS. Панель такие серверы в группы не добавляет.' },
  { value: 'http', doc: 'Прокси HTTP. Панель такие серверы в группы не добавляет.' },
  { value: 'naive', doc: 'NaïveProxy (ядро 1.13 и новее).' },
  { value: 'snell', doc: 'Snell (ядро 1.13 и новее).' },
  { value: 'bridge', doc: 'Мост в системный интерфейс (ядро 1.14 и новее).' },
  { value: 'block', doc: 'Выход-заглушка.', deprecated: removed('1.13.0', 'правило маршрута с action: reject') },
  { value: 'dns', doc: 'Выход для DNS.', deprecated: removed('1.13.0', 'правила маршрута с action: sniff и action: hijack-dns') },
  { value: 'wireguard', doc: 'WireGuard как выход.', deprecated: removed('1.13.0', 'запись type: wireguard в списке endpoints') },
]

const server = when('type', ...SERVER_OUTBOUND_TYPES)

export const OUTBOUND_FIELDS: FieldSchema[] = [
  en('type', 'Тип выхода: протокол сервера, группа выбора или прямой выход.', OUTBOUND_TYPE_VALUES),
  str('tag', 'Имя выхода. По нему на выход ссылаются правила и группы.'),
  str('server', 'Адрес сервера.', { when: server }),
  num('server_port', 'Порт сервера.', { when: server }),

  // ── общие для нескольких протоколов ──
  str('uuid', 'UUID пользователя.', { when: when('type', 'vless', 'vmess', 'tuic') }),
  str('password', 'Пароль.', { when: when('type', 'trojan', 'shadowsocks', 'hysteria2', 'tuic', 'anytls', 'shadowtls', 'socks', 'http', 'naive', 'ssh') }),
  str('username', 'Имя пользователя.', { when: when('type', 'socks', 'http', 'naive') }),
  en('network', 'Транспорт: tcp или udp; пусто — оба.', NETWORK_VALUES, { when: when('type', ...NETWORK_TYPES) }),
  en('packet_encoding', 'Кодирование UDP-пакетов; пусто — xudp.', ['packetaddr', 'xudp'], { when: when('type', 'vless', 'vmess') }),

  // ── vless ──
  en('flow', 'Поток XTLS; пусто — без него.', ['xtls-rprx-vision'], { when: when('type', 'vless') }),

  // ── vmess ──
  en('security', 'Шифрование VMess; пусто — auto.', ['auto', 'none', 'zero', 'aes-128-gcm', 'chacha20-poly1305', 'aes-128-ctr'], { when: when('type', 'vmess') }),
  num('alter_id', 'AlterID: 0 — AEAD, 1 — старый режим.', { when: when('type', 'vmess') }),
  bool('global_padding', 'Дополнять пакеты.', { when: when('type', 'vmess') }),
  bool('authenticated_length', 'Аутентифицировать длину.', { when: when('type', 'vmess') }),

  // ── shadowsocks ──
  en('method', 'Шифр Shadowsocks.', SS_METHOD_VALUES, { when: when('type', 'shadowsocks') }),
  en('plugin', 'SIP003-плагин.', ['obfs-local', 'v2ray-plugin'], { when: when('type', 'shadowsocks') }),
  str('plugin_opts', 'Параметры плагина.', { when: when('type', 'shadowsocks') }),
  obj('udp_over_tcp', 'UDP поверх TCP; несовместимо с multiplex.', UDP_OVER_TCP_FIELDS, { when: when('type', 'shadowsocks', 'socks', 'naive') }),

  // ── hysteria2 ──
  strs('server_ports', 'Диапазоны портов для прыжков, например 2080:3000.', { when: when('type', 'hysteria2', 'hysteria'), since: '1.11.0' }),
  str('hop_interval', 'Период смены порта, по умолчанию 30s.', { when: when('type', 'hysteria2', 'hysteria'), since: '1.11.0' }),
  str('hop_interval_max', 'Верхняя граница случайного периода смены порта.', { when: when('type', 'hysteria2'), since: '1.14.0' }),
  num('up_mbps', 'Отдача, Мбит/с; пусто — управление перегрузкой BBR.', { when: when('type', 'hysteria2', 'hysteria') }),
  num('down_mbps', 'Приём, Мбит/с.', { when: when('type', 'hysteria2', 'hysteria') }),
  obj('obfs', 'Обфускация QUIC.', [
    en('type', 'Вид обфускации.', ['salamander', { value: 'gecko', doc: 'Ядро 1.14 и новее.' }]),
    str('password', 'Пароль обфускации.'),
  ], { when: when('type', 'hysteria2') }),
  bool('brutal_debug', 'Отладка Brutal.', { when: when('type', 'hysteria2') }),

  // ── hysteria (v1) ──
  str('up', 'Отдача строкой, например 100 Mbps; альтернатива up_mbps.', { when: when('type', 'hysteria') }),
  str('down', 'Приём строкой, например 100 Mbps; альтернатива down_mbps.', { when: when('type', 'hysteria') }),
  str('obfs', 'Пароль обфускации.', { when: when('type', 'hysteria') }),
  str('auth', 'Пароль аутентификации в base64.', { when: when('type', 'hysteria') }),
  str('auth_str', 'Пароль аутентификации открытым текстом.', { when: when('type', 'hysteria') }),
  num('recv_window_conn', 'Окно приёма соединения.', { when: when('type', 'hysteria'), deprecated: removed('1.14.0', 'stream_receive_window') }),
  num('recv_window', 'Окно приёма.', { when: when('type', 'hysteria'), deprecated: removed('1.14.0', 'connection_receive_window') }),
  bool('disable_mtu_discovery', 'Не искать MTU.', { when: when('type', 'hysteria'), deprecated: removed('1.14.0', 'disable_path_mtu_discovery') }),

  // ── tuic ──
  en('congestion_control', 'Управление перегрузкой; пусто — cubic.', ['cubic', 'new_reno', 'bbr'], { when: when('type', 'tuic') }),
  en('udp_relay_mode', 'Режим UDP; пусто — native.', ['native', 'quic'], { when: when('type', 'tuic') }),
  bool('udp_over_stream', 'UDP поверх потока; несовместимо с udp_relay_mode.', { when: when('type', 'tuic') }),
  bool('zero_rtt_handshake', 'Рукопожатие 0-RTT.', { when: when('type', 'tuic') }),
  str('heartbeat', 'Период проверки живости, по умолчанию 10s.', { when: when('type', 'tuic') }),

  // ── anytls ──
  str('idle_session_check_interval', 'Как часто проверять простаивающие сессии, по умолчанию 30s.', { when: when('type', 'anytls') }),
  str('idle_session_timeout', 'Через сколько закрывать простаивающую сессию, по умолчанию 30s.', { when: when('type', 'anytls') }),
  num('min_idle_session', 'Сколько простаивающих сессий держать.', { when: when('type', 'anytls') }),
  str('client_metadata', 'Метаданные клиента.', { when: when('type', 'anytls'), since: '1.13.16' }),

  // ── shadowtls ──
  num('version', 'Версия ShadowTLS: 1, 2 или 3.', { when: when('type', 'shadowtls'), min: 1 }),

  // ── socks ──
  en('version', 'Версия SOCKS; пусто — 5.', ['4', '4a', '5'], { when: when('type', 'socks') }),

  // ── http ──
  str('path', 'Путь HTTP-запроса.', { when: when('type', 'http') }),
  map('headers', 'Дополнительные заголовки HTTP.', { when: when('type', 'http') }),

  // ── naive ──
  num('insecure_concurrency', 'Параллельных туннелей.', { when: when('type', 'naive') }),
  map('extra_headers', 'Дополнительные заголовки HTTP.', { when: when('type', 'naive') }),
  str('stream_receive_window', 'Окно приёма потока.', { when: when('type', 'naive') }),
  bool('quic', 'Использовать QUIC вместо HTTP/2.', { when: when('type', 'naive') }),
  en('quic_congestion_control', 'Управление перегрузкой QUIC; пусто — cubic.', ['bbr', 'bbr2', 'cubic', 'reno'], { when: when('type', 'naive') }),
  str('quic_session_receive_window', 'Окно приёма сессии QUIC.', { when: when('type', 'naive') }),

  // ── snell ──
  num('version', 'Версия Snell: 4 или 6.', { when: when('type', 'snell'), min: 4 }),
  str('psk', 'Общий ключ.', { when: when('type', 'snell') }),
  str('userkey', 'Ключ пользователя на многопользовательском сервере.', { when: when('type', 'snell') }),
  bool('reuse', 'Переиспользовать соединения.', { when: when('type', 'snell') }),
  en('obfs_mode', 'Обфускация (только версия 4); пусто — none.', ['none', 'http'], { when: when('type', 'snell') }),
  str('obfs_host', 'Host для обфускации http, по умолчанию bing.com.', { when: when('type', 'snell') }),
  en('mode', 'Режим трафика (только версия 6); пусто — default.', ['default', 'unshaped', 'unsafe-raw'], { when: when('type', 'snell') }),

  // ── ssh ──
  str('user', 'Пользователь SSH, по умолчанию root.', { when: when('type', 'ssh') }),
  strs('private_key', 'Приватный ключ в PEM, построчно.', { when: when('type', 'ssh') }),
  str('private_key_path', 'Путь к приватному ключу.', { when: when('type', 'ssh') }),
  str('private_key_passphrase', 'Пароль к приватному ключу.', { when: when('type', 'ssh') }),
  strs('host_key', 'Ожидаемые ключи хоста.', { when: when('type', 'ssh') }),
  strs('host_key_algorithms', 'Алгоритмы ключа хоста.', { when: when('type', 'ssh') }),
  str('client_version', 'Строка версии клиента.', { when: when('type', 'ssh') }),
  strs('cipher', 'Шифры.', { when: when('type', 'ssh'), since: '1.14.0' }),
  strs('mac', 'Алгоритмы MAC.', { when: when('type', 'ssh'), since: '1.14.0' }),
  strs('kex_algorithm', 'Алгоритмы обмена ключами.', { when: when('type', 'ssh'), since: '1.14.0' }),

  // ── tor ──
  str('executable_path', 'Путь к исполняемому файлу Tor.', { when: when('type', 'tor') }),
  strs('extra_args', 'Дополнительные аргументы Tor.', { when: when('type', 'tor') }),
  str('data_directory', 'Каталог данных Tor; без него каждый запуск очень медленный.', { when: when('type', 'tor') }),
  map('torrc', 'Параметры torrc.', { when: when('type', 'tor') }),

  // ── direct ──
  str('override_address', 'Подменять адрес назначения.', { when: when('type', 'direct'), deprecated: removed('1.11.0', 'поле override_address действия route-options') }),
  num('override_port', 'Подменять порт назначения.', { when: when('type', 'direct'), deprecated: removed('1.11.0', 'поле override_port действия route-options') }),

  // ── bridge ──
  str('interface', 'Интерфейс для исходящего трафика.', { when: when('type', 'bridge') }),
  str('bridge_name', 'Префикс имени TUN-моста.', { when: when('type', 'bridge') }),
  num('iproute2_table_index', 'Таблица маршрутов (Linux).', { when: when('type', 'bridge') }),
  num('iproute2_rule_index', 'Индекс правила маршрутизации (Linux).', { when: when('type', 'bridge') }),

  // ── группы ──
  strs('outbounds', 'Список выходов группы. Панель заменит его целиком: у urltest — тегами серверов, у selector — серверами и группами urltest. Чтобы список остался вашим, поставьте remnawave.includeProxies = false.', { ref: 'outbound', when: when('type', ...GROUP_TYPES) }),
  str('default', 'Выход, выбранный в группе изначально.', { ref: 'outbound', when: when('type', 'selector') }),
  str('url', 'Адрес для замера задержки в группе urltest.', { when: when('type', 'urltest') }),
  str('interval', 'Период повторного замера задержки, например 3m.', { when: when('type', 'urltest') }),
  num('tolerance', 'На сколько миллисекунд новый выход должен быть быстрее, чтобы группа переключилась.', { when: when('type', 'urltest') }),
  str('idle_timeout', 'Через сколько без трафика замеры останавливаются, по умолчанию 30m.', { when: when('type', 'urltest') }),
  bool('interrupt_exist_connections', 'Разрывать ли текущие соединения при смене выбранного выхода.', { when: when('type', ...GROUP_TYPES) }),
  obj('remnawave', 'Ключи панели: в конфиге, который получит клиент, их не будет.', [
    bool('includeProxies', 'false — не заполнять список этой группы серверами подписки.'),
  ], { panelKey: true, when: when('type', ...GROUP_TYPES) }),

  // ── общие объекты ──
  tlsObject({ when: when('type', ...TLS_TYPES) }),
  transportObject({ when: when('type', ...TRANSPORT_TYPES) }),
  multiplexObject({ when: when('type', ...MULTIPLEX_TYPES) }),

  // ── dial-поля: всем, кроме групп и записей без соединения ──
  ...withWhen(DIAL_FIELDS, whenNot('type', ...NO_DIAL_TYPES)),
]
