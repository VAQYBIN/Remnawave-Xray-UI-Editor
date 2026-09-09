// Секции без графа: журнал, время, сертификаты, экспериментальное. Все они
// живут в панели «Документ».

import type { FieldSchema } from '../../../shared/schema'
import { DIAL_FIELDS, bool, en, num, obj, removed, str, strs } from './shared'

export const LOG_FIELDS: FieldSchema[] = [
  bool('disabled', 'Не писать журнал вовсе.'),
  en('level', 'Уровень журнала; пусто — info.', ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic']),
  str('output', 'Файл журнала; задан — в консоль не пишется.'),
  bool('timestamp', 'Печатать время записи.'),
]

export const NTP_FIELDS: FieldSchema[] = [
  bool('enabled', 'Включить встроенную синхронизацию времени.'),
  str('server', 'Сервер NTP.'),
  num('server_port', 'Порт NTP, по умолчанию 123.'),
  str('interval', 'Период синхронизации, по умолчанию 30m.'),
  ...DIAL_FIELDS,
]

export const CERTIFICATE_FIELDS: FieldSchema[] = [
  en('store', 'Какое хранилище корневых сертификатов брать; пусто — system.', ['system', 'mozilla', 'chrome', 'none']),
  strs('certificate', 'Дополнительные доверенные сертификаты в PEM.'),
  strs('certificate_path', 'Пути к файлам сертификатов.'),
  strs('certificate_directory_path', 'Каталоги с сертификатами.'),
]

export const EXPERIMENTAL_FIELDS: FieldSchema[] = [
  obj('cache_file', 'Файл кэша: адреса fakeip и выбранные в группах выходы переживают перезапуск. Нужен удалённым наборам правил.', [
    bool('enabled', 'Включить файл кэша.'),
    str('path', 'Путь к файлу, по умолчанию cache.db.'),
    str('cache_id', 'Идентификатор кэша для нескольких конфигов с одним файлом.'),
    bool('store_fakeip', 'Хранить соответствия fakeip.'),
    bool('store_rdrc', 'Хранить кэш отклонённых ответов.', { deprecated: removed('1.14.0', 'store_dns') }),
    str('rdrc_timeout', 'Время жизни кэша отклонённых ответов.', { deprecated: removed('1.14.0', 'store_dns') }),
    bool('store_dns', 'Хранить кэш DNS.', { since: '1.14.0' }),
    str('buffer_size', 'Размер буфера записи.', { since: '1.15.0' }),
    str('flush_interval', 'Период сброса на диск.', { since: '1.15.0' }),
  ]),
  obj('clash_api', 'Внешний интерфейс управления: порт, панель и режим по умолчанию.', [
    str('external_controller', 'Адрес API, например 127.0.0.1:9090.'),
    str('external_ui', 'Каталог веб-панели.'),
    str('external_ui_download_url', 'Откуда скачать веб-панель.'),
    str('external_ui_download_detour', 'Через какой выход скачивать панель.', { ref: 'outbound' }),
    str('secret', 'Секрет API.'),
    str('default_mode', 'Режим по умолчанию; пусто — Rule.'),
    strs('access_control_allow_origin', 'Разрешённые Origin для CORS.', { since: '1.10.0' }),
    bool('access_control_allow_private_network', 'Разрешить доступ из частной сети.', { since: '1.10.0' }),
  ]),
  obj('v2ray_api', 'gRPC API V2Ray; в сборку по умолчанию не входит.', [
    str('listen', 'Адрес API; пусто — выключен.'),
    obj('stats', 'Статистика трафика.', [
      bool('enabled', 'Включить статистику.'),
      strs('inbounds', 'Входы для подсчёта.', { ref: 'inbound' }),
      strs('outbounds', 'Выходы для подсчёта.', { ref: 'outbound' }),
      strs('users', 'Пользователи для подсчёта.'),
    ]),
  ]),
]
