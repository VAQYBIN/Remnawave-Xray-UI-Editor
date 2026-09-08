// Файловый кэш скачанных наборов. Ключ — sha256 от ссылки: в самой ссылке
// бывает что угодно, включая `..` и символы, недопустимые в путях Windows.
//
// Две даты у файла значат разное и поэтому обе нужны. `mtime` — когда набор
// скачали, по нему считается срок годности. `atime` — когда его последний раз
// спрашивали, по нему выстраивается очередь на вытеснение. Свести их в одну
// нельзя: запись обращения в `mtime` не дала бы набору протухнуть никогда, а
// вытеснение по одному только `mtime` выбрасывало бы как раз тот набор, который
// спрашивают чаще всех, — у `private-ips` в живых шаблонах `interval` месячный,
// и его файл всегда самый старый в каталоге.
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
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
      const bytes = await readFile(path)
      try {
        // Отмечаем обращение, оставляя mtime нетронутым
        await utimes(path, new Date(), new Date(info.mtimeMs))
      } catch {
        // Отметка не проставилась — это не повод терять попадание в кэш
      }
      return { bytes, loadedAt: info.mtimeMs }
    } catch {
      return null
    }
  }

  /**
   * Файл как он есть, невзирая на срок годности. Нужен состоянию: просроченный
   * набор — это «загружен тогда-то и будет перекачан», а не «его нет». `read`
   * для этого не годится: он на просрочке возвращает null, и диалог показывал
   * бы «не загружен» на полном каталоге.
   *
   * Отметку обращения здесь НЕ ставим: заглядывание в состояние — не
   * использование набора, и двигать им очередь вытеснения значило бы спасать от
   * вытеснения то, на что никто не ссылается.
   */
  async peek(url: string): Promise<CachedFile | null> {
    const path = join(this.dir, this.nameOf(url))
    try {
      const info = await stat(path)
      return { bytes: await readFile(path), loadedAt: info.mtimeMs }
    } catch {
      return null
    }
  }

  /** Выбросить файл, чтобы следующая загрузка пошла в сеть */
  async remove(url: string): Promise<void> {
    try {
      await rm(join(this.dir, this.nameOf(url)))
    } catch {
      // Файла и не было — цель достигнута
    }
  }

  async write(url: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const path = join(this.dir, this.nameOf(url))
    await writeFile(path, bytes)
    await this.evict(path)
  }

  /**
   * Держим каталог в пределах потолка, выбрасывая то, к чему дольше всего не
   * обращались. `keep` — файл, только что записанный: его не выбрасываем даже
   * при переполнении. Иначе `write` завершился бы успехом, а файла бы не было,
   * и вызывающий об этом не узнал бы.
   */
  private async evict(keep?: string): Promise<void> {
    let entries: { path: string; size: number; atimeMs: number }[]
    try {
      const names = await readdir(this.dir)
      entries = []
      for (const name of names) {
        const path = join(this.dir, name)
        try {
          const info = await stat(path)
          if (info.isFile()) entries.push({ path, size: info.size, atimeMs: info.atimeMs })
        } catch {
          // Файл исчез между readdir и stat — не наша забота
        }
      }
    } catch {
      return
    }

    let total = entries.reduce((sum, e) => sum + e.size, 0)
    if (total <= this.limits.totalBytes) return

    entries.sort((a, b) => a.atimeMs - b.atimeMs)
    for (const entry of entries) {
      if (total <= this.limits.totalBytes) break
      if (entry.path === keep) continue
      try {
        await rm(entry.path)
        total -= entry.size
      } catch {
        // Не удалилось — считаем занятым и идём дальше
      }
    }
  }
}
