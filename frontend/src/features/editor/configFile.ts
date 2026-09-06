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
 * Разбор загруженного файла для документа, содержимое которого — YAML-ТЕКСТ.
 * Три случая:
 *   1. бэкап панели (`{savedAt, template:{encodedTemplateYaml}}`) — раскодировать;
 *   2. бэкап шаблона, у которого содержимое лежит мимо `encodedTemplateYaml`
 *      (XRAY_JSON и прочие JSON-типы) — отказ: это документ другого вида;
 *   3. всё остальное — сам документ, как есть.
 * Третий случай именно «как есть», а не «разобрать и напечатать»: источник
 * истины у Mihomo — текст, и круг через модель стёр бы якоря и маркеры.
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
