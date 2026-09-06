import { spawn } from 'node:child_process'

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

/** Ядро пишет и в stdout, и в stderr — вердикт может оказаться в любом из них */
export const runProcess: SpawnRunner = (bin, args, opts) =>
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
