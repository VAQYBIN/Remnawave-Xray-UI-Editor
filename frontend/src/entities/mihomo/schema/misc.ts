import { bool, map, num, str, type FieldSchema } from '../../../shared/schema'
import { dialerProxy } from './shared'

export const PROFILE_FIELDS: FieldSchema[] = [
  bool('store-selected', 'Запоминать выбор участника группы между перезапусками.'),
  bool('store-fake-ip', 'Сохранять соответствие домен → fake-ip между перезапусками.'),
  bool('tracing', 'Трассировка профиля.'),
]

export const NTP_FIELDS: FieldSchema[] = [
  bool('enable', 'Синхронизировать время по NTP.'),
  bool('write-to-system', 'Записывать время в системные часы (нужны права).'),
  str('server', 'NTP-сервер, по умолчанию time.apple.com.'),
  num('port', 'Порт NTP, по умолчанию 123.'),
  num('interval', 'Период синхронизации, минут.'),
  dialerProxy({ doc: 'Через какую группу или сервер ходить к NTP; по умолчанию напрямую.' }),
]

export const EXPERIMENTAL_FIELDS: FieldSchema[] = [
  bool('quic-go-disable-gso', 'Отключить GSO у quic-go (обход проблем на некоторых Linux).'),
  bool('quic-go-disable-ecn', 'Отключить ECN у quic-go.'),
  bool('dialer-ip4p-convert', 'Преобразование адреса IP4P для обхода NAT.'),
]

/** Раздел hosts: домен → IP, список IP, псевдоним или спецзначение lan */
export const hostsField = (): FieldSchema =>
  map('hosts', 'Соответствие домен → адрес, как /etc/hosts: значение — IP, список IP, домен-псевдоним или lan (адреса всех интерфейсов). Шаблоны *.example.com и .example.com допустимы.', { values: 'strings' })
