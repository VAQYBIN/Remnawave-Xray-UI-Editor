import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { indexEntries, parseCidrs, parseDomains, type GeoCidr, type GeoDomain } from './dat.js'
import { domainMatches, ipMatches, parseKey } from './match.js'

// Дефолты — канонические списки v2fly. Альтернатива с расширенными категориями:
// https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat
export const DEFAULT_GEOSITE_URL =
  'https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat'
export const DEFAULT_GEOIP_URL =
  'https://github.com/v2fly/geoip/releases/latest/download/geoip.dat'

export interface GeoSourceStatus {
  url: string
  present: boolean
  loadedAt?: string
  sizeBytes?: number
  categories?: number
}

export interface GeoStatus {
  geosite: GeoSourceStatus
  geoip: GeoSourceStatus
}

export interface GeoMatchResult {
  loaded: boolean
  answers: Record<string, boolean>
  missing: string[]
}

interface Settings {
  geositeUrl?: string
  geoipUrl?: string
}

type Kind = 'geosite' | 'geoip'

interface Cached {
  mtimeMs: number
  index: Map<string, Uint8Array>
  /** Разобранные категории: у крупных стран десятки и сотни тысяч подсетей,
   *  разбирать их заново на каждый запрос слишком дорого */
  domains: Map<string, GeoDomain[]>
  cidrs: Map<string, { cidrs: GeoCidr[]; reverseMatch: boolean }>
}

const MAX_BYTES = 64 * 1024 * 1024

export class GeoService {
  private cache = new Map<Kind, Cached>()

  constructor(
    private dataDir: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private fileFor(kind: Kind): string {
    return join(this.dataDir, 'geodata', `${kind}.dat`)
  }

  private settingsPath(): string {
    return join(this.dataDir, 'settings.json')
  }

  private async readSettings(): Promise<Settings> {
    try {
      const raw = await readFile(this.settingsPath(), 'utf8')
      return ((JSON.parse(raw) as { geo?: Settings }).geo ?? {}) as Settings
    } catch {
      return {}
    }
  }

  private async writeSettings(next: Settings): Promise<void> {
    let root: Record<string, unknown> = {}
    try {
      root = JSON.parse(await readFile(this.settingsPath(), 'utf8')) as Record<string, unknown>
    } catch {
      root = {}
    }
    root.geo = next
    await mkdir(this.dataDir, { recursive: true })
    await writeFile(this.settingsPath(), JSON.stringify(root, null, 2), 'utf8')
  }

  private urlFor(kind: Kind, settings: Settings): string {
    if (kind === 'geosite') return settings.geositeUrl ?? DEFAULT_GEOSITE_URL
    return settings.geoipUrl ?? DEFAULT_GEOIP_URL
  }

  /** Индекс живёт в памяти до смены mtime файла — разбирать его на каждый запрос незачем */
  private async cacheOf(kind: Kind): Promise<Cached | null> {
    let info
    try {
      info = await stat(this.fileFor(kind))
    } catch {
      this.cache.delete(kind)
      return null
    }
    const cached = this.cache.get(kind)
    if (cached && cached.mtimeMs === info.mtimeMs) return cached
    const buf = await readFile(this.fileFor(kind))
    const fresh: Cached = {
      mtimeMs: info.mtimeMs,
      index: indexEntries(new Uint8Array(buf)),
      domains: new Map(),
      cidrs: new Map(),
    }
    this.cache.set(kind, fresh)
    return fresh
  }

  private domainsOf(cached: Cached, code: string): GeoDomain[] | null {
    const hit = cached.domains.get(code)
    if (hit) return hit
    const entry = cached.index.get(code)
    if (!entry) return null
    const parsed = parseDomains(entry)
    cached.domains.set(code, parsed)
    return parsed
  }

  private cidrsOf(cached: Cached, code: string): { cidrs: GeoCidr[]; reverseMatch: boolean } | null {
    const hit = cached.cidrs.get(code)
    if (hit) return hit
    const entry = cached.index.get(code)
    if (!entry) return null
    const parsed = parseCidrs(entry)
    cached.cidrs.set(code, parsed)
    return parsed
  }

  private async statusOf(kind: Kind, settings: Settings): Promise<GeoSourceStatus> {
    const url = this.urlFor(kind, settings)
    try {
      const info = await stat(this.fileFor(kind))
      const cached = await this.cacheOf(kind)
      return {
        url,
        present: true,
        loadedAt: info.mtime.toISOString(),
        sizeBytes: info.size,
        categories: cached?.index.size ?? 0,
      }
    } catch {
      return { url, present: false }
    }
  }

  async status(): Promise<GeoStatus> {
    const settings = await this.readSettings()
    return {
      geosite: await this.statusOf('geosite', settings),
      geoip: await this.statusOf('geoip', settings),
    }
  }

  async setUrls(urls: { geositeUrl?: string; geoipUrl?: string }): Promise<GeoStatus> {
    for (const url of [urls.geositeUrl, urls.geoipUrl]) {
      if (url === undefined) continue
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('Ссылка должна начинаться с http:// или https://')
      }
    }
    const settings = await this.readSettings()
    await this.writeSettings({
      geositeUrl: urls.geositeUrl ?? settings.geositeUrl,
      geoipUrl: urls.geoipUrl ?? settings.geoipUrl,
    })
    return this.status()
  }

