import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { BackupService } from '../src/backups/service.js'
import { makeTestConfig, loginCookie } from './helpers.js'
import { makeProfile, makeStubRemnawave } from './stub-remnawave.js'

async function makeApp() {
  const profile = makeProfile({ name: 'Germany' })
  const stub = makeStubRemnawave([profile])
  const config = makeTestConfig()
  const backups = new BackupService(config.dataDir)
  const app = await buildServer(config, { remnawave: stub, backups })
  const cookie = await loginCookie(app)
  return { app, cookie, stub, backups, profile }
}

describe('PATCH /api/profiles/:uuid', () => {
  it('обновляет конфиг при совпадении expectedUpdatedAt и делает бэкап', async () => {
    const { app, cookie, backups, profile } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${profile.uuid}`,
      headers: { cookie },
      payload: {
        config: { inbounds: [{ tag: 'vless-in' }] },
        expectedUpdatedAt: profile.updatedAt,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().profile.config).toEqual({ inbounds: [{ tag: 'vless-in' }] })

    const list = await backups.list(profile.uuid)
    expect(list).toHaveLength(1)
    const saved = await backups.read(profile.uuid, list[0]!.file)
    expect(saved.profile.config).toEqual({ inbounds: [], outbounds: [] }) // версия ДО правки
    await app.close()
  })

  it('возвращает 409 с актуальной версией при конфликте', async () => {
    const { app, cookie, backups, profile } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${profile.uuid}`,
      headers: { cookie },
      payload: { config: {}, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toBe('Профиль был изменён в панели после открытия')
    expect(res.json().current.uuid).toBe(profile.uuid)
    expect(await backups.list(profile.uuid)).toHaveLength(0) // бэкап не создан
    await app.close()
  })

  it('без expectedUpdatedAt — 400', async () => {
    const { app, cookie, profile } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${profile.uuid}`,
      headers: { cookie },
      payload: { config: {} },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('backup routes', () => {
  it('отдаёт список и содержимое бэкапов', async () => {
    const { app, cookie, profile } = await makeApp()
    await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${profile.uuid}`,
      headers: { cookie },
      payload: { config: { inbounds: [] }, expectedUpdatedAt: profile.updatedAt },
    })
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/profiles/${profile.uuid}/backups`,
      headers: { cookie },
    })
    expect(listRes.statusCode).toBe(200)
    expect(listRes.json().backups).toHaveLength(1)

    const file = listRes.json().backups[0].file
    const readRes = await app.inject({
      method: 'GET',
      url: `/api/profiles/${profile.uuid}/backups/${file}`,
      headers: { cookie },
    })
    expect(readRes.statusCode).toBe(200)
    expect(readRes.json().profile.name).toBe('Germany')
    await app.close()
  })
})
