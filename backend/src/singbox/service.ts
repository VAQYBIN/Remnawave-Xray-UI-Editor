import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess, type SpawnRunner } from '../proc/spawn.js'
import { withDummyOutbounds } from './dummyOutbounds.js'
import { parseSingboxOutput } from './parseOutput.js'

export interface SingboxTestResult {
  /** false — бинаря нет; UI показывает «инструмент недоступен», а не ошибку */
  available: boolean
  ok: boolean
  errors: string[]
}

const TIMEOUT_MS = 10_000

export class SingboxService {
  constructor(
    private bin: string,
    private dataDir: string,
    private run: SpawnRunner = runProcess,
  ) {}

  /**
   * На вход — ТЕКСТ черновика, а не модель: проверяется то, что видит
   * пользователь. `JSON.parse` здесь может бросить, и вызывающий роут обязан
   * превратить это в 400 по-русски.
   */
  async test(jsonText: string): Promise<SingboxTestResult> {
    const doc = withDummyOutbounds(JSON.parse(jsonText))

    const dir = join(this.dataDir, 'tmp')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `singbox-test-${randomUUID()}.json`)
    await writeFile(file, JSON.stringify(doc), 'utf8')

    try {
      const res = await this.run(this.bin, ['check', '-c', file], {
        env: process.env as Record<string, string>,
        timeoutMs: TIMEOUT_MS,
      })
      if (res.error?.code === 'ENOENT') return { available: false, ok: false, errors: [] }
      if (res.error) return { available: true, ok: false, errors: [res.error.message] }
      if (res.code === 0) return { available: true, ok: true, errors: [] }
      const errors = parseSingboxOutput(res.output)
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
