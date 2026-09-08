import { decodeYamlOrNull } from '../../shared/lib/base64'

/**
 * Имя файла выгрузки: «Germany DE» + 25.07.2026 → germany-de-2026-07-25.json.
 * Кириллицу оставляем — имена профилей у нас русские, а файловые системы её держат.
 * Имя документа, а не профиля: шаблон подписки выгружается тем же кодом (панель
 * держит его имя латиницей, так что слаг там выходит короче и проще).
 *
 * Расширение — параметр с умолчанием `json`: у шаблона Mihomo содержимое YAML, и
 * `.json` в имени соврал бы про формат файла ровно там, где по расширению его и
 * будут открывать.
 */
export function exportFileName(docName: string, date: Date, ext = 'json'): string {
  const slug = docName
    .toLowerCase()
    .replace(/[^a-zа-яё0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${slug || 'config'}-${date.toISOString().slice(0, 10)}.${ext}`
}

function kindOf(value: unknown): string {
  if (Array.isArray(value)) return 'массив'
  if (value === null) return 'null'
  if (typeof value === 'string') return 'строка'
  if (typeof value === 'number') return 'число'
  if (typeof value === 'boolean') return 'логическое значение'
  return typeof value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Разворачивает обёртки: файл из DATA_DIR/backups лежит как {savedAt, profile:{config}}
 * у профиля и {savedAt, template:{templateJson}} у шаблона подписки, а ответ API —
 * как {config}. У самого конфига Xray ключей `config`, `profile` и `template` нет,
 * так что неоднозначности не возникает.
 */
function unwrapConfig(value: unknown): Record<string, unknown> | null {
  if (!isObject(value)) return null
  const profile = value['profile']
  if (isObject(profile) && isObject(profile['config'])) return profile['config']
  const template = value['template']
  if (isObject(template) && isObject(template['templateJson'])) return template['templateJson']
  if (isObject(value['config'])) return value['config']
  return value
}

export function parseImported(raw: string): { text: string } | { error: string } {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (err) {
    return {
      error: `Файл не разбирается как JSON: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  // Бэкап шаблона не в формате XRAY_JSON: содержимое у него лежит мимо templateJson.
  // Без этой ветки обёртка целиком уехала бы в черновик. Условие узкое — обёртка
  // бэкапа, а не случайный ключ `template` в чужом документе: у настоящей рядом
  // есть savedAt, а внутри — templateType
  const template = isObject(value) ? value['template'] : undefined
  if (isObject(template) && 'templateType' in template && !isObject(template['templateJson'])) {
    return {
      error:
        'Это бэкап шаблона не в формате XRAY_JSON: его содержимое не в templateJson, редактор такие не открывает.',
    }
  }
  const config = unwrapConfig(value)
  if (config === null) return { error: `Ожидается объект конфига, а в файле ${kindOf(value)}.` }
  return { text: JSON.stringify(config, null, 2) }
}

function download(text: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function downloadJson(text: string, fileName: string): void {
  download(text, fileName, 'application/json')
}

/**
 * Выгрузка YAML-документа. Отдельная функция, а не параметр у downloadJson:
 * имя `downloadJson` соврало бы про содержимое, а тип в Blob и расширение в
 * имени файла — то, по чему операционная система и почта решают, чем его
 * открывать. Шаблон Mihomo, отданный как `application/json` под именем `.json`,
 * открывался бы редактором JSON и тут же ругался на первую же строку.
 */
export function downloadYaml(text: string, fileName: string): void {
  download(text, fileName, 'application/yaml')
}

/**
 * Похоже ли разобранное значение на конфиг Xray. Проверка по ФОРМЕ, а не по
 * синтаксису: JSON — валидный YAML, и отказывать по одному тому, что файл
 * разобрался как JSON, значило бы отвергать законный документ Mihomo,
 * записанный в JSON-стиле. Признаки узкие и все три из чужого формата: обёртки,
 * которые уже разворачивает `unwrapConfig`, и корень Xray-конфига. Ни одного из
 * них у шаблона Mihomo быть не может — там `proxy-groups`, `rules`, `proxies`.
 */
function looksLikeXray(value: unknown): boolean {
  if (!isObject(value)) return false
  const profile = value['profile']
  if (isObject(profile) && isObject(profile['config'])) return true
  if (isObject(value['config'])) return true
  return 'inbounds' in value && 'outbounds' in value
}

/**
 * Похож ли документ на sing-box. Признак — раздел МАРШРУТИЗАЦИИ, а не корень
 * целиком: `inbounds`/`outbounds` есть у обоих JSON-форматов (sing-box и Xray),
 * и по ним они неразличимы. У sing-box маршрут лежит в `route` (плюс свой
 * `experimental`).
 *
 * Признак — не обязанность: документ без `route` и без `experimental` валиден
 * для sing-box (оба поля опциональны), и отказывать по их отсутствию значило
 * бы отвергать законный файл. Отказ строится только на признаке ЧУЖОГО
 * формата — см. `parseImportedJson`.
 */
export function looksLikeSingbox(value: unknown): boolean {
  if (!isObject(value)) return false
  return isObject(value['route']) || isObject(value['experimental'])
}

/**
 * Публичная версия признака конфига Xray — по разделу маршрутизации
 * (`routing` либо `policy`), а не по обёрткам, которые проверяет внутренний
 * `looksLikeXray` в YAML-ветке. Та функция охраняет редактор Mihomo и не
 * годится сюда без правки чужой ветки: у неё нет пары для sing-box, а с
 * появлением JSON-конкурента одного признака `inbounds`+`outbounds` уже
 * недостаточно — он общий у обоих форматов.
 */
export function looksLikeXrayConfig(value: unknown): boolean {
  if (!isObject(value)) return false
  return isObject(value['routing']) || isObject(value['policy'])
}

/**
 * Разбор JSON-файла для загрузки в редактор конкретного формата (`xray` либо
 * `singbox`). Оба формата — JSON с `inbounds`/`outbounds` в корне, поэтому
 * `parseImported` (без параметра формата) для различения не годится — им
 * пользуется только редактор Xray, у которого конкурента до появления
 * sing-box не было. Здесь же отказ строится на признаке ЧУЖОГО формата: свой
 * признак не обязателен (см. `looksLikeSingbox`), а вот `routing`/`policy` в
 * документе, ожидаемом как sing-box, либо `route`/`experimental` в документе,
 * ожидаемом как Xray, — однозначная чужая примета.
 */
export function parseImportedJson(
  raw: string,
  expect: 'xray' | 'singbox',
): { text: string } | { error: string } {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (err) {
    return {
      error: `Файл не разбирается как JSON: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  const config = unwrapConfig(value)
  if (config === null) return { error: `Ожидается объект конфига, а в файле ${kindOf(value)}.` }
  if (expect === 'singbox' && looksLikeXrayConfig(config)) {
    return {
      error:
        'Похоже на конфиг Xray, а не на шаблон sing-box: в файле раздел routing или policy вместо route.',
    }
  }
  if (expect === 'xray' && looksLikeSingbox(config)) {
    return {
      error:
        'Похоже на шаблон sing-box, а не на конфиг Xray: в файле раздел route или experimental вместо routing.',
    }
  }
  return { text: JSON.stringify(config, null, 2) }
}

/**
 * Разбор загруженного файла для документа, содержимое которого — YAML-ТЕКСТ.
 * Четыре случая:
 *   1. распознаваемый конфиг Xray (`looksLikeXray`) — отказ: чужой формат;
 *   2. бэкап панели (`{savedAt, template:{encodedTemplateYaml}}`) — раскодировать;
 *   3. бэкап шаблона, у которого содержимое лежит мимо `encodedTemplateYaml`
 *      (XRAY_JSON и прочие JSON-типы) — отказ: это документ другого вида;
 *   4. всё остальное — сам документ, как есть.
 * Последний случай именно «как есть», а не «разобрать и напечатать»: источник
 * истины у Mihomo — текст, и круг через модель стёр бы якоря и маркеры.
 *
 * Порядок случаев значим и держится не только тестом: файл, подходящий сразу под
 * несколько, получает сообщение ПЕРВОГО совпавшего. Поэтому распознаваемый конфиг
 * Xray стоит раньше — иначе он объяснялся бы пользователю как «бэкап документа
 * другого вида» (случай 3), что верно по исходу, но неверно по причине.
 */
export function parseImportedYaml(raw: string): { text: string } | { error: string } {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    // JSON — подмножество YAML, поэтому сюда попадает подавляющее большинство
    // настоящих шаблонов: они не разбираются как JSON и уходят в черновик текстом
    return { text: raw }
  }
  if (looksLikeXray(value)) {
    return {
      error:
        'Похоже на конфиг Xray, а не на шаблон Mihomo: в файле обёртка профиля либо корень с inbounds и outbounds.',
    }
  }
  const template = isObject(value) ? value['template'] : undefined
  if (isObject(template) && 'templateType' in template) {
    const encoded = template['encodedTemplateYaml']
    if (typeof encoded === 'string') {
      const text = decodeYamlOrNull(encoded)
      if (text === null) {
        return { error: 'Содержимое шаблона в файле не читается: encodedTemplateYaml не base64.' }
      }
      return { text }
    }
    return {
      error:
        'Это бэкап шаблона, содержимое которого лежит не в encodedTemplateYaml, — документ другого вида.',
    }
  }
  // Объект без обёртки бэкапа: JSON — валидный YAML, отдаём текст как есть
  return { text: raw }
}
