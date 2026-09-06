import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess, type SpawnRunner } from '../proc/spawn.js'
import { withPanelClients, type Injected } from './panelClients.js'
import {
  parseXrayOutput,
  parseXrayWarnings,
  versionOf,
  type XrayTestError,
} from './parseOutput.js'

export type { SpawnRunner, SpawnOutcome } from '../proc/spawn.js'

export interface XrayTestResult {
  /** false — бинаря нет; UI показывает «инструмент недоступен», а не ошибку */
  available: boolean
  ok: boolean
  version?: string
  errors: XrayTestError[]
  /** Предупреждения ядра: приходят и при успешной проверке */
  warnings: string[]
  /** Теги inbound'ов, куда подставлен пользователь, и откуда он взят */
  injected: Injected[]
}

const TIMEOUT_MS = 10_000

export class XrayService {
  constructor(
    private bin: string,
    private dataDir: string,
    private run: SpawnRunner = runProcess,
  ) {}

  async test(config: unknown, computed?: unknown): Promise<XrayTestResult> {
    const { config: prepared, injected } = withPanelClients(config, computed)
    const dir = join(this.dataDir, 'tmp')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `xray-test-${randomUUID()}.json`)
    await writeFile(file, JSON.stringify(prepared), 'utf8')

    try {
      const res = await this.run(this.bin, ['run', '-test', '-c', file], {
        // Правила с geosite:/geoip: ядро собирает, читая списки с диска: даём ему
        // те же файлы, что качает диалог «Geo-базы»
        env: { ...process.env, XRAY_LOCATION_ASSET: join(this.dataDir, 'geodata') } as Record<
          string,
          string
        >,
        timeoutMs: TIMEOUT_MS,
      })

      if (res.error?.code === 'ENOENT') {
        return { available: false, ok: false, errors: [], warnings: [], injected }
      }
      if (res.error) {
        return {
          available: true,
          ok: false,
          errors: [{ message: res.error.message }],
          warnings: [],
          injected,
        }
      }

      // Ни строчки в ответ — процесс убит по таймауту (spawn делает это молча)
      if (res.output.trim() === '') {
        return {
          available: true,
          ok: false,
          errors: [
            { message: 'Ядро не вернуло вывода — возможно, проверка не успела за 10 секунд.' },
          ],
          warnings: [],
          injected,
        }
      }

      const errors = parseXrayOutput(res.output, file)
      const ok = errors.length === 0 && /Configuration OK/i.test(res.output)
      return {
        available: true,
        ok,
        version: versionOf(res.output),
        errors,
        warnings: parseXrayWarnings(res.output),
        injected,
      }
    } finally {
      await rm(file, { force: true })
    }
  }
}
