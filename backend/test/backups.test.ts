import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BackupService } from '../src/backups/service.js'
import { makeProfile } from './stub-remnawave.js'

function makeService() {
  return new BackupService(mkdtempSync(join(tmpdir(), 'xui-backup-')))
}

describe('BackupService', () => {
  it('сохраняет и читает бэкап', async () => {
    const svc = makeService()
    const profile = makeProfile({ name: 'Germany' })
    const file = await svc.saveBackup(profile)
    const saved = await svc.read(profile.uuid, file)
    expect(saved.profile).toEqual(profile)
    expect(saved.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('list возвращает записи, новые первыми', async () => {
    const svc = makeService()
    const profile = makeProfile({ name: 'Germany' })
    const f1 = await svc.saveBackup(profile)
    await new Promise((r) => setTimeout(r, 5))
    const f2 = await svc.saveBackup(profile)
    const list = await svc.list(profile.uuid)
    expect(list.map((e) => e.file)).toEqual([f2, f1])
    expect(list[0]!.profileName).toBe('Germany')
  })

  it('list для профиля без бэкапов — пустой массив', async () => {
    const svc = makeService()
    expect(await svc.list('00000000-0000-0000-0000-000000000000')).toEqual([])
  })

  it('read отклоняет path traversal в имени файла', async () => {
    const svc = makeService()
    await expect(svc.read('uuid', '../../etc/passwd')).rejects.toThrow(
      /Некорректное имя файла/,
    )
  })
})
