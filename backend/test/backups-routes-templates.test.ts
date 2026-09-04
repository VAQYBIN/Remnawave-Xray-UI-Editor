import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeProfile, makeStubRemnawave, makeStubTemplate } from './stub-remnawave.js'

describe('роуты бэкапов шаблонов', () => {
  it('сохранение шаблона кладёт версию, которую видно списком и читается по имени', async () => {
    const template = makeStubTemplate({ name: 'Default' })
    // Стаб модифицирует шаблон на месте при updateTemplate, поэтому сохраняем оригинал
    const originalTemplateJson = structuredClone(template.templateJson)
    const app = await buildServer(makeTestConfig(), {
      remnawave: makeStubRemnawave([], [template]),
    })
    const cookie = await loginCookie(app)

    const read = await app.inject({
      method: 'GET',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
    })
    await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { templateJson: { outbounds: [] }, expectedHash: read.json().hash },
    })

    const list = await app.inject({
      method: 'GET',
      url: `/api/templates/${template.uuid}/backups`,
      headers: { cookie },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().backups).toHaveLength(1)

    const file = list.json().backups[0].file as string
    const one = await app.inject({
      method: 'GET',
      url: `/api/templates/${template.uuid}/backups/${file}`,
      headers: { cookie },
    })
    expect(one.statusCode).toBe(200)
    // В бэкапе лежит версия ДО правки — ради неё бэкап и делается
    expect(one.json().template.templateJson).toEqual(originalTemplateJson)
    await app.close()
  })

  it('бэкап профиля не виден через путь шаблона с тем же uuid', async () => {
    const uuid = '11111111-1111-4111-8111-111111111111'
    const app = await buildServer(makeTestConfig(), {
      remnawave: makeStubRemnawave([makeProfile({ uuid })], []),
    })
    const cookie = await loginCookie(app)
    await app.backups.saveBackup(makeProfile({ uuid, name: 'Профиль' }))

    const res = await app.inject({
      method: 'GET',
      url: `/api/templates/${uuid}/backups`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().backups).toEqual([])
    await app.close()
  })

  it('имя файла с обходом каталога отклоняется', async () => {
    const template = makeStubTemplate()
    const app = await buildServer(makeTestConfig(), {
      remnawave: makeStubRemnawave([], [template]),
    })
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'GET',
      url: `/api/templates/${template.uuid}/backups/..%2F..%2Fsettings.json`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
