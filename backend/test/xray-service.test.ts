import { existsSync, mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { XrayService, type SpawnRunner } from '../src/xray/service.js'

let dataDir: string
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'xui-xray-'))
})

const OK_OUTPUT = 'Xray 26.6.27 (Xray, Penetrates Everything.)\nConfiguration OK.\n'
const CONFIG = { inbounds: [{ tag: 'vless-in', protocol: 'vless', settings: { clients: [] } }] }

describe('XrayService.test', () => {
  it('бинаря нет — available: false, а не исключение', async () => {
    const runner: SpawnRunner = async () => ({
      code: null,
      output: '',
      error: Object.assign(new Error('spawn xray ENOENT'), { code: 'ENOENT' }),
    })
    const res = await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(res).toMatchObject({ available: false, ok: false })
    expect(res.errors).toEqual([])
  })

  it('Configuration OK — ok: true и версия', async () => {
    const runner: SpawnRunner = async () => ({ code: 0, output: OK_OUTPUT })
    const res = await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(res.ok).toBe(true)
    expect(res.version).toBe('26.6.27')
  })

  it('ошибка ядра доезжает с подсказкой', async () => {
    const runner: SpawnRunner = async () => ({
      code: 1,
      output:
        'Failed to start: main: failed to load config: [x] > app/router: unable to find outbound tag: proxy',
    })
    const res = await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(res.ok).toBe(false)
    expect(res.errors[0]!.hint).toMatch(/outbound/i)
  })

  it('в конфиг на диске попадает фиктивный клиент', async () => {
    let seen: unknown
    const runner: SpawnRunner = async (_bin, args) => {
      seen = JSON.parse(await readFile(args[args.length - 1]!, 'utf8'))
      return { code: 0, output: OK_OUTPUT }
    }
    const res = await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect((seen as any).inbounds[0].settings.clients).toHaveLength(1)
    expect(res.injected).toEqual([{ tag: 'vless-in', source: 'dummy' }])
  })

  it('временный файл удаляется после прогона', async () => {
    let path = ''
    const runner: SpawnRunner = async (_bin, args) => {
      path = args[args.length - 1]!
      return { code: 0, output: OK_OUTPUT }
    }
    await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(path).not.toBe('')
    expect(existsSync(path)).toBe(false)
  })

  it('ядру передаются geo-базы из DATA_DIR', async () => {
    let asset: string | undefined
    const runner: SpawnRunner = async (_bin, _args, opts) => {
      asset = opts.env.XRAY_LOCATION_ASSET
      return { code: 0, output: OK_OUTPUT }
    }
    await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(asset).toBe(join(dataDir, 'geodata'))
  })

  it('вывода нет вовсе — честная ошибка про таймаут', async () => {
    const runner: SpawnRunner = async () => ({ code: null, output: '' })
    const res = await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(res.available).toBe(true)
    expect(res.ok).toBe(false)
    expect(res.errors[0]!.message).toMatch(/10 секунд|вердикт/i)
  })

  it('предупреждения ядра доезжают вместе с успешным вердиктом', async () => {
    const runner: SpawnRunner = async () => ({
      code: 0,
      output:
        'Xray 26.6.27\n2026/07/25 15:39:15 [Warning] common/errors: The feature Trojan is deprecated.\nConfiguration OK.\n',
    })
    const res = await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(res.ok).toBe(true)
    expect(res.warnings).toEqual(['common/errors: The feature Trojan is deprecated.'])
  })

  it('аргументы — run -test -c <файл>', async () => {
    let args: string[] = []
    const runner: SpawnRunner = async (_bin, a) => {
      args = a
      return { code: 0, output: OK_OUTPUT }
    }
    await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(args.slice(0, 3)).toEqual(['run', '-test', '-c'])
  })
})
