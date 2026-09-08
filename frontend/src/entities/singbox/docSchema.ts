// Декларативное описание документа sing-box: какие ключи бывают в каждой
// секции, какого они вида и что значат по-русски. Один словарь питает и формы
// инспектора, и подсказки JSON-вкладки.
//
// Целевая версия ядра — 1.13.x. Словарь ОПИСЫВАЕТ, а не ограничивает:
// незнакомый ключ проходит в документ и не считается ошибкой (см. parse.ts).
// Молчание там, где сказать нечего, — осознанный выбор: выдуманное описание
// читается как знание.
//
// Источники: sing-box.sagernet.org (разделы configuration/*), генератор панели
// (remnawave/backend, singbox.generator.service.ts) — для ключа remnawave,
// и три фикстуры в frontend/test/fixtures/singbox/.

export interface SingboxEnum {
  value: string
  doc?: string
}

export interface SingboxField {
  /** Ключ или путь через точку внутри секции */
  key: string
  /** Русское описание: подпись в форме и tooltip подсказки */
  doc: string
  type: 'string' | 'number' | 'boolean' | 'strings' | 'object' | 'array'
  /** Известные значения — подсказка, а не ограничение */
  enum?: SingboxEnum[]
  /** Ключ панели, а не ядра: в отданном клиенту конфиге его не будет */
  panelKey?: boolean
}

export type SingboxSectionName =
  | 'root'
  | 'inbound'
  | 'outbound'
  | 'group'
  | 'route'
  | 'route-rule'
  | 'rule-set'
  | 'dns'
  | 'dns-server'
  | 'experimental'

