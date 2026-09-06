// Декларативное описание полей шаблона Mihomo: какие ключи допустимы в каждой
// секции, какие у них значения и что они значат по-русски. Один словарь питает
// и формы инспектора, и подсказки YAML-вкладки.
//
// В редакторе Xray словарь (entities/xray/docSchema.ts) намеренно отделён от
// форм: там формы правят вложенные структуры, а подсказки идут по сырому тексту
// всего конфига. Здесь наоборот — почти каждое поле формы Mihomo есть плоская
// пара «ключ → скаляр» в отображении, и два описания одного и того же
// разъехались бы на первом же добавленном ключе.
//
// Составные ключи вида `remnawave.include-proxies` и `override.dialer-proxy` —
// это путь через вложенное отображение, а не имя ключа с точкой. Разбирает их
// вызывающий (setFieldAt в edits.ts, задача 6).
//
// Источники: официальная документация ядра (wiki.metacubex.one, разделы
// proxy-groups/proxy-providers/rule-providers/dns/general, а также английское
// зеркало en/config/inbound/tun и en/config/sniff), руководство панели
// docs/guides/templates/mihomo.md (таблица remnawave.*/override.* — см.
// docs/superpowers/specs/2026-09-05-mihomo-templates-design.md) и три эталонных
// шаблона в frontend/test/fixtures/mihomo/. Подробности — в отчёте задачи 5.

export interface MihomoEnum {
  value: string
  doc?: string
}

export interface MihomoField {
  /** Ключ или путь через точку внутри секции */
  key: string
  /** Русское описание: подпись-подсказка в форме и tooltip подсказки в тексте */
  doc: string
  /**
   * `'map'` — значение само является вложенным отображением (`nameserver-policy`,
   * `sniff` и подобные), а не скаляром или списком строк. Форма инспектора обязана
   * рендерить такое поле read-only с подписью «правится на вкладке YAML» — текстовый
   * инпут поверх отображения при сохранении заменил бы его скаляром и испортил
   * документ. Подсказки и описание ключа при этом работают как обычно.
   */
  type: 'string' | 'number' | 'boolean' | 'strings' | 'map'
  /**
   * Известные значения. Это ПОДСКАЗКА, а не ограничение: значение остаётся
   * строкой, и незнакомое значение чужого шаблона проходит насквозь — тот же
   * приём, что у `type` группы в groups.ts.
   */
  enum?: MihomoEnum[]
}

export type MihomoSectionName =
  | 'root'
  | 'proxy-group'
  | 'proxy-provider'
  | 'rule-provider'
  | 'dns'
  | 'tun'
  | 'sniffer'
  | 'profile'

export interface MihomoSection {
  name: MihomoSectionName
  /** Заголовок карточки инспектора */
  title: string
  fields: MihomoField[]
}

const GROUP_TYPES: MihomoEnum[] = [
  { value: 'select', doc: 'Выбор вручную из списка участников' },
  { value: 'url-test', doc: 'Автовыбор самого быстрого по проверке url' },
  { value: 'fallback', doc: 'Первый живой по порядку списка' },
  { value: 'load-balance', doc: 'Распределение соединений между участниками' },
  { value: 'relay', doc: 'Цепочка: трафик идёт через участников по очереди' },
]

