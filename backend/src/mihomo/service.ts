import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess, type SpawnRunner } from '../proc/spawn.js'
import { withDummyProxies } from './dummyProxies.js'
import { parseMihomoOutput } from './parseOutput.js'

export interface MihomoTestResult {
  /** false — бинаря нет; UI показывает «инструмент недоступен», а не ошибку */
  available: boolean
  ok: boolean
  errors: string[]
}

const TIMEOUT_MS = 10_000

export class MihomoService {
  constructor(
    private bin: string,
    private dataDir: string,
    private run: SpawnRunner = runProcess,
  ) {}

  async test(yamlText: string): Promise<MihomoTestResult> {
    const dir = join(this.dataDir, 'tmp')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `mihomo-test-${randomUUID()}.yaml`)
    await writeFile(file, withDummyProxies(yamlText), 'utf8')

    try {
      const res = await this.run(this.bin, ['-t', '-f', file], {
        env: process.env as Record<string, string>,
        timeoutMs: TIMEOUT_MS,
      })
      if (res.error?.code === 'ENOENT') return { available: false, ok: false, errors: [] }
      if (res.error) return { available: true, ok: false, errors: [res.error.message] }
      if (res.code === 0) return { available: true, ok: true, errors: [] }
      const errors = parseMihomoOutput(res.output)
      return {
        available: true,
        ok: false,
        errors: errors.length > 0 ? errors : ['Ядро отклонило шаблон без объяснения'],
      }
    } finally {
      await rm(file, { force: true })
    }
  }
}
