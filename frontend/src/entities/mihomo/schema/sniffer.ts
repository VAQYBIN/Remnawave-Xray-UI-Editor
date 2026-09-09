import { bool, obj, ports, removed, strs, type FieldSchema } from '../../../shared/schema'

const protocol = (key: string, doc: string, withOverride: boolean): FieldSchema =>
  obj(key, doc, [
    ports('ports', 'Порты, на которых снифить; число или диапазон.'),
    ...(withOverride ? [bool('override-destination', 'Подменять адрес назначения найденным доменом; перекрывает общий override-destination.')] : []),
  ])

export const SNIFFER_FIELDS: FieldSchema[] = [
  bool('enable', 'Включить определение домена назначения по трафику.'),
  bool('force-dns-mapping', 'Снифить трафик, распознанный как redir-host.'),
  bool('parse-pure-ip', 'Снифить и там, где домен изначально не известен.'),
  bool('override-destination', 'Подменять адрес назначения найденным доменом (общее умолчание).'),
  obj('sniff', 'Настройки по протоколам: порты и override-destination для каждого.', [
    protocol('HTTP', 'HTTP: по умолчанию порт 80.', true),
    protocol('TLS', 'TLS/SNI: по умолчанию порт 443.', true),
    protocol('QUIC', 'QUIC: по умолчанию порт 443.', true),
  ]),
  strs('force-domain', 'Домены, для которых снифинг выполняется всегда.'),
  strs('skip-domain', 'Домены, для которых результат снифинга пропускается.'),
  strs('skip-src-address', 'Подсети источника без снифинга.'),
  strs('skip-dst-address', 'Подсети назначения без снифинга.'),
  strs('sniffing', 'Список протоколов (старый синтаксис).', { deprecated: removed('Meta', 'объект sniff') }),
  strs('port-whitelist', 'Порты для снифинга (старый синтаксис).', { deprecated: removed('Meta', 'ports внутри объекта sniff') }),
]
