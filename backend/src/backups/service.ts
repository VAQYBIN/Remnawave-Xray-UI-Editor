import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { ConfigProfile, SubscriptionTemplate } from '../remnawave/types.js'

export interface BackupEntry {
  file: string
  savedAt: string
  profileName: string
}

interface BackupFile {
  savedAt: string
  profile: ConfigProfile
}

export interface TemplateBackupFile {
  savedAt: string
  template: SubscriptionTemplate
}

const SAFE_FILE = /^[A-Za-z0-9_-]+\.json$/

export class BackupService {
  constructor(private dataDir: string) {}

  private dirFor(profileUuid: string): string {
    return join(this.dataDir, 'backups', profileUuid)
  }

  // Шаблоны живут в своём подкаталоге: uuid профиля и шаблона могут совпасть,
  // а путь профилей менять нельзя — иначе накопленные бэкапы осиротеют
  private templateDirFor(templateUuid: string): string {
    return join(this.dataDir, 'backups', 'templates', templateUuid)
  }

  private async writeTo(dir: string, payload: unknown): Promise<string> {
    await mkdir(dir, { recursive: true })
    const savedAt = (payload as { savedAt: string }).savedAt
    const file = `${savedAt.replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.json`
    await writeFile(join(dir, file), JSON.stringify(payload, null, 2), 'utf8')
    return file
  }

  async saveBackup(profile: ConfigProfile): Promise<string> {
    const payload: BackupFile = { savedAt: new Date().toISOString(), profile }
    return this.writeTo(this.dirFor(profile.uuid), payload)
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

  async saveTemplateBackup(template: SubscriptionTemplate): Promise<string> {
    const payload: TemplateBackupFile = { savedAt: new Date().toISOString(), template }
    return this.writeTo(this.templateDirFor(template.uuid), payload)
  }

  async listTemplateBackups(templateUuid: string): Promise<BackupEntry[]> {
    let files: string[]
    try {
      files = await readdir(this.templateDirFor(templateUuid))
    } catch {
      return []
    }
    const entries: BackupEntry[] = []
    for (const file of files.filter((f) => SAFE_FILE.test(f))) {
      const data = await this.readTemplateBackup(templateUuid, file)
      entries.push({ file, savedAt: data.savedAt, profileName: data.template.name })
    }
    return entries.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
  }

  async readTemplateBackup(templateUuid: string, file: string): Promise<TemplateBackupFile> {
    if (!SAFE_FILE.test(file)) {
      throw new Error('Некорректное имя файла бэкапа')
    }
    const raw = await readFile(join(this.templateDirFor(templateUuid), file), 'utf8')
    return JSON.parse(raw) as TemplateBackupFile
  }
}
