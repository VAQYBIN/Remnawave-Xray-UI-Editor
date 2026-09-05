import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'
import { withDummyProxies } from '../src/mihomo/dummyProxies.js'
import { MihomoService } from '../src/mihomo/service.js'
import type { SpawnRunner } from '../src/proc/spawn.js'

const TEMPLATE = `proxies: # LEAVE THIS LINE!

proxy-groups:
  - name: VPN
    type: select
    proxies: # LEAVE THIS LINE!

rules:
  - MATCH,VPN
`

describe('подстановка фиктивных прокси', () => {
  it('заполняет корневой список и группы с маркером', () => {
    const config = parse(withDummyProxies(TEMPLATE)) as {
      proxies: { name: string }[]
      'proxy-groups': { name: string; proxies: string[] }[]
    }
    expect(config.proxies.length).toBeGreaterThan(0)
    expect(config['proxy-groups'][0]!.proxies).toContain(config.proxies[0]!.name)
  })

  it('заполняет payload inline-провайдеров — пустой ядро не примет', () => {
    const text = 'proxy-providers:\n  ru:\n    type: inline\n    payload:\nrules:\n  - MATCH,DIRECT\n'
    const config = parse(withDummyProxies(text)) as {
      'proxy-providers': Record<string, { payload: unknown[] }>
    }
    expect(config['proxy-providers'].ru!.payload.length).toBeGreaterThan(0)
  })

  it('группу с include-proxies: false не трогает', () => {
    const text =
      'proxy-groups:\n  - name: a\n    remnawave:\n      include-proxies: false\n    proxies:\n      - DIRECT\nrules:\n  - MATCH,a\n'
    const config = parse(withDummyProxies(text)) as { 'proxy-groups': { proxies: string[] }[] }
    expect(config['proxy-groups'][0]!.proxies).toEqual(['DIRECT'])
  })

  it('ключи remnawave снимаются — ядро о них не знает', () => {
    const config = parse(withDummyProxies('remnawave:\n  includeHiddenHosts: false\nrules:\n  - MATCH,DIRECT\n')) as Record<string, unknown>
    expect(config.remnawave).toBeUndefined()
  })
})

describe('проверка ядром', () => {
  const run = (outcome: Awaited<ReturnType<SpawnRunner>>): SpawnRunner => vi.fn(async () => outcome)

  it('нет бинаря — инструмент недоступен, а не ошибка', async () => {
    const error = Object.assign(new Error('нет файла'), { code: 'ENOENT' })
    const service = new MihomoService('mihomo', '/tmp', run({ code: null, output: '', error }))
    const res = await service.test(TEMPLATE)
    expect(res).toEqual({ available: false, ok: false, errors: [] })
  })

  it('нулевой код возврата — конфиг принят', async () => {
    const service = new MihomoService('mihomo', '/tmp', run({ code: 0, output: 'test is successful' }))
    const res = await service.test(TEMPLATE)
    expect(res.ok).toBe(true)
    expect(res.available).toBe(true)
  })

  it('ненулевой код — строки вывода становятся ошибками', async () => {
    const service = new MihomoService(
      'mihomo', '/tmp',
      run({ code: 1, output: 'level=error msg="proxy 0: unsupport proxy type"\n' }),
    )
    const res = await service.test(TEMPLATE)
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toContain('unsupport proxy type')
  })

  it('ядро получает файл с подставленными прокси, а не исходный шаблон', async () => {
    const runner = vi.fn(async () => ({ code: 0, output: 'ok' }))
    const service = new MihomoService('mihomo', '/tmp', runner as unknown as SpawnRunner)
    await service.test(TEMPLATE)
    const args = (runner.mock.calls[0] as unknown as [string, string[], unknown])[1]
    expect(args).toContain('-t')
    expect(args).toContain('-f')
  })
})