export const SINGBOX_SECTIONS: Record<SingboxSectionName, SingboxField[]> = {
  root: [
    { key: 'log', doc: 'Журнал ядра: уровень и вывод.', type: 'object' },
    { key: 'dns', doc: 'Разрешение имён: свои серверы и свои правила, отдельные от маршрута.', type: 'object' },
    { key: 'inbounds', doc: 'Входы клиента: чем ядро принимает трафик системы.', type: 'array' },
    { key: 'outbounds', doc: 'Выходы: серверы, группы выбора и прямой выход. Серверы подписки панель дописывает в КОНЕЦ этого списка.', type: 'array' },
    { key: 'endpoints', doc: 'Конечные точки WireGuard и Tailscale (ядро 1.11 и новее).', type: 'array' },
    { key: 'route', doc: 'Маршрутизация: правила, наборы правил и выход по умолчанию.', type: 'object' },
    { key: 'experimental', doc: 'Экспериментальные разделы: Clash API и файл кэша.', type: 'object' },
    { key: 'http_clients', doc: 'Именованные HTTP-клиенты: через них ядро скачивает наборы правил.', type: 'array' },
    { key: 'ntp', doc: 'Синхронизация времени: нужна там, где системные часы врут, а TLS этого не прощает.', type: 'object' },
    { key: 'certificate', doc: 'Хранилище доверенных сертификатов.', type: 'object' },
    { key: 'services', doc: 'Встроенные службы ядра (например, DERP).', type: 'array' },
  ],
  outbound: [
    { key: 'type', doc: 'Тип выхода: протокол сервера, группа выбора или прямой выход.', type: 'string', enum: [
      { value: 'direct', doc: 'Прямое соединение, минуя прокси.' },
      { value: 'selector', doc: 'Группа с ручным выбором. Панель заменит её список тегами серверов подписки.' },
      { value: 'urltest', doc: 'Группа с автовыбором по задержке. Панель заменит её список тегами серверов подписки.' },
      { value: 'vless', doc: 'Сервер VLESS.' },
      { value: 'trojan', doc: 'Сервер Trojan.' },
      { value: 'shadowsocks', doc: 'Сервер Shadowsocks.' },
      { value: 'hysteria2', doc: 'Сервер Hysteria2.' },
      { value: 'vmess', doc: 'Сервер VMess. Панель такие серверы в группы не добавляет.' },
      { value: 'socks', doc: 'Прокси SOCKS. Панель такие серверы в группы не добавляет.' },
      { value: 'http', doc: 'Прокси HTTP. Панель такие серверы в группы не добавляет.' },
      { value: 'block', doc: 'Устаревший выход-заглушка: ядро 1.13 его не знает, вместо него action: reject.' },
      { value: 'dns', doc: 'Устаревший выход для DNS: ядро 1.13 его не знает, вместо него action: hijack-dns.' },
    ] },
    { key: 'tag', doc: 'Имя выхода. По нему на выход ссылаются правила и группы.', type: 'string' },
    { key: 'server', doc: 'Адрес сервера.', type: 'string' },
    { key: 'server_port', doc: 'Порт сервера.', type: 'number' },
    { key: 'detour', doc: 'Через какой выход устанавливать это соединение — цепочка прокси.', type: 'string' },
  ],
  group: [
    { key: 'outbounds', doc: 'Список выходов группы. Панель заменит его целиком: у urltest — тегами серверов, у selector — серверами и группами urltest. Чтобы список остался вашим, поставьте remnawave.includeProxies = false.', type: 'strings' },
    { key: 'default', doc: 'Выход, выбранный в группе изначально.', type: 'string' },
    { key: 'url', doc: 'Адрес для замера задержки в группе urltest.', type: 'string' },
    { key: 'interval', doc: 'Период повторного замера задержки, например 3m.', type: 'string' },
    { key: 'tolerance', doc: 'На сколько миллисекунд новый выход должен быть быстрее, чтобы группа переключилась.', type: 'number' },
    { key: 'interrupt_exist_connections', doc: 'Разрывать ли текущие соединения при смене выбранного выхода.', type: 'boolean' },
    { key: 'remnawave.includeProxies', doc: 'Ключ панели: false — не заполнять список этой группы серверами подписки. В конфиге, который получит клиент, ключа не будет.', type: 'boolean', panelKey: true },
  ],
  'route-rule': [
    { key: 'action', doc: 'Что сделать с соединением. Без этого поля правило считается маршрутным.', type: 'string', enum: [
      { value: 'route', doc: 'Отправить в выход из поля outbound.' },
      { value: 'reject', doc: 'Отклонить соединение.' },
      { value: 'hijack-dns', doc: 'Перехватить DNS-запрос во внутренний резолвер.' },
      { value: 'sniff', doc: 'Определить протокол соединения. Подбор правил продолжается.' },
      { value: 'resolve', doc: 'Разрешить домен в адреса. Подбор правил продолжается.' },
      { value: 'route-options', doc: 'Изменить параметры маршрута. Подбор правил продолжается.' },
    ] },
    { key: 'outbound', doc: 'Тег выхода, в который уйдёт совпавшее соединение.', type: 'string' },
    { key: 'domain', doc: 'Полное совпадение домена.', type: 'strings' },
    { key: 'domain_suffix', doc: 'Суффикс домена. Без ведущей точки совпадает и сам домен, и его поддомены; с ведущей точкой — только поддомены.', type: 'strings' },
    { key: 'domain_keyword', doc: 'Подстрока в домене.', type: 'strings' },
    { key: 'domain_regex', doc: 'Регулярное выражение по домену.', type: 'strings' },
    { key: 'ip_cidr', doc: 'Подсеть адреса назначения.', type: 'strings' },
    { key: 'ip_is_private', doc: 'Адрес назначения принадлежит частному диапазону.', type: 'boolean' },
    { key: 'port', doc: 'Порт назначения.', type: 'strings' },
    { key: 'port_range', doc: 'Диапазон портов назначения, например 1000:2000.', type: 'strings' },
    { key: 'protocol', doc: 'Протокол, определённый сниффингом. Редактор его предсказать не может.', type: 'strings' },
    { key: 'network', doc: 'Транспорт: tcp или udp.', type: 'strings', enum: [{ value: 'tcp' }, { value: 'udp' }] },
    { key: 'clash_mode', doc: 'Режим, выбранный в клиенте через Clash API. Документом не задаётся.', type: 'string' },
    { key: 'rule_set', doc: 'Теги наборов правил. Содержимое набора лежит по ссылке, редактор его не скачивает.', type: 'strings' },
    { key: 'inbound', doc: 'Теги входов, с которых пришло соединение.', type: 'strings' },
    { key: 'invert', doc: 'Обратить результат проверки условий.', type: 'boolean' },
    { key: 'type', doc: 'logical — правило объединяет вложенные правила по «и» либо «или».', type: 'string', enum: [{ value: 'logical' }] },
    { key: 'mode', doc: 'Для логического правила: and — все вложенные, or — хотя бы одно.', type: 'string', enum: [{ value: 'and' }, { value: 'or' }] },
    { key: 'rules', doc: 'Вложенные правила логического правила.', type: 'array' },
  ],
  route: [
    { key: 'rules', doc: 'Правила маршрутизации по порядку: выигрывает первое совпавшее.', type: 'array' },
    { key: 'rule_set', doc: 'Наборы правил: локальные файлы или удалённые .srs по ссылке.', type: 'array' },
    { key: 'final', doc: 'Выход для трафика, не совпавшего ни с одним правилом. Если поле пусто, ядро возьмёт ПЕРВЫЙ выход из outbounds.', type: 'string' },
    { key: 'auto_detect_interface', doc: 'Определять исходящий интерфейс автоматически.', type: 'boolean' },
    { key: 'default_domain_resolver', doc: 'Каким DNS-сервером разрешать домены при исходящих соединениях.', type: 'object' },
    { key: 'default_http_client', doc: 'Каким HTTP-клиентом скачивать удалённые наборы правил.', type: 'string' },
    { key: 'override_android_vpn', doc: 'Перехватывать ли трафик другого VPN на Android.', type: 'boolean' },
    { key: 'default_mark', doc: 'Метка исходящих соединений в Linux.', type: 'number' },
  ],
  'rule-set': [
    { key: 'tag', doc: 'Имя набора: по нему на набор ссылаются правила.', type: 'string' },
    { key: 'type', doc: 'Откуда берётся набор.', type: 'string', enum: [
      { value: 'remote', doc: 'Скачивается по ссылке.' },
      { value: 'local', doc: 'Читается из файла на устройстве.' },
      { value: 'inline', doc: 'Записан прямо в конфиге.' },
    ] },
    { key: 'format', doc: 'Формат набора: binary (.srs) или source (.json).', type: 'string', enum: [{ value: 'binary' }, { value: 'source' }] },
    { key: 'url', doc: 'Ссылка на удалённый набор.', type: 'string' },
    { key: 'path', doc: 'Путь к локальному файлу набора.', type: 'string' },
    { key: 'download_detour', doc: 'Через какой выход скачивать набор.', type: 'string' },
    { key: 'update_interval', doc: 'Как часто обновлять набор, например 1d.', type: 'string' },
  ],
  inbound: [
    { key: 'type', doc: 'Тип входа.', type: 'string', enum: [
      { value: 'tun', doc: 'Виртуальный сетевой интерфейс: забирает весь трафик системы.' },
      { value: 'mixed', doc: 'Локальный прокси HTTP и SOCKS на одном порту.' },
      { value: 'socks', doc: 'Локальный прокси SOCKS.' },
      { value: 'http', doc: 'Локальный прокси HTTP.' },
    ] },
    { key: 'tag', doc: 'Имя входа: на него ссылается условие inbound в правилах.', type: 'string' },
    { key: 'listen', doc: 'Адрес, который слушает вход.', type: 'string' },
    { key: 'listen_port', doc: 'Порт, который слушает вход.', type: 'number' },
    { key: 'address', doc: 'Адреса виртуального интерфейса tun.', type: 'strings' },
    { key: 'auto_route', doc: 'Прописывать системные маршруты в интерфейс tun.', type: 'boolean' },
    { key: 'strict_route', doc: 'Строгая маршрутизация: закрывает пути в обход туннеля.', type: 'boolean' },
    { key: 'stack', doc: 'Сетевой стек интерфейса tun.', type: 'string', enum: [{ value: 'system' }, { value: 'gvisor' }, { value: 'mixed' }] },
    { key: 'mtu', doc: 'Размер MTU интерфейса tun.', type: 'number' },
    { key: 'set_system_proxy', doc: 'Прописывать этот вход системным прокси.', type: 'boolean' },
    { key: 'interface_name', doc: 'Имя создаваемого интерфейса tun.', type: 'string' },
  ],
  dns: [
    { key: 'servers', doc: 'DNS-серверы: у каждого свой тег, тип и адрес.', type: 'array' },
    { key: 'rules', doc: 'Правила DNS: какой запрос каким сервером разрешать. Считаются отдельно от правил маршрута.', type: 'array' },
    { key: 'final', doc: 'Сервер для запросов, не совпавших ни с одним правилом DNS.', type: 'string' },
    { key: 'strategy', doc: 'Какие адреса запрашивать по умолчанию.', type: 'string', enum: [
      { value: 'prefer_ipv4' }, { value: 'prefer_ipv6' }, { value: 'ipv4_only' }, { value: 'ipv6_only' },
    ] },
    { key: 'independent_cache', doc: 'Держать отдельный кэш для каждого сервера.', type: 'boolean' },
    { key: 'reverse_mapping', doc: 'Запоминать соответствие адреса и домена для обратного поиска.', type: 'boolean' },
  ],
  'dns-server': [
    { key: 'tag', doc: 'Имя сервера: по нему на него ссылаются правила DNS.', type: 'string' },
    { key: 'type', doc: 'Транспорт запроса.', type: 'string', enum: [
      { value: 'local', doc: 'Системный резолвер устройства.' },
      { value: 'udp' }, { value: 'tcp' }, { value: 'tls' }, { value: 'https' }, { value: 'quic' }, { value: 'h3' },
      { value: 'fakeip', doc: 'Выдаёт подставные адреса из заданного диапазона.' },
    ] },
    { key: 'server', doc: 'Адрес DNS-сервера.', type: 'string' },
    { key: 'detour', doc: 'Через какой выход отправлять запросы этого сервера.', type: 'string' },
    { key: 'inet4_range', doc: 'Диапазон подставных адресов IPv4 для fakeip.', type: 'string' },
    { key: 'inet6_range', doc: 'Диапазон подставных адресов IPv6 для fakeip.', type: 'string' },
  ],
  experimental: [
    { key: 'clash_api', doc: 'Внешний интерфейс управления: порт, панель и режим по умолчанию.', type: 'object' },
    { key: 'cache_file', doc: 'Файл кэша: адреса fakeip и выбранные в группах выходы переживают перезапуск.', type: 'object' },
  ],
}

export function fieldFor(section: SingboxSectionName, key: string): SingboxField | undefined {
  return SINGBOX_SECTIONS[section].find((field) => field.key === key)
}
