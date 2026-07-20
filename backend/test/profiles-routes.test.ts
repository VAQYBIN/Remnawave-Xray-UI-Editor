import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { makeTestConfig, loginCookie } from './helpers.js'
import { makeProfile, makeStubRemnawave } from './stub-remnawave.js'

async function makeApp(stub = makeStubRemnawave()) {
  const app = await buildServer(makeTestConfig(), { remnawave: stub })
  const cookie = await loginCookie(app)
  return { app, cookie, stub }
}

describe('profile routes', () => {
  it('GET /api/profiles возвращает список', async () => {
    const p = makeProfile({ name: 'Germany' })
    const { app, cookie } = await makeApp(makeStubRemnawave([p]))
    const res = await app.inject({ method: 'GET', url: '/api/profiles', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().profiles).toHaveLength(1)
    expect(res.json().profiles[0].name).toBe('Germany')
    await app.close()
  })

  it('GET /api/profiles без сессии — 401', async () => {
    const { app } = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/api/profiles' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('GET /api/profiles/:uuid — 404 от панели пробрасывается', async () => {
    const { app, cookie } = await makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/profiles/00000000-0000-0000-0000-000000000000',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().message).toBe('Config profile not found')
    await app.close()
  })

  it('POST /api/profiles создаёт профиль (201)', async () => {
    const { app, cookie, stub } = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { cookie },
      payload: { name: 'New Profile', config: { inbounds: [] } },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().profile.name).toBe('New Profile')
    expect(stub.profiles).toHaveLength(1)
    await app.close()
  })

  it('POST /api/profiles с некорректным именем — 400', async () => {
    const { app, cookie } = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { cookie },
      payload: { name: 'Кириллица!', config: {} },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Некорректный запрос')
    await app.close()
  })

  it('DELETE /api/profiles/:uuid удаляет', async () => {
    const p = makeProfile()
    const { app, cookie, stub } = await makeApp(makeStubRemnawave([p]))
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${p.uuid}`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(stub.profiles).toHaveLength(0)
    await app.close()
  })

  it('GET /api/nodes и /api/squads возвращают контекст', async () => {
    const { app, cookie } = await makeApp()
    const nodes = await app.inject({ method: 'GET', url: '/api/nodes', headers: { cookie } })
    const squads = await app.inject({ method: 'GET', url: '/api/squads', headers: { cookie } })
    expect(nodes.json().nodes).toEqual([{ uuid: 'node-1', name: 'DE-1', countryCode: 'DE' }])
    expect(squads.json().squads).toEqual([{ uuid: 'squad-1', name: 'Default' }])
    await app.close()
  })
})
