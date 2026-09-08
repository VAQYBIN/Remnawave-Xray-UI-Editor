import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { withDummyOutbounds } from '../src/singbox/dummyOutbounds.js'
import { SingboxService } from '../src/singbox/service.js'
import type { SpawnRunner } from '../src/proc/spawn.js'
import { buildServer } from '../src/server.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeStubRemnawave } from './stub-remnawave.js'

type Doc = {
  outbounds: { type: string; tag: string; outbounds?: string[]; remnawave?: unknown }[]
}

function fixture(name: 'default' | 'bundle' | 'legacy'): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/singbox/${name}.json`, import.meta.url), 'utf8'),
  )
}

describe('достройка sing-box перед проверкой ядром', () => {
  it('дописывает серверы в конец и заполняет ими группы', () => {
    const doc = withDummyOutbounds(fixture('default')) as Doc
    const selector = doc.outbounds.find((o) => o.type === 'selector')!
    const dummies = doc.outbounds.filter((o) => o.type === 'shadowsocks').map((o) => o.tag)
    expect(dummies.length).toBeGreaterThan(0)
    // Порядок значим: панель дописывает серверы В КОНЕЦ, и от позиции зависит,
    // какой выход станет дефолтным при пустом route.final
    expect(doc.outbounds.at(-1)!.tag).toBe(dummies.at(-1))
    expect(selector.outbounds).toEqual(expect.arrayContaining(dummies))
  })

  it('селектор получает и теги urltest-групп, а urltest — только прокси', () => {
    const doc = withDummyOutbounds(fixture('bundle')) as Doc
    const selector = doc.outbounds.find((o) => o.type === 'selector')!
    const urltest = doc.outbounds.find((o) => o.type === 'urltest')!
    expect(selector.outbounds).toContain(urltest.tag)
    expect(urltest.outbounds).not.toContain(urltest.tag)
  })

  it('группу с includeProxies: false не трогает', () => {
    const doc = withDummyOutbounds({
      outbounds: [
        { type: 'direct', tag: 'direct' },
        {
          type: 'selector',
          tag: 'fixed',
          outbounds: ['direct'],
          remnawave: { includeProxies: false },
        },
      ],
    }) as Doc
    const fixed = doc.outbounds.find((o) => o.tag === 'fixed')!
    expect(fixed.outbounds).toEqual(['direct'])
  })

  it('вырезает ключ remnawave: ядро строго к незнакомым полям', () => {
    const doc = withDummyOutbounds({
      outbounds: [
        { type: 'selector', tag: 'g', outbounds: [], remnawave: { includeProxies: false } },
      ],
    }) as Doc
    expect(doc.outbounds[0]!.remnawave).toBeUndefined()
    expect(JSON.stringify(doc)).not.toContain('remnawave')
  })

  it('вход не мутируется', () => {
    const input = { outbounds: [{ type: 'selector', tag: 'g', outbounds: null }] }
    const before = JSON.stringify(input)
    withDummyOutbounds(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('документ без outbounds не роняет достройку', () => {
    const doc = withDummyOutbounds({ route: { rules: [] } }) as Doc
    expect(Array.isArray(doc.outbounds)).toBe(true)
  })
})

const TEMPLATE = JSON.stringify({
  outbounds: [{ type: 'selector', tag: 'g', outbounds: null }],
  route: { rules: [], final: 'g' },
})

describe('проверка шаблона sing-box ядром', () => {
  it('нет бинаря — инструмент недоступен, а не ошибка', async () => {
    const run: SpawnRunner = async () => ({
      code: null,
      output: '',
      error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
    })
    const res = await new SingboxService('sing-box', tmpdir(), run).test(TEMPLATE)
    expect(res).toEqual({ available: false, ok: false, errors: [] })
  })

  it('код 0 — вердикт принят', async () => {
    const run: SpawnRunner = async () => ({ code: 0, output: '' })
    const res = await new SingboxService('sing-box', tmpdir(), run).test(TEMPLATE)
    expect(res.ok).toBe(true)
    expect(res.available).toBe(true)
  })

  it('ненулевой код отдаёт строки ядра, а не пустоту', async () => {
    const run: SpawnRunner = async () => ({
      code: 1,
      output: 'FATAL[0000] decode config at index 0: json: unknown field "oops"\n\n',
      })
    const res = await new SingboxService('sing-box', tmpdir(), run).test(TEMPLATE)
    expect(res.ok).toBe(false)
    expect(res.errors).toEqual(['FATAL[0000] decode config at index 0: json: unknown field "oops"'])
  })

  it('ядру уходит достроенный документ, и файл удаляется', async () => {
    let seen: unknown
    let path = ''
    const run: SpawnRunner = async (_bin, args) => {
      path = args.at(-1)!
      seen = JSON.parse(await readFile(path, 'utf8'))
      return { code: 0, output: '' }
    }
    await new SingboxService('sing-box', tmpdir(), run).test(TEMPLATE)
    const doc = seen as { outbounds: { tag: string; outbounds?: string[] }[] }
    // Пустая группа ядру не годится: панель заполнила бы её тегами серверов
    expect(doc.outbounds[0]!.outbounds!.length).toBeGreaterThan(0)
    await expect(readFile(path, 'utf8')).rejects.toThrow()
  })

  it('вердикт без объяснения всё равно объясняется по-русски', async () => {
    const run: SpawnRunner = async () => ({ code: 1, output: '   \n\n' })
    const res = await new SingboxService('sing-box', tmpdir(), run).test(TEMPLATE)
    expect(res.errors).toEqual(['Ядро отклонило шаблон без объяснения'])
  })
})

describe('роут проверки шаблона sing-box', () => {
  it('отдаёт вердикт сервиса', async () => {
    const singbox = {
      test: vi.fn(async () => ({ available: true, ok: true, errors: [] })),
    } as unknown as import('../src/singbox/service.js').SingboxService
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave(), singbox })
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/singbox-test',
      headers: { cookie },
      payload: { templateJson: { outbounds: [] } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ available: true, ok: true, errors: [] })
  })

  it('неразбираемое содержимое — 400 по-русски, а не 500 движка', async () => {
    const singbox = {
      test: vi.fn(async () => {
        throw new SyntaxError('Unexpected token')
      }),
    } as unknown as import('../src/singbox/service.js').SingboxService
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave(), singbox })
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/singbox-test',
      headers: { cookie },
      payload: { templateJson: 'не объект' },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { message: string }).message).toMatch(/разобрать/i)
  })

  it('требует вход', async () => {
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave() })
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/singbox-test',
      payload: { templateJson: {} },
    })
    expect(res.statusCode).toBe(401)
  })
})
