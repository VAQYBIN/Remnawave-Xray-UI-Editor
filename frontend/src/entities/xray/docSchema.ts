// Декларативное описание дерева Xray-конфига для IntelliSense редактора JSON:
// какие ключи допустимы в каждом узле, их enum-значения и русские описания
// (tooltip). Это ЧИСТЫЕ данные без зависимости от CodeMirror — резолвер контекста
// и completion/hover питаются отсюда. Единый словарь на весь редактор.
//
// Знание домена совпадает с формами инспектора (те же enum'ы и hint'ы), но живёт
// здесь отдельно: формы редактируют конкретный узел, а completion работает по
// сырому тексту всего конфига и должен знать всё дерево целиком.

export interface DocEnum {
  value: string
  /** Короткое пояснение значения — показывается в tooltip подсказки */
  doc?: string
}

export type ScalarType = 'string' | 'number' | 'boolean' | 'array' | 'object'

/** Куда ведёт ключ и что можно ему присвоить */
export interface DocField {
  /** Русское описание ключа для tooltip (info в completion, текст hover) */
  doc?: string
  /** Тип значения — попадает в detail подсказки */
  type?: ScalarType
  /** Допустимые значения (для value-подсказок и hover) */
  enum?: DocEnum[]
  /** Ключ ведёт во вложенный объект — имя узла в NODES (или резолвер по props) */
  node?: string | ((props: Props) => string | undefined)
  /** Ключ ведёт в массив объектов — имя узла элемента (или резолвер по props) */
  itemsNode?: string | ((props: Props) => string | undefined)
}

/** Скалярные свойства текущего объекта (protocol, network, security …) —
 *  нужны для условной резолюции (settings по protocol и т.п.) */
export type Props = Record<string, string>

export interface DocNode {
  fields: Record<string, DocField>
  /** Дополнительные поля, зависящие от значений скаляров этого объекта */
  extra?: (props: Props) => Record<string, DocField>
}

// ── enum-словари (совпадают с select'ами форм инспектора) ──────────────────

const en = (values: string[]): DocEnum[] => values.map((value) => ({ value }))

const FLOW: DocEnum[] = [
  { value: 'xtls-rprx-vision', doc: 'XTLS Vision — маскирует размеры TLS-записей. Только поверх raw (tcp).' },
]
const SS_METHODS = en([
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
])
const NETWORKS: DocEnum[] = [
  { value: 'tcp', doc: 'TCP (raw) — базовый транспорт' },
  { value: 'raw', doc: 'Новое имя tcp (Xray ≥24.9.30)' },
  { value: 'ws', doc: 'WebSocket — удобно за CDN' },
  { value: 'grpc', doc: 'gRPC — мультиплексирование' },
  { value: 'httpupgrade', doc: 'HTTPUpgrade — лёгкая альтернатива ws' },
  { value: 'xhttp', doc: 'XHTTP — транспорт поверх HTTP' },
  { value: 'hysteria', doc: 'Hysteria 2 поверх QUIC — требует TLS-сертификат' },
]
const SECURITIES: DocEnum[] = [
  { value: 'none', doc: 'Без шифрования транспорта' },
  { value: 'tls', doc: 'TLS с сертификатом' },
  { value: 'reality', doc: 'Reality — только raw(tcp)/xhttp/grpc' },
]
const FINGERPRINTS = en(['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random', 'randomized'])
const ALPN = en(['h2', 'http/1.1', 'h3'])
const TLS_VERSIONS = en(['1.0', '1.1', '1.2', '1.3'])
const XHTTP_MODES = en(['packet-up', 'stream-up', 'stream-one'])
const CONGESTIONS: DocEnum[] = [
  { value: 'reno', doc: 'CUBIC/Reno' },
  { value: 'bbr', doc: 'BBR' },
  { value: 'brutal', doc: 'Фиксированная полоса — требует brutalUp/brutalDown' },
  { value: 'force-brutal', doc: 'Brutal без согласования с пиром' },
]
const SOCKOPT_DOMAIN_STRATEGIES = en(['AsIs', 'UseIP', 'UseIPv4', 'UseIPv6'])
const FREEDOM_DOMAIN_STRATEGIES = en(['AsIs', 'UseIP', 'UseIPv4', 'UseIPv6', 'ForceIP', 'ForceIPv4', 'ForceIPv6'])
const WG_DOMAIN_STRATEGIES = en(['ForceIP', 'ForceIPv4', 'ForceIPv6', 'ForceIPv6v4'])
const DEST_OVERRIDE = en(['http', 'tls', 'quic', 'fakedns'])
const LOG_LEVELS: DocEnum[] = [
  { value: 'debug', doc: 'Максимально подробно' },
  { value: 'info' },
  { value: 'warning', doc: 'По умолчанию' },
  { value: 'error' },
  { value: 'none', doc: 'Отключить лог' },
]
const QUERY_STRATEGIES: DocEnum[] = [
  { value: 'UseIP', doc: 'A и AAAA' },
  { value: 'UseIPv4', doc: 'Только A' },
  { value: 'UseIPv6', doc: 'Только AAAA' },
]
const ROUTING_DOMAIN_STRATEGIES: DocEnum[] = [
  { value: 'AsIs', doc: 'Матчить только по домену' },
  { value: 'IPIfNonMatch', doc: 'Если по домену не совпало — резолвить и матчить по IP' },
  { value: 'IPOnDemand', doc: 'Резолвить при первом же IP-правиле' },
]
const ROUTING_DOMAIN_MATCHERS = en(['hybrid', 'linear'])
const RULE_NETWORKS = en(['tcp', 'udp', 'tcp,udp'])
const RULE_PROTOCOLS = en(['http', 'tls', 'quic', 'bittorrent'])
const XUDP_MODES: DocEnum[] = [
  { value: 'reject', doc: 'Отклонять UDP/443 (по умолчанию)' },
  { value: 'allow', doc: 'Пропускать через mux' },
  { value: 'skip', doc: 'Мимо mux' },
]
const BLACKHOLE_RESPONSES: DocEnum[] = [
  { value: 'none', doc: 'Молча разорвать' },
  { value: 'http', doc: 'Пустой HTTP-ответ (мягкий отказ)' },
]
const CERT_USAGES = en(['encipherment', 'verify', 'issue'])
const SS_NETWORKS = en(['tcp', 'udp', 'tcp,udp'])

