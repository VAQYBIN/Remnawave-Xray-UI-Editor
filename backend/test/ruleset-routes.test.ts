import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/server.js'
import { RuleSetService } from '../src/ruleset/service.js'
import { makeStubRemnawave } from './stub-remnawave.js'
import { loginCookie, makeTestConfig } from './helpers.js'

let app: FastifyInstance
let cookie: string

beforeEach(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'xui-ruleset-routes-'))
  app = await buildServer(makeTestConfig({ dataDir }), {
    remnawave: makeStubRemnawave(),
    // Сеть подменена: тест не ходит наружу даже случайно. Код 503 выбран
    // нарочно узнаваемым — по нему видно, что отвечал именно подменённый
    // сервис, а не собранный сервером по умолчанию
    ruleset: new RuleSetService(dataDir, {
      lookupImpl: async () => [{ address: '93.184.216.34' }],
      fetchImpl: (async () => new Response('', { status: 503 })) as unknown as typeof fetch,
    }),
  })
  cookie = await loginCookie(app)
})

afterEach(async () => {
  await app.close()
})

describe('POST /api/tools/ruleset/match', () => {
  it('требует авторизации', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tools/ruleset/match', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('отвечает по каждому набору', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/match',
      headers: { cookie },
      payload: {
        target: { address: 'a.example.com' },
        sets: [
          {
            name: 'i',
            kind: 'inline',
            payload: ['+.example.com'],
            behavior: 'domain',
            format: 'yaml',
          },
          {
            name: 'miss',
            kind: 'inline',
            payload: ['+.other.com'],
            behavior: 'domain',
            format: 'yaml',
          },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().answers.i).toMatchObject({ state: 'yes' })
    expect(res.json().answers.miss).toMatchObject({ state: 'no' })
  })

  it('недоступный набор — 200 с причиной по нему, а не отказ на весь запрос', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/match',
      headers: { cookie },
      payload: {
        target: { address: 'a.example.com' },
        sets: [
          {
            name: 'net',
            kind: 'http',
            url: 'https://example.com/a.mrs',
            behavior: 'domain',
            format: 'mrs',
          },
          {
            name: 'i',
            kind: 'inline',
            payload: ['+.example.com'],
            behavior: 'domain',
            format: 'yaml',
          },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().answers.net).toMatchObject({ state: 'unavailable' })
    expect(res.json().answers.net.reason).toMatch(/503/)
    expect(res.json().answers.i).toMatchObject({ state: 'yes' })
  })

  it('кривое тело — 400, а не 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/match',
      headers: { cookie },
      payload: { target: {}, sets: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('заведомо абсурдный список наборов схема не пропускает', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/match',
      headers: { cookie },
      payload: {
        target: { address: 'a.example.com' },
        sets: Array.from({ length: 201 }, (_, i) => ({
          name: `n${i}`,
          kind: 'inline',
          payload: [],
          behavior: 'domain',
          format: 'yaml',
        })),
      },
    })
    expect(res.statusCode).toBe(400)
  })
})