const PROXY_GROUP_FIELDS: MihomoField[] = [
  { key: 'name', doc: 'Имя группы. На него ссылаются правила и другие группы.', type: 'string' },
  { key: 'type', doc: 'Как группа выбирает участника.', type: 'string', enum: GROUP_TYPES },
  { key: 'proxies', doc: 'Участники, перечисленные вручную: имена хостов, групп и встроенных целей.', type: 'strings' },
  { key: 'use', doc: 'Имена провайдеров (proxy-providers), чьи прокси входят в группу.', type: 'strings' },
  { key: 'include-all', doc: 'Взять все прокси и всех провайдеров сразу.', type: 'boolean' },
  { key: 'include-all-proxies', doc: 'Взять все прокси из корневого proxies.', type: 'boolean' },
  { key: 'include-all-providers', doc: 'Взять прокси всех объявленных провайдеров.', type: 'boolean' },
  { key: 'filter', doc: 'Регулярное выражение: в группу попадут только подходящие ИМЕНА ХОСТОВ.', type: 'string' },
  { key: 'exclude-filter', doc: 'Регулярное выражение: подходящие имена хостов из группы исключаются.', type: 'string' },
  { key: 'exclude-type', doc: 'Типы прокси, которые в группу не берутся, через |.', type: 'string' },
  { key: 'url', doc: 'Адрес проверки живости для url-test и fallback.', type: 'string' },
  { key: 'interval', doc: 'Период проверки живости в секундах.', type: 'number' },
  { key: 'lazy', doc: 'Не проверять, пока группа не используется.', type: 'boolean' },
  { key: 'tolerance', doc: 'Насколько миллисекунд новый лидер должен обгонять текущего, чтобы его сменить.', type: 'number' },
  { key: 'timeout', doc: 'Таймаут проверки живости в миллисекундах.', type: 'number' },
  { key: 'max-failed-times', doc: 'Сколько неудач подряд переводят участника в недоступные.', type: 'number' },
  { key: 'expected-status', doc: 'Коды ответа, считающиеся успехом проверки (например 204 или 200/204).', type: 'string' },
  { key: 'strategy', doc: 'Способ распределения у load-balance.', type: 'string', enum: [
    { value: 'consistent-hashing', doc: 'Один и тот же адрес всегда идёт через одного участника' },
    { value: 'round-robin', doc: 'По очереди' },
    { value: 'sticky-sessions', doc: 'Сессия закрепляется за участником' },
  ] },
  { key: 'disable-udp', doc: 'Не пускать через группу UDP.', type: 'boolean' },
  { key: 'hidden', doc: 'Не показывать группу в клиенте.', type: 'boolean' },
  { key: 'icon', doc: 'Адрес иконки группы для клиента.', type: 'string' },
  { key: 'default-selected', doc: 'Участник, выбранный по умолчанию у select.', type: 'string' },
  { key: 'empty-fallback', doc: 'Что делать, если участников не осталось.', type: 'string' },
  {
    key: 'remnawave.include-proxies',
    doc: 'Ключ панели. У ГРУППЫ значение false отменяет подстановку хостов: в группе останутся только перечисленные вручную. Значение true допустимо только у провайдера.',
    type: 'boolean',
  },
  {
    key: 'remnawave.select-random-proxy',
    doc: 'Ключ панели: положить в группу один случайный хост.',
    type: 'boolean',
  },
  {
    key: 'remnawave.shuffle-proxies-order',
    doc: 'Ключ панели: положить все хосты в случайном порядке.',
    type: 'boolean',
  },
]

const PROXY_PROVIDER_FIELDS: MihomoField[] = [
  { key: 'type', doc: 'Откуда брать список прокси.', type: 'string', enum: [
    { value: 'http', doc: 'Скачать по url' },
    { value: 'file', doc: 'Взять из локального файла (path)' },
    { value: 'inline', doc: 'Список задан прямо в шаблоне' },
  ] },
  { key: 'url', doc: 'Адрес скачивания провайдера (для type: http).', type: 'string' },
  { key: 'path', doc: 'Путь локального файла провайдера.', type: 'string' },
  { key: 'interval', doc: 'Период обновления провайдера, секунды.', type: 'number' },
  { key: 'proxy', doc: 'Тег outbound-а, через который скачивать провайдера.', type: 'string' },
  { key: 'filter', doc: 'Регулярное выражение: в провайдер попадут только подходящие имена хостов.', type: 'string' },
  { key: 'exclude-filter', doc: 'Регулярное выражение: подходящие имена хостов исключаются из провайдера.', type: 'string' },
  { key: 'exclude-type', doc: 'Типы прокси, которые из провайдера не берутся, через |.', type: 'string' },
  { key: 'health-check.enable', doc: 'Включить периодическую проверку живости прокси провайдера.', type: 'boolean' },
  { key: 'health-check.url', doc: 'Адрес проверки живости.', type: 'string' },
  { key: 'health-check.interval', doc: 'Период проверки живости, секунды.', type: 'number' },
  { key: 'health-check.lazy', doc: 'Не проверять, пока провайдер не используется.', type: 'boolean' },
  {
    key: 'remnawave.include-proxies',
    doc: 'Ключ панели: добавить подставляемые хосты в этот провайдер (для построения цепочки через dialer-proxy).',
    type: 'boolean',
  },
  {
    key: 'override.dialer-proxy',
    doc: 'Ключ панели: имя узла или группы, через которую идёт цепочка для всех прокси провайдера.',
    type: 'string',
  },
  {
    key: 'override.additional-prefix',
    doc: 'Ключ панели: префикс, добавляемый к именам всех прокси провайдера.',
    type: 'string',
  },
]

