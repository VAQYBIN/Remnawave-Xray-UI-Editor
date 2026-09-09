// Запись `proxy-groups[]`: группа выбора/балансировки. `relay` устарел в пользу
// dialer-proxy у сервера или провайдера — цепочку теперь строит не группа.
// Источник: wiki.metacubex.one/config/proxy-groups и docs/config.yaml ядра
// (ветка Meta, 2026-09-09).

import { bool, en, num, obj, removed, str, strs, type EnumValue, type FieldSchema } from '../../../shared/schema'

export const GROUP_TYPE_VALUES: EnumValue[] = [
  { value: 'select', doc: 'Выбор вручную из списка участников.' },
  { value: 'url-test', doc: 'Автовыбор самого быстрого по проверке url.' },
  { value: 'fallback', doc: 'Первый живой по порядку списка.' },
  { value: 'load-balance', doc: 'Распределение соединений между участниками.' },
  { value: 'relay', doc: 'Цепочка через участников по очереди.', deprecated: removed('Meta', 'поле dialer-proxy у сервера или провайдера') },
]

export const GROUP_FIELDS: FieldSchema[] = [
  str('name', 'Имя группы. На него ссылаются правила и другие группы.'),
  en('type', 'Как группа выбирает участника.', GROUP_TYPE_VALUES),
  strs('proxies', 'Участники, перечисленные вручную: серверы, группы и встроенные цели. Панель допишет подставленные хосты В КОНЕЦ.', { ref: 'proxy-target' }),
  strs('use', 'Провайдеры (proxy-providers), чьи серверы входят в группу.', { ref: 'provider' }),
  str('url', 'Адрес проверки живости для url-test, fallback и load-balance.'),
  num('interval', 'Период проверки живости, секунд; 0 — выключить.'),
  bool('lazy', 'Не проверять, пока группа не используется.'),
  num('timeout', 'Таймаут проверки живости, мс.'),
  num('max-failed-times', 'Сколько неудач подряд переводят участника в недоступные.'),
  num('tolerance', 'На сколько мс новый лидер должен обгонять текущего, чтобы его сменить (url-test).'),
  en('strategy', 'Способ распределения у load-balance.', [
    { value: 'round-robin', doc: 'По очереди.' },
    { value: 'consistent-hashing', doc: 'Один адрес всегда через одного участника.' },
    { value: 'sticky-sessions', doc: 'Сессия закрепляется за участником.' },
  ]),
  str('filter', 'Регулярное выражение: в группу попадут только подходящие имена серверов.'),
  str('exclude-filter', 'Регулярное выражение: подходящие имена исключаются.'),
  str('exclude-type', 'Типы серверов, которые в группу не берутся, через |.'),
  bool('include-all', 'Взять все серверы и всех провайдеров сразу.'),
  bool('include-all-proxies', 'Взять все серверы из корневого proxies.'),
  bool('include-all-providers', 'Взять серверы всех объявленных провайдеров.'),
  bool('disable-udp', 'Не пускать через группу UDP.'),
  bool('hidden', 'Не показывать группу в клиенте.'),
  str('icon', 'Адрес иконки группы для клиента.'),
  str('expected-status', 'Коды ответа, считающиеся успехом проверки, например 204 или 200/302.'),
  str('default-selected', 'Участник, выбранный по умолчанию у select.', { ref: 'proxy-target' }),
  str('empty-fallback', 'Запасной сервер при пустой группе (только сервер, не группа).', { ref: 'proxy-target' }),
  obj('remnawave', 'Ключи панели Remnawave; в подписку не попадают.', [
    bool('include-proxies', 'false — панель НЕ дописывает подставленные хосты в эту группу; true у группы ничего не значит.', { panelKey: true }),
    bool('select-random-proxy', 'Положить в группу один случайный хост.', { panelKey: true }),
    bool('shuffle-proxies-order', 'Положить все хосты в случайном порядке.', { panelKey: true }),
  ], { panelKey: true }),
  str('interface-name', 'Исходящий интерфейс группы.', { deprecated: removed('Meta', 'тот же ключ у сервера') }),
  num('routing-mark', 'fwmark группы.', { deprecated: removed('Meta', 'тот же ключ у сервера') }),
]
