// Входы клиента. У tun свой набор полей (listen-полей у него нет), остальные
// наследуют listen-поля. Серверные протоколы (vless, vmess и прочие) в
// клиентском шаблоне входами не бывают и не описаны.
//
// Источник: sing-box.sagernet.org/configuration/inbound/* на 2026-09-09.

import type { EnumValue, FieldSchema } from '../../../shared/schema'
import {
  LISTEN_FIELDS,
  MULTIPLEX_FIELDS,
  NETWORK_VALUES,
  SS_METHOD_VALUES,
  TLS_FIELDS,
  bool,
  en,
  num,
  nums,
  obj,
  objs,
  removed,
  str,
  strs,
  when,
  whenNot,
  withWhen,
} from './shared'

export const INBOUND_TYPE_VALUES: EnumValue[] = [
  { value: 'tun', doc: 'Виртуальный сетевой интерфейс: забирает весь трафик системы.' },
  { value: 'mixed', doc: 'Локальный прокси HTTP и SOCKS на одном порту.' },
  { value: 'socks', doc: 'Локальный прокси SOCKS.' },
  { value: 'http', doc: 'Локальный прокси HTTP.' },
  { value: 'direct', doc: 'Туннель: всё принятое уходит по заданному адресу.' },
  { value: 'shadowsocks', doc: 'Сервер Shadowsocks на клиенте.' },
  { value: 'redirect', doc: 'Перехват через REDIRECT (Linux, macOS).' },
  { value: 'tproxy', doc: 'Перехват через TPROXY (Linux).' },
]

const tun = when('type', 'tun')
const proxy = when('type', 'mixed', 'socks', 'http')

