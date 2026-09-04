import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BackupService } from '../src/backups/service.js'
import { makeStubTemplate } from './stub-remnawave.js'
import { makeProfile } from './stub-remnawave.js'

const dataDir = () => mkdtempSync(join(tmpdir(), 'xui-backups-'))

describe('бэкапы шаблонов', () => {
  it('пишет в своё пространство имён, не задевая профили', async () => {
    const dir = dataDir()
    const svc = new BackupService(dir)
    const template = makeStubTemplate({ name: 'Мой шаблон' })

    const file = await svc.saveTemplateBackup(template)

    expect(existsSync(join(dir, 'backups', 'templates', template.uuid, file))).toBe(true)
    // Путь профилей не изменился — иначе накопленные бэкапы осиротеют
    expect(existsSync(join(dir, 'backups', template.uuid))).toBe(false)
  })

  it('список и чтение возвращают сохранённое', async () => {
    const svc = new BackupService(dataDir())
    const template = makeStubTemplate({ name: 'Мой шаблон' })
    const file = await svc.saveTemplateBackup(template)

    const entries = await svc.listTemplateBackups(template.uuid)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ file, profileName: 'Мой шаблон' })

    const read = await svc.readTemplateBackup(template.uuid, file)
    expect(read.template).toEqual(template)
  })

  it('бэкапы шаблона и профиля с одним uuid не смешиваются', async () => {
    const svc = new BackupService(dataDir())
    const uuid = '11111111-1111-1111-1111-111111111111'
    await svc.saveBackup(makeProfile({ uuid, name: 'Профиль' }))
    await svc.saveTemplateBackup(makeStubTemplate({ uuid, name: 'Шаблон' }))

    expect(await svc.list(uuid)).toHaveLength(1)
    expect(await svc.listTemplateBackups(uuid)).toHaveLength(1)
  })

  it('имя файла бэкапа шаблона проверяется так же строго', async () => {
    const svc = new BackupService(dataDir())
    await expect(svc.readTemplateBackup('u', '../secrets.json')).rejects.toThrow(
      'Некорректное имя файла бэкапа',
    )
  })
})