const INBOUND_PROTOCOLS: DocEnum[] = [
  { value: 'vless', doc: 'VLESS — основной протокол панели' },
  { value: 'trojan', doc: 'Trojan' },
  { value: 'shadowsocks', doc: 'Shadowsocks (в т.ч. 2022)' },
  { value: 'hysteria', doc: 'Hysteria 2 (version: 2)' },
]
const OUTBOUND_PROTOCOLS: DocEnum[] = [
  { value: 'freedom', doc: 'Прямой выход в интернет' },
  { value: 'blackhole', doc: 'Блокировка трафика' },
  { value: 'wireguard', doc: 'WireGuard (WARP и др.)' },
  { value: 'socks', doc: 'Внешний SOCKS-прокси' },
  { value: 'http', doc: 'Внешний HTTP-прокси' },
  { value: 'vless', doc: 'Цепочка на другой VLESS-сервер' },
  { value: 'trojan', doc: 'Цепочка на Trojan-сервер' },
]

// ── реестр узлов дерева ────────────────────────────────────────────────────

const inboundSettingsNode = (p: Props): string | undefined =>
  ({
    vless: 'vlessInboundSettings',
    trojan: 'trojanInboundSettings',
    shadowsocks: 'ssInboundSettings',
    hysteria: 'hysteriaInboundSettings',
  })[p.protocol ?? 'vless']

const outboundSettingsNode = (p: Props): string | undefined =>
  ({
    freedom: 'freedomOutboundSettings',
    blackhole: 'blackholeOutboundSettings',
    wireguard: 'wireguardOutboundSettings',
    vless: 'vlessOutboundSettings',
    trojan: 'trojanOutboundSettings',
    socks: 'proxyOutboundSettings',
    http: 'proxyOutboundSettings',
  })[p.protocol ?? 'freedom']

