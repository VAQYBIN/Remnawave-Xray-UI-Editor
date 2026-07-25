import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withDummyClients } from './dummyClient.js'
import { parseXrayOutput, versionOf, type XrayTestError } from './parseOutput.js'

export interface XrayTestResult {
  /** false — бинаря нет; UI показывает «инструмент недоступен», а не ошибку */
  available: boolean
  ok: boolean
  version?: string
  errors: XrayTestError[]
  /** Теги inbound'ов, куда подставлен фиктивный пользователь */
  injected: string[]
}

export interface SpawnOutcome {
  code: number | null
  output: string
  error?: NodeJS.ErrnoException
}

export type SpawnRunner = (
  bin: string,
  args: string[],
  opts: { env: Record<string, string>; timeoutMs: number },
) => Promise<SpawnOutcome>

const TIMEOUT_MS = 10_000

/** Ядро пишет и в stdout, и в stderr — вердикт может оказаться в любом из них */
const runProcess: SpawnRunner = (bin, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, {
      env: opts.env,
      timeout: opts.timeoutMs,
      killSignal: 'SIGKILL',
    })
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.on('error', (error: NodeJS.ErrnoException) => resolve({ code: null, output, error }))
    child.on('close', (code) => resolve({ code, output }))
  })

export class XrayService {
  constructor(
    private bin: string,
    private dataDir: string,
    private run: SpawnRunner = runProcess,
  ) {}

  async test(config: unknown): Promise<XrayTestResult> {
    const { config: prepared, injected } = withDummyClients(config)
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

      if (res.error?.code === 'ENOENT') return { available: false, ok: false, errors: [], injected }
      if (res.error) {
        return { available: true, ok: false, errors: [{ message: res.error.message }], injected }
      }

      // Ни строчки в ответ — процесс убит по таймауту (spawn делает это молча)
      if (res.output.trim() === '') {
        return {
          available: true,
          ok: false,
          errors: [
            { message: 'Ядро не вернуло вывода — возможно, проверка не успела за 10 секунд.' },
          ],
          injected,
        }
      }

      const errors = parseXrayOutput(res.output, file)
      const ok = errors.length === 0 && /Configuration OK/i.test(res.output)
      return { available: true, ok, version: versionOf(res.output), errors, injected }
    } finally {
      await rm(file, { force: true })
    }
  }
}
