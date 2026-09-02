import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { describeToken, describeTokenWarning, EXPIRY_WARN_DAYS } from '../src/remnawave/token.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeStubRemnawave } from './stub-remnawave.js'

const NOW = new Date('2026-09-02T18:00:00.000Z')

/** Панель подписывает токен HS256, но подпись нам не нужна и проверить её нечем:
 *  секрет знает только панель. Читаем полезную нагрузку как есть. */
function makeToken(payload: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}.подпись`
}

const inDays = (days: number) => Math.floor(NOW.getTime() / 1000) + days * 86_400

describe('describeToken', () => {
  it('считает остаток дней у действующего токена', () => {
    const status = describeToken(makeToken({ role: 'API', exp: inDays(30) }), NOW)
    expect(status.expiresAt).toBe('2026-10-02T18:00:00.000Z')
    expect(status.daysLeft).toBe(30)
    expect(status.expired).toBe(false)
    expect(status.expiringSoon).toBe(false)
  })

  it('поднимает флаг за неделю до истечения', () => {
    const status = describeToken(makeToken({ exp: inDays(EXPIRY_WARN_DAYS) }), NOW)
    expect(status.expiringSoon).toBe(true)
    expect(status.expired).toBe(false)
  })

  it('распознаёт истёкший токен', () => {
    const status = describeToken(makeToken({ exp: inDays(-1) }), NOW)
    expect(status.expired).toBe(true)
    expect(status.expiringSoon).toBe(true)
    expect(status.daysLeft).toBe(-1)
  })

  // Формат токена — дело панели, а не наш контракт: она вправе выдать что угодно.
  // Не разобрали срок — молчим, а не пугаем оператора ложной тревогой.
  it('молчит, когда срок прочитать нечем', () => {
    for (const token of [
      'не-jwt-вовсе',
      'два.сегмента',
      `${Buffer.from('{}').toString('base64url')}.не-base64!!.sig`,
      makeToken({ role: 'API' }),
      makeToken({ exp: 'завтра' }),
    ]) {
      const status = describeToken(token, NOW)
      expect(status.expiresAt).toBeNull()
      expect(status.daysLeft).toBeNull()
      expect(status.expired).toBe(false)
      expect(status.expiringSoon).toBe(false)
    }
  })

  it('не роняет разбор на полезной нагрузке, которая не объект', () => {
    expect(describeToken(makeToken([1, 2] as never), NOW).expiresAt).toBeNull()
    const notJson = `x.${Buffer.from('просто текст').toString('base64url')}.y`
    expect(describeToken(notJson, NOW).expiresAt).toBeNull()
  })
})

describe('describeTokenWarning', () => {
  it('молчит, пока до истечения далеко или срок неизвестен', () => {
    expect(describeTokenWarning(describeToken(makeToken({ exp: inDays(30) }), NOW))).toBeUndefined()
    expect(describeTokenWarning(describeToken('не-jwt', NOW))).toBeUndefined()
  })

  it('предупреждает заранее и отдельно — про уже истёкший', () => {
    const soon = describeTokenWarning(describeToken(makeToken({ exp: inDays(3) }), NOW))
    expect(soon).toContain('истекает')
    expect(soon).toContain('осталось дней: 3')

    const dead = describeTokenWarning(describeToken(makeToken({ exp: inDays(-5) }), NOW))
    expect(dead).toContain('истёк')
    expect(dead).toContain('REMNAWAVE_TOKEN')
  })
})

describe('GET /api/panel/token', () => {
  it('отдаёт срок действия токена, не раскрывая сам токен', async () => {
    const config = makeTestConfig({ remnawaveToken: makeToken({ uuid: 'ff5f', exp: inDays(30) }) })
    const app = await buildServer(config, { remnawave: makeStubRemnawave() })
    const cookie = await loginCookie(app)

    const res = await app.inject({ method: 'GET', url: '/api/panel/token', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual({
      expiresAt: expect.any(String),
      daysLeft: expect.any(Number),
      expired: false,
      expiringSoon: false,
    })
    expect(JSON.stringify(body)).not.toContain('ff5f')
    await app.close()
  })

  it('закрыт гардом, как и остальные /api/*', async () => {
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave() })
    const res = await app.inject({ method: 'GET', url: '/api/panel/token' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