export const NODES: Record<string, DocNode> = {
  config: {
    fields: {
      log: { doc: 'Логирование', type: 'object', node: 'log' },
      dns: { doc: 'Встроенный DNS-резолвер', type: 'object', node: 'dns' },
      inbounds: { doc: 'Входящие подключения', type: 'array', itemsNode: 'inbound' },
      outbounds: { doc: 'Исходящие подключения (точки выхода)', type: 'array', itemsNode: 'outbound' },
      routing: { doc: 'Правила маршрутизации', type: 'object', node: 'routing' },
      policy: { doc: 'Политики уровней и системная статистика', type: 'object' },
      transport: { doc: 'Глобальные настройки транспортов', type: 'object' },
      stats: { doc: 'Включение сбора статистики', type: 'object' },
      reverse: { doc: 'Обратные туннели (reverse proxy)', type: 'object' },
      fakedns: { doc: 'FakeDNS-пул для сниффинга', type: 'object' },
      observatory: { doc: 'Наблюдение за состоянием outbound-ов', type: 'object', node: 'observatory' },
      burstObservatory: {
        doc: 'Наблюдение с конкурентными замерами',
        type: 'object',
        node: 'burstObservatory',
      },
      api: { doc: 'gRPC API управления', type: 'object' },
      metrics: { doc: 'Метрики Prometheus', type: 'object' },
    },
  },

  log: {
    fields: {
      loglevel: { doc: 'Уровень логирования', type: 'string', enum: LOG_LEVELS },
      access: { doc: 'Путь к access-логу или "none"', type: 'string' },
      error: { doc: 'Путь к error-логу или "none"', type: 'string' },
      dnsLog: { doc: 'Логировать DNS-запросы', type: 'boolean' },
    },
  },

  dns: {
    fields: {
      servers: { doc: 'DNS-серверы: строка-адрес или объект', type: 'array', itemsNode: 'dnsServer' },
      hosts: { doc: 'Статические записи домен → IP/массив', type: 'object' },
      clientIp: { doc: 'IP клиента для EDNS Client Subnet', type: 'string' },
      queryStrategy: { doc: 'Какие адреса запрашивать', type: 'string', enum: QUERY_STRATEGIES },
      tag: { doc: 'Тег для маршрутизации DNS-трафика', type: 'string' },
      disableCache: { doc: 'Отключить кэш DNS', type: 'boolean' },
      disableFallback: { doc: 'Не опрашивать остальные серверы после совпадения', type: 'boolean' },
      disableFallbackIfMatch: { doc: 'Отключить fallback при совпадении домена', type: 'boolean' },
    },
  },
  dnsServer: {
    fields: {
      address: { doc: 'Адрес DNS-сервера', type: 'string' },
      port: { doc: 'Порт (по умолчанию 53)', type: 'number' },
      domains: { doc: 'Домены, для которых используется этот сервер', type: 'array' },
      expectIPs: { doc: 'Ожидаемые диапазоны IP (geoip)', type: 'array' },
      skipFallback: { doc: 'Пропускать при fallback', type: 'boolean' },
      queryStrategy: { doc: 'Стратегия запросов для этого сервера', type: 'string', enum: QUERY_STRATEGIES },
    },
  },

  inbound: {
    fields: {
      tag: { doc: 'Уникальный тег inbound — на него ссылаются правила и панель', type: 'string' },
      port: { doc: 'Порт прослушивания (число, диапазон «1000-2000» или список)', type: 'number' },
      listen: { doc: 'Адрес прослушивания (0.0.0.0 — все интерфейсы)', type: 'string' },
      protocol: { doc: 'Протокол inbound', type: 'string', enum: INBOUND_PROTOCOLS },
      settings: { doc: 'Настройки протокола', type: 'object', node: inboundSettingsNode },
      streamSettings: { doc: 'Транспорт, TLS/Reality', type: 'object', node: 'streamSettings' },
      sniffing: { doc: 'Определение домена назначения из трафика', type: 'object', node: 'sniffing' },
      allocate: { doc: 'Стратегия выделения портов', type: 'object' },
    },
  },
  vlessInboundSettings: {
    fields: {
      flow: { doc: 'XTLS-flow. Панель применяет ко всем пользователям inbound-а', type: 'string', enum: FLOW },
      decryption: { doc: 'VLESS Encryption: «none» или ключ mlkem768x25519plus…', type: 'string' },
      clients: { doc: 'Пользователи (панель добавляет их сама)', type: 'array', itemsNode: 'vlessClient' },
      fallbacks: { doc: 'Куда уходит не-VLESS трафик (маскировка под сайт)', type: 'array', itemsNode: 'fallback' },
    },
  },
  trojanInboundSettings: {
    fields: {
      clients: { doc: 'Пользователи (панель добавляет их сама)', type: 'array', itemsNode: 'trojanClient' },
      fallbacks: { doc: 'Куда уходит не-Trojan трафик (маскировка под сайт)', type: 'array', itemsNode: 'fallback' },
    },
  },
  ssInboundSettings: {
    fields: {
      method: { doc: 'Метод шифрования', type: 'string', enum: SS_METHODS },
      password: { doc: 'Пароль (для 2022-* — base64-ключ)', type: 'string' },
      network: { doc: 'Принимаемые соединения', type: 'string', enum: SS_NETWORKS },
      clients: { doc: 'Пользователи', type: 'array' },
    },
  },
  hysteriaInboundSettings: {
    fields: {
      version: { doc: 'Версия Hysteria — для Xray-core фиксирована 2', type: 'number' },
      clients: { doc: 'Пользователи', type: 'array', itemsNode: 'hysteriaClient' },
    },
  },
  vlessClient: {
    fields: {
      id: { doc: 'UUID пользователя', type: 'string' },
      email: { doc: 'Идентификатор (используется в логах/статистике)', type: 'string' },
      flow: { doc: 'XTLS-flow пользователя', type: 'string', enum: FLOW },
      level: { doc: 'Уровень политики', type: 'number' },
    },
  },
  trojanClient: {
    fields: {
      password: { doc: 'Пароль пользователя', type: 'string' },
      email: { doc: 'Идентификатор', type: 'string' },
      level: { doc: 'Уровень политики', type: 'number' },
    },
  },
  hysteriaClient: {
    fields: {
      auth: { doc: 'Строка аутентификации', type: 'string' },
      email: { doc: 'Идентификатор', type: 'string' },
      level: { doc: 'Уровень политики', type: 'number' },
    },
  },
  fallback: {
    fields: {
      name: { doc: 'SNI, при котором срабатывает fallback', type: 'string' },
      alpn: { doc: 'ALPN хендшейка, при котором срабатывает fallback', type: 'string' },
      path: { doc: 'Путь (для ws/http за fallback)', type: 'string' },
      dest: { doc: 'Куда переслать: порт, адрес:порт или unix-сокет', type: 'string' },
      xver: { doc: 'PROXY protocol к dest (0/1/2)', type: 'number' },
    },
  },

  streamSettings: {
    fields: {
      network: { doc: 'Транспорт', type: 'string', enum: NETWORKS },
      method: {
        doc: 'Транспорт — новое имя network (Xray ≥26.7.28); при обоих ключах ядро берёт method',
        type: 'string',
        enum: NETWORKS,
      },
      security: { doc: 'Шифрование транспорта', type: 'string', enum: SECURITIES },
      realitySettings: { doc: 'Настройки Reality', type: 'object', node: 'realitySettings' },
      tlsSettings: { doc: 'Настройки TLS', type: 'object', node: 'tlsSettings' },
      tcpSettings: { doc: 'Настройки raw(tcp)', type: 'object', node: 'tcpSettings' },
      rawSettings: { doc: 'Настройки raw (новое имя tcpSettings)', type: 'object', node: 'tcpSettings' },
      wsSettings: { doc: 'Настройки WebSocket', type: 'object', node: 'wsSettings' },
      grpcSettings: { doc: 'Настройки gRPC', type: 'object', node: 'grpcSettings' },
      httpupgradeSettings: { doc: 'Настройки HTTPUpgrade', type: 'object', node: 'httpupgradeSettings' },
      xhttpSettings: { doc: 'Настройки XHTTP', type: 'object', node: 'xhttpSettings' },
      hysteriaSettings: { doc: 'Настройки Hysteria 2', type: 'object', node: 'hysteriaSettings' },
      finalmask: { doc: 'QUIC-параметры (congestion и т.п.)', type: 'object', node: 'finalmask' },
      sockopt: { doc: 'Опции сокета', type: 'object', node: 'sockopt' },
    },
  },
  realitySettings: {
    fields: {
      show: { doc: 'Печатать отладку хендшейка (в проде выкл.)', type: 'boolean' },
      dest: { doc: 'Цель маскировки (устаревшее имя target)', type: 'string' },
      target: { doc: 'Цель маскировки, напр. yahoo.com:443', type: 'string' },
      xver: { doc: 'PROXY protocol к цели', type: 'number' },
      serverNames: { doc: 'Допустимые SNI (сервер)', type: 'array' },
      privateKey: { doc: 'Приватный ключ x25519 (сервер)', type: 'string' },
      publicKey: { doc: 'Публичный ключ (справочно)', type: 'string' },
      shortIds: { doc: 'Список коротких ID (сервер)', type: 'array' },
      fingerprint: { doc: 'uTLS-профиль ClientHello', type: 'string', enum: FINGERPRINTS },
      spiderX: { doc: 'Путь имитации краулера (клиент)', type: 'string' },
      serverName: { doc: 'SNI (клиент) — одно из serverNames сервера', type: 'string' },
      shortId: { doc: 'Короткий ID (клиент)', type: 'string' },
      password: { doc: 'Публичный ключ сервера (pbk) — в свежих ядрах поле password', type: 'string' },
    },
  },
  tlsSettings: {
    fields: {
      serverName: { doc: 'SNI', type: 'string' },
      rejectUnknownSni: { doc: 'Разрывать соединения с SNI вне certificates', type: 'boolean' },
      alpn: { doc: 'Список ALPN', type: 'array', enum: ALPN },
      certificates: { doc: 'Сертификаты (файлы или inline-PEM)', type: 'array', itemsNode: 'certificate' },
      minVersion: { doc: 'Минимальная версия TLS', type: 'string', enum: TLS_VERSIONS },
      maxVersion: { doc: 'Максимальная версия TLS', type: 'string', enum: TLS_VERSIONS },
      fingerprint: { doc: 'uTLS-профиль (клиент)', type: 'string', enum: FINGERPRINTS },
    },
  },
  certificate: {
    fields: {
      certificateFile: { doc: 'Путь к файлу сертификата', type: 'string' },
      keyFile: { doc: 'Путь к файлу ключа', type: 'string' },
      certificate: { doc: 'Сертификат построчно (inline PEM)', type: 'array' },
      key: { doc: 'Ключ построчно (inline PEM)', type: 'array' },
      usage: { doc: 'Назначение сертификата', type: 'string', enum: CERT_USAGES },
    },
  },
  tcpSettings: {
    fields: {
      acceptProxyProtocol: { doc: 'Принимать PROXY protocol от реверс-прокси', type: 'boolean' },
      header: { doc: 'Маскировка заголовка (например http)', type: 'object' },
    },
  },
  wsSettings: {
    fields: {
      path: { doc: 'Путь WebSocket', type: 'string' },
      host: { doc: 'Заголовок Host (за CDN — домен фронта)', type: 'string' },
      headers: { doc: 'Дополнительные HTTP-заголовки', type: 'object' },
      heartbeatPeriod: { doc: 'Период heartbeat, сек', type: 'number' },
      acceptProxyProtocol: { doc: 'Принимать PROXY protocol', type: 'boolean' },
    },
  },
  grpcSettings: {
    fields: {
      serviceName: { doc: 'Имя gRPC-сервиса', type: 'string' },
      authority: { doc: 'Псевдозаголовок :authority (домен за CDN)', type: 'string' },
      multiMode: { doc: 'Несколько потоков в одном соединении (эксперим.)', type: 'boolean' },
    },
  },
  httpupgradeSettings: {
    fields: {
      path: { doc: 'Путь HTTPUpgrade', type: 'string' },
      host: { doc: 'Заголовок Host', type: 'string' },
      headers: { doc: 'Дополнительные HTTP-заголовки', type: 'object' },
      acceptProxyProtocol: { doc: 'Принимать PROXY protocol', type: 'boolean' },
    },
  },
  xhttpSettings: {
    fields: {
      path: { doc: 'Путь XHTTP', type: 'string' },
      host: { doc: 'Домен CDN-фронта', type: 'string' },
      mode: { doc: 'Режим передачи', type: 'string', enum: XHTTP_MODES },
      extra: { doc: 'Доп. параметры (xmux, padding)', type: 'object' },
    },
  },
  hysteriaSettings: {
    fields: {
      version: { doc: 'Версия (фиксирована 2)', type: 'number' },
      auth: { doc: 'Строка аутентификации', type: 'string' },
      up: { doc: 'Скорость вверх, напр. 100mbps', type: 'string' },
      down: { doc: 'Скорость вниз, напр. 300mbps', type: 'string' },
      udpIdleTimeout: { doc: 'Таймаут простоя UDP', type: 'number' },
      masquerade: { doc: 'Маскировка под реальный сайт', type: 'object', node: 'masquerade' },
    },
  },
  masquerade: {
    fields: {
      type: { doc: 'Тип маскировки', type: 'string', enum: [{ value: 'file', doc: 'Отдавать сайт из каталога' }] },
      dir: { doc: 'Каталог сайта (для type=file)', type: 'string' },
    },
  },
  finalmask: {
    fields: {
      quicParams: { doc: 'Параметры QUIC', type: 'object', node: 'quicParams' },
    },
  },
  quicParams: {
    fields: {
      congestion: { doc: 'Контроль перегрузки', type: 'string', enum: CONGESTIONS },
      brutalUp: { doc: 'Полоса вверх для brutal, Мбит/с', type: 'number' },
      brutalDown: { doc: 'Полоса вниз для brutal, Мбит/с', type: 'number' },
    },
  },
  sockopt: {
    fields: {
      mark: { doc: 'SO_MARK для маршрутизации на хосте', type: 'number' },
      tcpFastOpen: { doc: 'TCP Fast Open (true/false или длина очереди)', type: 'boolean' },
      tproxy: { doc: 'Прозрачный прокси', type: 'string', enum: en(['redirect', 'tproxy', 'off']) },
      domainStrategy: { doc: 'Как резолвить домен на уровне сокета', type: 'string', enum: SOCKOPT_DOMAIN_STRATEGIES },
      dialerProxy: { doc: 'Проксировать исходящие через outbound с этим тегом (цепочка)', type: 'string' },
      acceptProxyProtocol: { doc: 'Принимать PROXY protocol', type: 'boolean' },
      interface: { doc: 'Привязка к сетевому интерфейсу', type: 'string' },
      tcpMptcp: { doc: 'Multipath TCP', type: 'boolean' },
    },
  },
  sniffing: {
    fields: {
      enabled: { doc: 'Включить сниффинг', type: 'boolean' },
      destOverride: { doc: 'Определяемые протоколы (адрес назначения подменяется доменом)', type: 'array', enum: DEST_OVERRIDE },
      routeOnly: { doc: 'Домен только для правил, адрес не подменяется', type: 'boolean' },
      metadataOnly: { doc: 'Сниффинг без чтения содержимого', type: 'boolean' },
    },
  },

  outbound: {
    fields: {
      tag: { doc: 'Уникальный тег outbound — на него ссылаются правила', type: 'string' },
      protocol: { doc: 'Протокол outbound', type: 'string', enum: OUTBOUND_PROTOCOLS },
      settings: { doc: 'Настройки протокола', type: 'object', node: outboundSettingsNode },
      streamSettings: { doc: 'Транспорт, TLS/Reality (кроме wireguard/blackhole)', type: 'object', node: 'streamSettings' },
      proxySettings: { doc: 'Настройки проксирования через другой outbound', type: 'object' },
      sendThrough: { doc: 'Исходящий IP-адрес', type: 'string' },
      mux: { doc: 'Мультиплексирование соединений', type: 'object', node: 'mux' },
    },
  },
  freedomOutboundSettings: {
    fields: {
      domainStrategy: { doc: 'Как резолвить домены', type: 'string', enum: FREEDOM_DOMAIN_STRATEGIES },
      redirect: { doc: 'Принудительно слать на адрес:порт', type: 'string' },
      fragment: { doc: 'Фрагментация TLS-хендшейка', type: 'object', node: 'freedomFragment' },
      proxyProtocol: { doc: 'Слать PROXY protocol (0/1/2)', type: 'number' },
    },
  },
  freedomFragment: {
    fields: {
      packets: { doc: 'Какие пакеты фрагментировать, напр. tlshello', type: 'string' },
      length: { doc: 'Диапазон длины фрагмента, напр. 100-200', type: 'string' },
      interval: { doc: 'Интервал между фрагментами, мс', type: 'string' },
    },
  },
  blackholeOutboundSettings: {
    fields: {
      response: { doc: 'Тип ответа при блокировке', type: 'object', node: 'blackholeResponse' },
    },
  },
  blackholeResponse: {
    fields: {
      type: { doc: 'Как отвечать заблокированному соединению', type: 'string', enum: BLACKHOLE_RESPONSES },
    },
  },
  wireguardOutboundSettings: {
    fields: {
      secretKey: { doc: 'Приватный ключ WireGuard', type: 'string' },
      address: { doc: 'Локальные адреса интерфейса', type: 'array' },
      peers: { doc: 'Пиры WireGuard', type: 'array', itemsNode: 'wgPeer' },
      mtu: { doc: 'MTU (обычно 1420)', type: 'number' },
      reserved: { doc: 'Reserved-байты (для WARP)', type: 'array' },
      workers: { doc: 'Число воркеров', type: 'number' },
      domainStrategy: { doc: 'Стратегия резолвинга доменов', type: 'string', enum: WG_DOMAIN_STRATEGIES },
      noKernelTun: { doc: 'Не использовать kernel TUN', type: 'boolean' },
    },
  },
  wgPeer: {
    fields: {
      publicKey: { doc: 'Публичный ключ пира', type: 'string' },
      endpoint: { doc: 'Адрес:порт пира', type: 'string' },
      allowedIPs: { doc: 'Разрешённые подсети', type: 'array' },
      preSharedKey: { doc: 'Пре-шаренный ключ', type: 'string' },
      keepAlive: { doc: 'Keepalive, сек', type: 'number' },
    },
  },
  vlessOutboundSettings: {
    fields: {
      vnext: { doc: 'Серверы назначения (классическая форма)', type: 'array', itemsNode: 'vlessVnext' },
      address: { doc: 'Адрес сервера (плоская форма)', type: 'string' },
      port: { doc: 'Порт сервера (плоская форма)', type: 'number' },
      id: { doc: 'UUID пользователя (плоская форма)', type: 'string' },
      flow: { doc: 'Flow (плоская форма)', type: 'string', enum: FLOW },
      encryption: { doc: 'Шифрование VLESS: none либо строка mlkem768x25519plus…', type: 'string' },
      seed: { doc: 'Seed для VLESS Seed', type: 'string' },
    },
  },
  trojanOutboundSettings: {
    fields: {
      servers: { doc: 'Серверы назначения (классическая форма)', type: 'array', itemsNode: 'trojanServer' },
      address: { doc: 'Адрес сервера (плоская форма)', type: 'string' },
      port: { doc: 'Порт сервера (плоская форма)', type: 'number' },
      password: { doc: 'Пароль (плоская форма)', type: 'string' },
      flow: { doc: 'Flow', type: 'string', enum: FLOW },
    },
  },
  trojanServer: {
    fields: {
      address: { doc: 'Адрес сервера', type: 'string' },
      port: { doc: 'Порт сервера', type: 'number' },
      password: { doc: 'Пароль', type: 'string' },
      email: { doc: 'Идентификатор', type: 'string' },
      flow: { doc: 'Flow', type: 'string', enum: FLOW },
    },
  },
  vlessVnext: {
    fields: {
      address: { doc: 'Адрес сервера', type: 'string' },
      port: { doc: 'Порт сервера', type: 'number' },
      users: { doc: 'Пользователи', type: 'array', itemsNode: 'vlessOutboundUser' },
    },
  },
  vlessOutboundUser: {
    fields: {
      id: { doc: 'UUID', type: 'string' },
      flow: { doc: 'XTLS-flow', type: 'string', enum: FLOW },
      encryption: { doc: 'Обычно «none»', type: 'string' },
      level: { doc: 'Уровень политики', type: 'number' },
    },
  },
  proxyOutboundSettings: {
    fields: {
      servers: { doc: 'Внешние прокси-серверы', type: 'array', itemsNode: 'proxyServer' },
    },
  },
  proxyServer: {
    fields: {
      address: { doc: 'Адрес прокси', type: 'string' },
      port: { doc: 'Порт прокси', type: 'number' },
      users: { doc: 'Учётные данные', type: 'array', itemsNode: 'proxyUser' },
    },
  },
  proxyUser: {
    fields: {
      user: { doc: 'Логин', type: 'string' },
      pass: { doc: 'Пароль', type: 'string' },
      level: { doc: 'Уровень политики', type: 'number' },
    },
  },
  mux: {
    fields: {
      enabled: { doc: 'Включить mux', type: 'boolean' },
      concurrency: { doc: 'Число подсоединений в одном соединении', type: 'number' },
      xudpConcurrency: { doc: 'Concurrency для XUDP', type: 'number' },
      xudpProxyUDP443: { doc: 'Как обрабатывать UDP/443', type: 'string', enum: XUDP_MODES },
    },
  },

  routing: {
    fields: {
      domainStrategy: { doc: 'Когда резолвить домены в IP', type: 'string', enum: ROUTING_DOMAIN_STRATEGIES },
      domainMatcher: { doc: 'Алгоритм матчинга доменов', type: 'string', enum: ROUTING_DOMAIN_MATCHERS },
      rules: { doc: 'Правила маршрутизации (сверху вниз)', type: 'array', itemsNode: 'rule' },
      balancers: { doc: 'Балансировщики outbound-ов', type: 'array', itemsNode: 'balancer' },
    },
  },
  rule: {
    fields: {
      type: { doc: 'Тип правила — всегда «field»', type: 'string', enum: en(['field']) },
      inboundTag: { doc: 'Теги inbound, к которым применяется', type: 'array' },
      outboundTag: { doc: 'Тег outbound назначения', type: 'string' },
      balancerTag: { doc: 'Тег балансировщика (вместо outboundTag)', type: 'string' },
      domain: { doc: 'Домены (префиксы domain:/full:/regexp:/geosite:/keyword:)', type: 'array' },
      ip: { doc: 'IP/CIDR или geoip:*', type: 'array' },
      port: { doc: 'Порт назначения: 443, 1000-2000 или список', type: 'string' },
      sourcePort: { doc: 'Порт источника', type: 'string' },
      network: { doc: 'Тип соединения', type: 'string', enum: RULE_NETWORKS },
      protocol: { doc: 'Определённый сниффингом протокол', type: 'array', enum: RULE_PROTOCOLS },
      user: { doc: 'Пользователи (email)', type: 'array' },
      source: { doc: 'IP/CIDR источника', type: 'array' },
      attrs: { doc: 'Атрибуты трафика (например http-заголовки)', type: 'object' },
      ruleTag: { doc: 'Тег правила (для API/логов)', type: 'string' },
    },
  },
  balancer: {
    fields: {
      tag: { doc: 'Тег балансера — на него ссылается balancerTag правила', type: 'string' },
      selector: {
        doc: 'ПРЕФИКСЫ тегов outbound-ов: «proxy-» захватит proxy-de и proxy-nl',
        type: 'array',
      },
      fallbackTag: { doc: 'Выход, когда все кандидаты недоступны', type: 'string' },
      strategy: { doc: 'Как выбирать выход', type: 'object', node: 'balancerStrategy' },
    },
  },
  balancerStrategy: {
    fields: {
      type: {
        doc: 'Стратегия выбора',
        type: 'string',
        enum: [
          { value: 'random', doc: 'Случайный выход' },
          { value: 'roundRobin', doc: 'По кругу' },
          { value: 'leastPing', doc: 'Самый быстрый; нужна секция observatory' },
          { value: 'leastLoad', doc: 'Наименее загруженный; нужна секция burstObservatory' },
        ],
      },
      settings: {
        doc: 'Тонкая настройка leastLoad: expected, maxRTT, tolerance, baselines, costs',
        type: 'object',
      },
    },
  },
  observatory: {
    fields: {
      subjectSelector: { doc: 'ПРЕФИКСЫ тегов наблюдаемых outbound-ов', type: 'array' },
      probeUrl: { doc: 'URL пробы; должен отвечать 204', type: 'string' },
      probeInterval: { doc: 'Интервал проб: 10s, 1m', type: 'string' },
      enableConcurrency: { doc: 'Мерить выходы параллельно', type: 'boolean' },
    },
  },
  burstObservatory: {
    fields: {
      subjectSelector: { doc: 'ПРЕФИКСЫ тегов наблюдаемых outbound-ов', type: 'array' },
      pingConfig: { doc: 'Параметры замеров', type: 'object', node: 'pingConfig' },
    },
  },
  pingConfig: {
    fields: {
      destination: { doc: 'Адрес проверки; должен отвечать HTTP 204', type: 'string' },
      connectivity: {
        doc: 'Адрес проверки локальной сети (только если основная проба упала)',
        type: 'string',
      },
      interval: { doc: 'Средний интервал между проверками, минимум 10s', type: 'string' },
      sampling: { doc: 'Сколько последних результатов хранить', type: 'number' },
      timeout: { doc: 'Таймаут запроса проверки', type: 'string' },
      httpMethod: { doc: 'Метод запроса проверки (HEAD, GET)', type: 'string' },
    },
  },
}

/** Поля узла с учётом условных (extra) полей по скалярам объекта */
export function nodeFields(nodeName: string | undefined, props: Props = {}): Record<string, DocField> {
  if (!nodeName) return {}
  const node = NODES[nodeName]
  if (!node) return {}
  return node.extra ? { ...node.fields, ...node.extra(props) } : node.fields
}

/** Имя узла, в который ведёт ключ (для спуска по дереву). props — скаляры объекта-владельца */
export function descend(nodeName: string | undefined, key: string, props: Props = {}): string | undefined {
  const field = nodeFields(nodeName, props)[key]
  if (!field) return undefined
  const target = field.node ?? field.itemsNode
  return typeof target === 'function' ? target(props) : target
}
