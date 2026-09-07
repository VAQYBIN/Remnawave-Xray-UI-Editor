// Файловый кэш скачанных наборов. Ключ — sha256 от ссылки: в самой ссылке
// бывает что угодно, включая `..` и символы, недопустимые в путях Windows.
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface CachedFile {
  bytes: Uint8Array
  loadedAt: number
}

export interface CacheLimits {
  totalBytes: number
}

export class RuleSetCache {
  constructor(
    private readonly dir: string,
    private readonly limits: CacheLimits,
  ) {}

  private nameOf(url: string): string {
    return createHash('sha256').update(url).digest('hex')
  }

  async read(url: string, ttlMs: number): Promise<CachedFile | null> {
    const path = join(this.dir, this.nameOf(url))
    try {
      const info = await stat(path)
      // Свежесть меряем по mtime файла, а не по отдельному индексу: индекс
      // разъехался бы с содержимым каталога при любой правке снаружи
      if (Date.now() - info.mtimeMs > ttlMs) return null
      return { bytes: await readFile(path), loadedAt: info.mtimeMs }
    } catch {
      return null
    }
  }

  async write(url: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(join(this.dir, this.nameOf(url)), bytes)
    await this.evict()
  }

  /** Держим каталог в пределах потолка, выбрасывая самое давнее */
  private async evict(): Promise<void> {
    let entries: { path: string; size: number; mtimeMs: number }[]
    try {
      const names = await readdir(this.dir)
      entries = []
      for (const name of names) {
        const path = join(this.dir, name)
        try {
          const info = await stat(path)
          if (info.isFile()) entries.push({ path, size: info.size, mtimeMs: info.mtimeMs })
        } catch {
          // Файл исчез между readdir и stat — не наша забота
        }
      }
    } catch {
      return
    }

    let total = entries.reduce((sum, e) => sum + e.size, 0)
    if (total <= this.limits.totalBytes) return

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const entry of entries) {
      if (total <= this.limits.totalBytes) break
      try {
        await rm(entry.path)
        total -= entry.size
      } catch {
        // Не удалилось — считаем занятым и идём дальше
      }
    }
  }
}