const RULE_PROVIDER_FIELDS: MihomoField[] = [
  { key: 'type', doc: 'Откуда брать содержимое набора правил.', type: 'string', enum: [
    { value: 'http', doc: 'Скачать по url' },
    { value: 'file', doc: 'Взять из локального файла (path)' },
    { value: 'inline', doc: 'Список задан прямо в шаблоне (payload)' },
  ] },
  { key: 'behavior', doc: 'Формат содержимого набора: списки доменов, подсетей или классические строки правил.', type: 'string', enum: [
    { value: 'domain', doc: 'Список доменов' },
    { value: 'ipcidr', doc: 'Список подсетей' },
    { value: 'classical', doc: 'Классические строки правил (как в rules)' },
  ] },
  { key: 'format', doc: 'Формат файла набора.', type: 'string', enum: [
    { value: 'yaml', doc: 'YAML (по умолчанию)' },
    { value: 'text', doc: 'Обычный текст, по строке на запись' },
    { value: 'mrs', doc: 'Бинарный формат mihomo — компактнее и быстрее парсится' },
  ] },
  { key: 'url', doc: 'Адрес скачивания набора (для type: http).', type: 'string' },
  { key: 'path', doc: 'Путь локального файла набора.', type: 'string' },
  { key: 'interval', doc: 'Период обновления набора, секунды.', type: 'number' },
  { key: 'proxy', doc: 'Тег outbound-а, через который скачивать набор.', type: 'string' },
  { key: 'payload', doc: 'Правила прямо в шаблоне (для type: inline).', type: 'strings' },
]

const DNS_FIELDS: MihomoField[] = [
  { key: 'enable', doc: 'Включить встроенный DNS-резолвер ядра (иначе используется системный DNS).', type: 'boolean' },
  { key: 'listen', doc: 'Адрес:порт, на котором ядро отдаёт DNS (udp и tcp).', type: 'string' },
  { key: 'ipv6', doc: 'Резолвить AAAA-записи.', type: 'boolean' },
  { key: 'enhanced-mode', doc: 'Режим работы DNS-резолвера.', type: 'string', enum: [
    { value: 'fake-ip', doc: 'Клиенту отдаётся фиктивный IP, реальный домен уходит в sniffer/маршрутизацию' },
    { value: 'redir-host', doc: 'Отдаётся настоящий IP (нужен для прозрачных прокси без sniffer)' },
  ] },
  { key: 'fake-ip-range', doc: 'Подсеть, из которой выдаются фиктивные IP в режиме fake-ip.', type: 'string' },
  { key: 'fake-ip-filter', doc: 'Домены, для которых fake-ip не применяется (резолвятся по-настоящему).', type: 'strings' },
  { key: 'default-nameserver', doc: 'Бутстрап-DNS: резолвит адреса серверов из nameserver/fallback (только IP, без DoH/доменов).', type: 'strings' },
  { key: 'nameserver', doc: 'Основные DNS-серверы.', type: 'strings' },
  { key: 'fallback', doc: 'Резервные DNS-серверы (обычно зарубежные, на случай подмены ответа).', type: 'strings' },
  { key: 'proxy-server-nameserver', doc: 'DNS для резолвинга доменов самих прокси-серверов.', type: 'strings' },
  { key: 'direct-nameserver', doc: 'DNS для доменов, уходящих в прямой выход (DIRECT).', type: 'strings' },
  {
    key: 'nameserver-policy',
    doc: 'Соответствие «домен/geosite/rule-set → свой DNS-сервер».',
    type: 'map',
  },
  { key: 'respect-rules', doc: 'Резолвить DNS-запросы с учётом правил маршрутизации (через соответствующий outbound).', type: 'boolean' },
  { key: 'use-hosts', doc: 'Учитывать секцию hosts при резолвинге.', type: 'boolean' },
  { key: 'cache-algorithm', doc: 'Алгоритм кэша DNS-ответов.', type: 'string', enum: [
    { value: 'lru', doc: 'Вытеснение давно не запрашивавшихся записей (по умолчанию)' },
    { value: 'arc', doc: 'Адаптивный кэш — лучше держит часто запрашиваемые записи' },
  ] },
  { key: 'prefer-h3', doc: 'Пытаться использовать HTTP/3 (QUIC) для DoH-серверов.', type: 'boolean' },
]

