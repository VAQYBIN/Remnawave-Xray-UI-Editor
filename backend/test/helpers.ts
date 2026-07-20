import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    ...overrides,
  }
}
