import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { ConfigProfile } from '../remnawave/types.js'

export interface BackupEntry {
  file: string
  savedAt: string
  profileName: string
}

interface BackupFile {
  savedAt: string
  profile: ConfigProfile
}

const SAFE_FILE = /^[A-Za-z0-9_-]+\.json$/

export class BackupService {
  constructor(private dataDir: string) {}

  private dirFor(profileUuid: string): string {
    return join(this.dataDir, 'backups', profileUuid)
  }

  async saveBackup(profile: ConfigProfile): Promise<string> {
    const dir = this.dirFor(profile.uuid)
    await mkdir(dir, { recursive: true })
    const savedAt = new Date().toISOString()
    const file = `${savedAt.replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.json`
    const payload: BackupFile = { savedAt, profile }
    await writeFile(join(dir, file), JSON.stringify(payload, null, 2), 'utf8')
    return file
  }

  async list(profileUuid: string): Promise<BackupEntry[]> {
    let files: string[]
    try {
      files = await readdir(this.dirFor(profileUuid))
    } catch {
      return []
    }
    const entries: BackupEntry[] = []
    for (const file of files.filter((f) => SAFE_FILE.test(f))) {
      const data = await this.read(profileUuid, file)
      entries.push({ file, savedAt: data.savedAt, profileName: data.profile.name })
    }
    return entries.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
  }

  async read(profileUuid: string, file: string): Promise<BackupFile> {
    if (!SAFE_FILE.test(file)) {
      throw new Error('Некорректное имя файла бэкапа')
    }
    const raw = await readFile(join(this.dirFor(profileUuid), file), 'utf8')
    return JSON.parse(raw) as BackupFile
  }
}