const TUN_FIELDS: MihomoField[] = [
  { key: 'enable', doc: 'Включить TUN-интерфейс (перехват всего трафика системы).', type: 'boolean' },
  { key: 'stack', doc: 'Реализация сетевого стека для TUN.', type: 'string', enum: [
    { value: 'system', doc: 'Системный стек — стабильнее, ниже нагрузка' },
    { value: 'gvisor', doc: 'Пользовательский стек — больше изоляции' },
    { value: 'mixed', doc: 'TCP через system, UDP через gvisor' },
  ] },
  { key: 'device', doc: 'Имя сетевого интерфейса TUN (на macOS обязателен префикс utun).', type: 'string' },
  { key: 'auto-route', doc: 'Автоматически прописать системные маршруты через TUN.', type: 'boolean' },
  { key: 'auto-detect-interface', doc: 'Автоматически определять исходящий физический интерфейс.', type: 'boolean' },
  { key: 'dns-hijack', doc: 'Адреса, DNS-запросы к которым перехватываются встроенным резолвером ядра.', type: 'strings' },
  { key: 'strict-route', doc: 'Строгая маршрутизация — не даёт трафику утечь мимо TUN на Linux.', type: 'boolean' },
  { key: 'mtu', doc: 'MTU интерфейса TUN.', type: 'number' },
  { key: 'exclude-package', doc: 'Android-приложения (пакеты), чей трафик TUN не перехватывает.', type: 'strings' },
  { key: 'route-exclude-address', doc: 'Подсети, исключённые из маршрутизации через TUN.', type: 'strings' },
]

const SNIFFER_FIELDS: MihomoField[] = [
  { key: 'enable', doc: 'Включить определение домена назначения по трафику (sniffing).', type: 'boolean' },
  { key: 'force-dns-mapping', doc: 'Применять sniffing к трафику, полученному через DNS-подмену (redir-host).', type: 'boolean' },
  { key: 'parse-pure-ip', doc: 'Применять sniffing и там, где домен изначально не был известен.', type: 'boolean' },
  { key: 'override-destination', doc: 'Подменять адрес назначения найденным доменом (иначе домен идёт только в правила).', type: 'boolean' },
  {
    key: 'sniff',
    doc: 'Настройки по протоколам (HTTP/TLS/QUIC): порты и override-destination для каждого.',
    type: 'map',
  },
  { key: 'skip-domain', doc: 'Домены, для которых sniffing не выполняется.', type: 'strings' },
  { key: 'skip-dst-address', doc: 'Адреса назначения, для которых sniffing не выполняется.', type: 'strings' },
]

const PROFILE_FIELDS: MihomoField[] = [
  { key: 'store-selected', doc: 'Запоминать выбор участника группы между перезапусками.', type: 'boolean' },
  { key: 'store-fake-ip', doc: 'Сохранять соответствие домен → fake-ip между перезапусками.', type: 'boolean' },
]