export const INBOUND_FIELDS: FieldSchema[] = [
  en('type', 'Тип входа.', INBOUND_TYPE_VALUES),
  str('tag', 'Имя входа: на него ссылается условие inbound в правилах.'),

  // ── tun ──
  str('interface_name', 'Имя создаваемого интерфейса tun; пусто — выберет ядро.', { when: tun }),
  str('netns', 'Сетевое пространство имён Linux.', { when: tun, since: '1.14.0' }),
  strs('address', 'Адреса виртуального интерфейса tun с префиксом.', { when: tun }),
  num('mtu', 'Размер MTU интерфейса tun.', { when: tun }),
  en('dns_mode', 'Как обходиться с DNS на интерфейсе; пусто — hijack.', ['disabled', 'native', 'hijack'], { when: tun, since: '1.14.0' }),
  strs('dns_address', 'Адреса DNS, объявляемые интерфейсом.', { when: tun, since: '1.14.0' }),
  bool('auto_route', 'Прописывать системные маршруты в интерфейс tun.', { when: tun }),
  num('iproute2_table_index', 'Таблица маршрутов, по умолчанию 2022.', { when: tun }),
  num('iproute2_rule_index', 'Индекс правила маршрутизации, по умолчанию 9000.', { when: tun }),
  bool('auto_redirect', 'Перехватывать трафик через nftables (Linux).', { when: tun }),
  str('auto_redirect_input_mark', 'Метка входящих, по умолчанию 0x2023.', { when: tun }),
  str('auto_redirect_output_mark', 'Метка исходящих, по умолчанию 0x2024.', { when: tun }),
  str('auto_redirect_reset_mark', 'Метка сброса, по умолчанию 0x2025.', { when: tun, since: '1.13.0' }),
  num('auto_redirect_nfqueue', 'Номер очереди nfqueue, по умолчанию 100.', { when: tun, since: '1.13.0' }),
  num('auto_redirect_iproute2_fallback_rule_index', 'Индекс запасного правила, по умолчанию 32768.', { when: tun }),
  bool('exclude_mptcp', 'Не перехватывать MPTCP.', { when: tun, since: '1.13.0' }),
  strs('loopback_address', 'Адреса, которые считаются петлёй.', { when: tun, since: '1.12.0' }),
  bool('strict_route', 'Строгая маршрутизация: закрывает пути в обход туннеля.', { when: tun }),
  strs('route_address', 'Подсети, которые заворачивать в туннель.', { when: tun }),
  strs('route_exclude_address', 'Подсети, которые в туннель не заворачивать.', { when: tun }),
  strs('route_address_set', 'Наборы правил с подсетями для туннеля.', { when: tun, ref: 'rule-set' }),
  strs('route_exclude_address_set', 'Наборы правил с подсетями в обход туннеля.', { when: tun, ref: 'rule-set' }),
  bool('endpoint_independent_nat', 'NAT, не зависящий от адреса назначения; только стек gvisor.', { when: tun }),
  str('udp_timeout', 'Время жизни NAT-записи UDP, по умолчанию 5m.', { when: tun }),
  en('stack', 'Сетевой стек интерфейса tun.', ['system', 'gvisor', 'mixed'], { when: tun }),
  strs('include_interface', 'Интерфейсы, чей трафик заворачивать (Linux).', { when: tun }),
  strs('exclude_interface', 'Интерфейсы, чей трафик не трогать (Linux).', { when: tun }),
  nums('include_uid', 'UID, чей трафик заворачивать (Linux).', { when: tun }),
  strs('include_uid_range', 'Диапазоны UID, например 1000:99999.', { when: tun }),
  nums('exclude_uid', 'UID, чей трафик не трогать (Linux).', { when: tun }),
  strs('exclude_uid_range', 'Диапазоны UID в обход.', { when: tun }),
  nums('include_android_user', 'Пользователи Android, чей трафик заворачивать.', { when: tun }),
  strs('include_package', 'Пакеты Android, чей трафик заворачивать.', { when: tun }),
  strs('exclude_package', 'Пакеты Android в обход туннеля.', { when: tun }),
  strs('include_mac_address', 'MAC-адреса, чей трафик заворачивать (Linux).', { when: tun, since: '1.14.0' }),
  strs('exclude_mac_address', 'MAC-адреса в обход (Linux).', { when: tun, since: '1.14.0' }),
  obj('platform', 'Настройки графических клиентов.', [
    obj('http_proxy', 'Системный HTTP-прокси, который клиент объявляет вместе с tun.', [
      bool('enabled', 'Включить системный прокси.'),
      str('server', 'Адрес прокси.'),
      num('server_port', 'Порт прокси.'),
      strs('bypass_domain', 'Домены в обход прокси.'),
      strs('match_domain', 'Домены только через прокси (Apple).'),
    ]),
  ], { when: tun }),
  strs('inet4_address', 'Адреса IPv4 интерфейса.', { when: tun, deprecated: removed('1.10.0', 'address') }),
  strs('inet6_address', 'Адреса IPv6 интерфейса.', { when: tun, deprecated: removed('1.10.0', 'address') }),
  strs('inet4_route_address', 'Маршруты IPv4.', { when: tun, deprecated: removed('1.10.0', 'route_address') }),
  strs('inet6_route_address', 'Маршруты IPv6.', { when: tun, deprecated: removed('1.10.0', 'route_address') }),
  strs('inet4_route_exclude_address', 'Исключения IPv4.', { when: tun, deprecated: removed('1.10.0', 'route_exclude_address') }),
  strs('inet6_route_exclude_address', 'Исключения IPv6.', { when: tun, deprecated: removed('1.10.0', 'route_exclude_address') }),
  bool('gso', 'Обобщённая выгрузка сегментации пакетов (GSO).', { when: tun, deprecated: removed('1.11.0', 'ключ больше не действует, уберите его') }),

  // ── listen-поля: всем, кроме tun ──
  ...withWhen(LISTEN_FIELDS, whenNot('type', 'tun')),

  // ── mixed / socks / http ──
  objs('users', 'Пользователи прокси; пусто — без авторизации.', [
    str('username', 'Имя пользователя.'),
    str('password', 'Пароль.'),
  ], { label: (v, i) => String((v as { username?: unknown } | null)?.username ?? `#${i + 1}`), starter: () => ({ username: '', password: '' }) }, { when: proxy }),
  bool('set_system_proxy', 'Прописывать этот вход системным прокси.', { when: proxy }),
  obj('tls', 'TLS входа HTTP.', TLS_FIELDS, { when: when('type', 'http') }),

  // ── direct / tproxy / shadowsocks ──
  en('network', 'Слушать tcp, udp или оба.', NETWORK_VALUES, { when: when('type', 'direct', 'tproxy', 'shadowsocks') }),
  str('override_address', 'Адрес, куда уходит всё принятое.', { when: when('type', 'direct') }),
  num('override_port', 'Порт, куда уходит всё принятое.', { when: when('type', 'direct') }),

  // ── shadowsocks ──
  en('method', 'Шифр Shadowsocks.', SS_METHOD_VALUES, { when: when('type', 'shadowsocks') }),
  str('password', 'Пароль сервера.', { when: when('type', 'shadowsocks') }),
  objs('users', 'Пользователи многопользовательского сервера.', [
    str('name', 'Имя пользователя.'),
    str('password', 'Пароль пользователя.'),
  ], { label: (v, i) => String((v as { name?: unknown } | null)?.name ?? `#${i + 1}`), starter: () => ({ name: '', password: '' }) }, { when: when('type', 'shadowsocks') }),
  bool('managed', 'Управляемые пользователи через SSM API.', { when: when('type', 'shadowsocks') }),
  obj('multiplex', 'Мультиплексирование.', MULTIPLEX_FIELDS, { when: when('type', 'shadowsocks') }),
]
