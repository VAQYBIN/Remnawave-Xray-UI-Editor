import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { makeTestConfig } from './helpers.js'

describe('server', () => {
  it('отвечает на /health', async () => {
    const app = await buildServer(makeTestConfig())
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })
})
