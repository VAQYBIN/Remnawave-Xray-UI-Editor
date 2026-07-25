import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../src/config.js'

export const TEST_PASSWORD = 'test-password-123'

export function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    remnawaveUrl: 'http://panel.test',
    remnawaveToken: 'test-token',
    appPassword: TEST_PASSWORD,
    sessionSecret: '0123456789abcdef0123456789abcdef',
    dataDir: mkdtempSync(join(tmpdir(), 'xui-data-')),
    staticDir: join(process.cwd(), 'public'),
    sessionTtlSeconds: 3600,
    geoAllowPrivateUrls: false,
    xrayBin: 'xray',
    ...overrides,
  }
}

export async function loginCookie(
  app: FastifyInstance,
  password: string = TEST_PASSWORD,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password },
  })
  const setCookie = res.headers['set-cookie']
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie
  if (!header) throw new Error('Логин не вернул cookie')
  return header.split(';')[0]!
}