  /** Скачивает базы по сохранённым ссылкам; пишет через временный файл, чтобы не оставить обрубок */
  async update(kinds: Kind[] = ['geosite', 'geoip']): Promise<GeoStatus> {
    const settings = await this.readSettings()
    await mkdir(join(this.dataDir, 'geodata'), { recursive: true })
    for (const kind of kinds) {
      const url = this.urlFor(kind, settings)
      const res = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(120_000),
        redirect: 'follow',
      })
      if (!res.ok) throw new Error(`Не удалось скачать ${kind}: сервер ответил ${res.status}`)
      const body = new Uint8Array(await res.arrayBuffer())
      if (body.byteLength === 0) throw new Error(`Пустой ответ при загрузке ${kind}`)
      if (body.byteLength > MAX_BYTES) throw new Error(`Файл ${kind} больше 64 МБ — отказываюсь`)
      if (indexEntries(body).size === 0) {
        throw new Error(`Файл ${kind} не похож на geo-базу: ни одной категории`)
      }
      const target = this.fileFor(kind)
      const tmp = `${target}.tmp`
      await writeFile(tmp, body)
      await rename(tmp, target)
      this.cache.delete(kind)
    }
    return this.status()
  }

  async match(input: { domain?: string; ip?: string; keys: string[] }): Promise<GeoMatchResult> {
    const answers: Record<string, boolean> = {}
    const missing: string[] = []
    let loaded = false

    for (const key of input.keys) {
      const parsed = parseKey(key)
      if (!parsed) continue
      if (parsed.kind === 'geosite' && input.domain === undefined) continue
      if (parsed.kind === 'geoip' && input.ip === undefined) continue

      const cached = await this.cacheOf(parsed.kind)
      if (!cached) continue
      loaded = true

      let hit: boolean
      if (parsed.kind === 'geosite') {
        const domains = this.domainsOf(cached, parsed.code)
        if (!domains) {
          if (!missing.includes(key)) missing.push(key)
          continue
        }
        hit = domainMatches(domains, input.domain!, parsed.attribute)
      } else {
        const entry = this.cidrsOf(cached, parsed.code)
        if (!entry) {
          if (!missing.includes(key)) missing.push(key)
          continue
        }
        hit = ipMatches(entry.cidrs, input.ip!)
        if (entry.reverseMatch) hit = !hit
      }
      answers[key] = parsed.negated ? !hit : hit
    }

    return { loaded, answers, missing }
  }
}
