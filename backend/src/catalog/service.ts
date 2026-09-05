// Каталог готовых шаблонов из официального репозитория remnawave/templates.
// Наружу ходим только через fetchExternal: приватные адреса и редиректы на чужие
// хосты guard отсекает сам.

import { fetchExternal, type FetchGuardOptions } from '../net/guard.js'

export const CATALOG_URL =
  'https://raw.githubusercontent.com/remnawave/templates/main/subscription-templates-list.json'

const ALLOWED_HOST = 'raw.githubusercontent.com'
const CACHE_TTL_MS = 3_600_000

export interface CatalogEntry {
  name: string
  /** Тип шаблона панели; каталог опережает контракт, незнакомые значения проходят как есть */
  type: string
  author: string
  url: string
}

export class CatalogService {
  private cache: { at: number; entries: CatalogEntry[] } | null = null

  constructor(
    private net: FetchGuardOptions = {},
    private now: () => number = () => Date.now(),
  ) {}

  async list(): Promise<CatalogEntry[]> {
    const cached = this.cache
    if (cached !== null && this.now() - cached.at < CACHE_TTL_MS) return cached.entries

    const res = await fetchExternal(CATALOG_URL, this.net)
    if (!res.ok) {
      throw new Error(`Каталог шаблонов недоступен: GitHub ответил ${res.status}`)
    }
    const parsed = JSON.parse(await res.text()) as { templates?: unknown }
    const entries = Array.isArray(parsed.templates)
      ? parsed.templates.filter(isEntry)
      : []
    this.cache = { at: this.now(), entries }
    return entries
  }

  /** Ссылку принимаем только из индекса: произвольный url от клиента — дыра в SSRF-защите */
  async fetchTemplate(url: string): Promise<string> {
    const entries = await this.list()
    if (!entries.some((e) => e.url === url)) {
      throw new Error('Эта ссылка не из каталога шаблонов')
    }
    if (new URL(url).hostname !== ALLOWED_HOST) {
      throw new Error('Эта ссылка не из каталога шаблонов')
    }
    const res = await fetchExternal(url, this.net)
    if (!res.ok) throw new Error(`Шаблон не скачался: GitHub ответил ${res.status}`)
    return res.text()
  }
}

function isEntry(value: unknown): value is CatalogEntry {
  const e = value as Partial<CatalogEntry> | null
  return (
    typeof e?.name === 'string' &&
    typeof e.type === 'string' &&
    typeof e.author === 'string' &&
    typeof e.url === 'string'
  )
}
