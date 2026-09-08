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

})

describe('граница запроса не обнуляет ответы', () => {
  it('201 набор — это 200 с причиной по лишним, а не 400 на весь документ', async () => {
    const sets = Array.from({ length: 201 }, (_, i) => ({
      name: `set-${i}`,
      kind: 'inline' as const,
      payload: ['+.example.com'],
      behavior: 'domain' as const,
      format: 'yaml' as const,
    }))
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/match',
      headers: { cookie },
      payload: { target: { address: 'a.example.com' }, sets },
    })
    // Отказ на весь запрос превратил бы превышение в неработающую трассировку
    // вместо частичной: 64 набора ответили бы, а «не знаю» получили бы все 201
    expect(res.statusCode).toBe(200)
    const answers = res.json().answers
    expect(answers['set-0']).toMatchObject({ state: 'yes' })
    expect(answers['set-200']).toMatchObject({ state: 'unavailable' })
    expect(answers['set-200'].reason).toMatch(/больше 64 наборов/)
  })

  it('нецелый interval не отказывает запросу целиком', async () => {
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
            intervalSec: -7.5,
          },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().answers.i).toMatchObject({ state: 'yes' })
  })

  it('встроенный набор на два мегабайта проходит: стандартного лимита Fastify мало', async () => {
    const payload = Array.from({ length: 60_000 }, (_, i) => `+.host-${i}.example.com`)
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/match',
      headers: { cookie },
      payload: {
        target: { address: 'host-1.example.com' },
        sets: [{ name: 'big', kind: 'inline', payload, behavior: 'domain', format: 'yaml' }],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().answers.big).toMatchObject({ state: 'yes' })
  })
})

describe('POST /api/tools/ruleset/status', () => {
  it('требует авторизации', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tools/ruleset/status', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('отвечает состоянием по каждому набору', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/status',
      headers: { cookie },
      payload: {
        sets: [
          { name: 'i', kind: 'inline', payload: ['+.a.com'], behavior: 'domain', format: 'yaml' },
          {
            name: 'net',
            kind: 'http',
            url: 'https://example.com/x.mrs',
            behavior: 'domain',
            format: 'mrs',
          },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    const items = res.json().items as { name: string; state: string }[]
    expect(items.find((i) => i.name === 'i')?.state).toBe('ready')
    expect(items.find((i) => i.name === 'net')?.state).toBe('missing')
  })
})

describe('POST /api/tools/ruleset/refresh', () => {
  it('пробует загрузку и возвращает причину неудачи', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/refresh',
      headers: { cookie },
      payload: {
        sets: [
          {
            name: 'net',
            kind: 'http',
            url: 'https://example.com/x.mrs',
            behavior: 'domain',
            format: 'mrs',
          },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    const item = res.json().items[0]
    expect(item.state).toBe('error')
    // Подменённая сеть отвечает 503 — причина обязана дойти до пользователя
    expect(item.reason).toMatch(/503/)
  })
})

describe('POST /api/tools/ruleset/page', () => {
  it('отдаёт страницу содержимого встроенного набора', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/page',
      headers: { cookie },
      payload: {
        descriptor: {
          name: 'i',
          kind: 'inline',
          payload: ['+.a.com', '+.b.com', '+.c.com'],
          behavior: 'domain',
          format: 'yaml',
        },
        offset: 1,
        limit: 1,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ total: 3, offset: 1, items: ['+.b.com'] })
  })

  it('недоступный набор — 400 с русской причиной, а не 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/page',
      headers: { cookie },
      payload: {
        descriptor: {
          name: 'net',
          kind: 'http',
          url: 'https://example.com/x.mrs',
          behavior: 'domain',
          format: 'mrs',
        },
        offset: 0,
        limit: 10,
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/503/)
  })

  it('запредельный limit отвергается схемой', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/page',
      headers: { cookie },
      payload: {
        descriptor: { name: 'i', kind: 'inline', payload: [], behavior: 'domain', format: 'yaml' },
        offset: 0,
        limit: 5000,
      },
    })
    expect(res.statusCode).toBe(400)
  })
})
