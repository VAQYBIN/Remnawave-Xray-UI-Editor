/**
 * Имя файла выгрузки: «Germany DE» + 25.07.2026 → germany-de-2026-07-25.json.
 * Кириллицу оставляем — имена профилей у нас русские, а файловые системы её держат.
 */
export function exportFileName(profileName: string, date: Date): string {
  const slug = profileName
    .toLowerCase()
    .replace(/[^a-zа-яё0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${slug || 'config'}-${date.toISOString().slice(0, 10)}.json`
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
 * Разворачивает обёртки: файл из DATA_DIR/backups лежит как {savedAt, profile:{config}},
 * а ответ API — как {config}. У самого конфига Xray ключа `config` нет, так что
 * неоднозначности не возникает.
 */
function unwrapConfig(value: unknown): Record<string, unknown> | null {
  if (!isObject(value)) return null
  const profile = value['profile']
  if (isObject(profile) && isObject(profile['config'])) return profile['config']
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
  const config = unwrapConfig(value)
  if (config === null) return { error: `Ожидается объект конфига, а в файле ${kindOf(value)}.` }
  return { text: JSON.stringify(config, null, 2) }
}

export function downloadJson(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