const ROOT_FIELDS: MihomoField[] = [
  { key: 'mode', doc: 'Общий режим работы.', type: 'string', enum: [
    { value: 'rule', doc: 'По правилам маршрутизации (обычный режим)' },
    { value: 'global', doc: 'Весь трафик через одну выбранную группу' },
    { value: 'direct', doc: 'Весь трафик напрямую, минуя прокси' },
  ] },
  { key: 'log-level', doc: 'Уровень логирования ядра.', type: 'string', enum: [
    { value: 'silent', doc: 'Не логировать' },
    { value: 'error' },
    { value: 'warning' },
    { value: 'info' },
    { value: 'debug', doc: 'Максимально подробно' },
  ] },
  { key: 'ipv6', doc: 'Разрешить обработку IPv6-трафика.', type: 'boolean' },
  { key: 'unified-delay', doc: 'Единообразный расчёт задержки — исключает влияние TCP-хендшейка на сравнение узлов.', type: 'boolean' },
  { key: 'tcp-concurrent', doc: 'Открывать TCP-соединение сразу по всем IP из DNS-ответа, оставляя первое успешное.', type: 'boolean' },
  { key: 'mixed-port', doc: 'Порт смешанного HTTP/SOCKS входа.', type: 'number' },
  { key: 'socks-port', doc: 'Порт SOCKS5 входа.', type: 'number' },
  { key: 'port', doc: 'Порт HTTP-входа.', type: 'number' },
  { key: 'redir-port', doc: 'Порт прозрачного проксирования (redirect, Linux).', type: 'number' },
  { key: 'tproxy-port', doc: 'Порт прозрачного проксирования (TPROXY, Linux).', type: 'number' },
  { key: 'allow-lan', doc: 'Разрешить подключаться к портам ядра другим устройствам сети.', type: 'boolean' },
  { key: 'bind-address', doc: 'Адрес привязки входящих портов при allow-lan.', type: 'string' },
  { key: 'external-controller', doc: 'Адрес:порт RESTful API управления ядром.', type: 'string' },
  { key: 'secret', doc: 'Секрет доступа к external-controller.', type: 'string' },
  {
    key: 'global-client-fingerprint',
    doc: 'Глобальный uTLS-отпечаток клиента (ниже приоритетом, чем client-fingerprint у конкретного прокси). В новых версиях ядра устарел в пользу настройки на уровне прокси.',
    type: 'string',
    enum: [
      { value: 'chrome' },
      { value: 'firefox' },
      { value: 'safari' },
      { value: 'ios' },
      { value: 'random', doc: 'Реалистичный современный отпечаток по данным Cloudflare Radar' },
      { value: 'none' },
    ],
  },
  {
    key: 'enable-process',
    doc: 'Устаревший переключатель сопоставления по процессам (вкл/выкл). Ядро всё ещё принимает ключ, но современная замена — find-process-mode.',
    type: 'boolean',
  },
  { key: 'find-process-mode', doc: 'Определение процесса-источника соединения (для правил по процессам).', type: 'string', enum: [
    { value: 'always', doc: 'Определять всегда' },
    { value: 'strict', doc: 'Определять, когда это нужно правилам (по умолчанию)' },
    { value: 'off', doc: 'Не определять — рекомендуется на роутерах' },
  ] },
  { key: 'keep-alive-interval', doc: 'Интервал отправки TCP keep-alive, секунды.', type: 'number' },
  { key: 'keep-alive-idle', doc: 'Время простоя соединения перед началом keep-alive, секунды.', type: 'number' },
  { key: 'geodata-loader', doc: 'Загрузчик geo-баз.', type: 'string', enum: [
    { value: 'standard', doc: 'Разбирает базу целиком в память' },
    { value: 'memconservative', doc: 'Экономит память — вариант по умолчанию' },
  ] },
  {
    key: 'remnawave.includeHiddenHosts',
    doc: 'Ключ панели: подставлять в шаблон и скрытые (hidden) хосты профиля, а не только видимые.',
    type: 'boolean',
  },
]

export const MIHOMO_SECTIONS: Record<MihomoSectionName, MihomoSection> = {
  root: { name: 'root', title: 'Общие настройки', fields: ROOT_FIELDS },
  'proxy-group': { name: 'proxy-group', title: 'Группа', fields: PROXY_GROUP_FIELDS },
  'proxy-provider': { name: 'proxy-provider', title: 'Провайдер', fields: PROXY_PROVIDER_FIELDS },
  'rule-provider': { name: 'rule-provider', title: 'Набор правил', fields: RULE_PROVIDER_FIELDS },
  dns: { name: 'dns', title: 'DNS', fields: DNS_FIELDS },
  tun: { name: 'tun', title: 'TUN', fields: TUN_FIELDS },
  sniffer: { name: 'sniffer', title: 'Снифер', fields: SNIFFER_FIELDS },
  profile: { name: 'profile', title: 'Профиль', fields: PROFILE_FIELDS },
}

export function fieldsOf(section: MihomoSectionName): MihomoField[] {
  return MIHOMO_SECTIONS[section].fields
}

export function fieldOf(section: MihomoSectionName, key: string): MihomoField | undefined {
  return fieldsOf(section).find((f) => f.key === key)
}

const KEY_SECTIONS: Record<string, MihomoSectionName> = {
  dns: 'dns',
  tun: 'tun',
  sniffer: 'sniffer',
  profile: 'profile',
}

/** Секция, которой принадлежит ключ верхнего уровня; undefined — это скаляр корня */
export function sectionForKey(key: string): MihomoSectionName | undefined {
  return KEY_SECTIONS[key]
}
