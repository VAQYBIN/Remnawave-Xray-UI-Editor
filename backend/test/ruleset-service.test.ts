import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIMITS, RuleSetService, type RuleSetDescriptor } from '../src/ruleset/service.js'

const DIR = join(import.meta.dirname, 'fixtures', 'ruleset')
const newDir = () => mkdtemp(join(tmpdir(), 'ruleset-svc-'))
const PUBLIC_LOOKUP = async () => [{ address: '93.184.216.34' }]

/** Сеть подменяется целиком: тесты в сеть не ходят */
function net(files: Record<string, Uint8Array | number>) {
  const asked: string[] = []
  return {
    asked,
    opts: {
      lookupImpl: PUBLIC_LOOKUP,
      fetchImpl: (async (url: string) => {
        asked.push(url)
        const hit = files[url]
        if (hit === undefined) return new Response('', { status: 404 })
        if (typeof hit === 'number') return new Response('', { status: hit })
        // Копия ради типа: Buffer из readFileSync — Uint8Array<ArrayBufferLike>,
        // а телу ответа нужен Uint8Array<ArrayBuffer>
        return new Response(new Uint8Array(hit), { status: 200 })
      }) as unknown as typeof fetch,
    },
  }
}

const http = (over: Partial<RuleSetDescriptor> = {}): RuleSetDescriptor => ({
  name: 'faceit',
  kind: 'http',
  url: 'https://example.com/faceit.mrs',
  behavior: 'domain',
  format: 'mrs',
  ...over,
})

const FACEIT = readFileSync(join(DIR, 'faceit.mrs'))
const PRIVATE_IPS = readFileSync(join(DIR, 'geoip-private.mrs'))

/** Собранный вручную `.mrs` с видом `classical`: такого файла в экосистеме нет */
function classicalMrs(): Buffer {
  const header = Buffer.alloc(21)
  header.write('MRS', 0, 'latin1')
  header[3] = 1
  header[4] = 2 // classical
  header.writeBigInt64BE(3n, 5)
  header.writeBigInt64BE(0n, 13)
  return zstdCompressSync(header)
}

const reasonOf = (a: unknown): string => (a as { reason: string }).reason

afterEach(() => {
  vi.useRealTimers()
})

describe('RuleSetService', () => {
  it('домен внутри набора — да, снаружи — нет', async () => {
    const { opts } = net({ 'https://example.com/faceit.mrs': FACEIT })
    const svc = new RuleSetService(await newDir(), opts)
    const hit = await svc.match({ address: 'www.faceit.com' }, [http()])
    expect(hit.faceit).toEqual({ state: 'yes', count: 2 })
    const miss = await svc.match({ address: 'example.org' }, [http()])
    expect(miss.faceit).toEqual({ state: 'no', count: 2 })
  })

  it('подсети отвечают по IP цели, а без IP — не совпадение', async () => {
    const { opts } = net({ 'https://example.com/p.mrs': PRIVATE_IPS })
    const svc = new RuleSetService(await newDir(), opts)
    const d = http({ name: 'p', url: 'https://example.com/p.mrs', behavior: 'ipcidr' })
    expect((await svc.match({ address: 'x', ip: '10.0.0.1' }, [d])).p).toMatchObject({
      state: 'yes',
    })
    expect((await svc.match({ address: 'x', ip: '8.8.8.8' }, [d])).p).toMatchObject({ state: 'no' })
    expect((await svc.match({ address: 'x' }, [d])).p).toMatchObject({ state: 'no' })
  })

  it('classical отдаёт строки, а не вердикт', async () => {
    const yaml = Buffer.from('payload:\n  - PROCESS-NAME,uTorrent.exe\n')
    const { opts } = net({ 'https://example.com/c.yaml': yaml })
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'x' }, [
      http({ name: 'c', url: 'https://example.com/c.yaml', behavior: 'classical', format: 'yaml' }),
    ])
    expect(answer.c).toEqual({ state: 'lines', lines: ['PROCESS-NAME,uTorrent.exe'], count: 1 })
  })

  it('inline не ходит в сеть вовсе', async () => {
    const { opts, asked } = net({})
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'a.example.com' }, [
      { name: 'i', kind: 'inline', payload: ['+.example.com'], behavior: 'domain', format: 'yaml' },
    ])
    expect(answer.i).toMatchObject({ state: 'yes' })
    expect(asked).toEqual([])
  })

  it('inline перечитывает payload, а не помнит прошлый под тем же именем', async () => {
    const { opts } = net({})
    const svc = new RuleSetService(await newDir(), opts)
    const first: RuleSetDescriptor = {
      name: 'i',
      kind: 'inline',
      payload: ['+.example.com'],
      behavior: 'domain',
      format: 'yaml',
    }
    expect((await svc.match({ address: 'a.example.com' }, [first])).i).toMatchObject({
      state: 'yes',
    })
    // Документ поправили: имя то же, содержимое другое
    const second = { ...first, payload: ['+.other.com'] }
    expect((await svc.match({ address: 'a.example.com' }, [second])).i).toMatchObject({
      state: 'no',
    })
  })

  it('текстовый набор доменов различает +. , *. , ведущую точку и точное имя', async () => {
    const { opts } = net({})
    const svc = new RuleSetService(await newDir(), opts)
    const set = (payload: string[]): RuleSetDescriptor => ({
      name: 'i',
      kind: 'inline',
      payload,
      behavior: 'domain',
      format: 'yaml',
    })
    const ask = async (payload: string[], address: string) =>
      (await svc.match({ address }, [set(payload)])).i

    expect(await ask(['+.example.com'], 'example.com')).toMatchObject({ state: 'yes' })
    expect(await ask(['+.example.com'], 'a.b.example.com')).toMatchObject({ state: 'yes' })
    expect(await ask(['*.example.com'], 'a.example.com')).toMatchObject({ state: 'yes' })
    expect(await ask(['*.example.com'], 'a.b.example.com')).toMatchObject({ state: 'no' })
    expect(await ask(['*.example.com'], 'example.com')).toMatchObject({ state: 'no' })
    expect(await ask(['.example.com'], 'a.example.com')).toMatchObject({ state: 'yes' })
    expect(await ask(['.example.com'], 'example.com')).toMatchObject({ state: 'no' })
    expect(await ask(['example.com'], 'EXAMPLE.COM')).toMatchObject({ state: 'yes' })
    expect(await ask(['example.com'], 'a.example.com')).toMatchObject({ state: 'no' })
    expect(await ask(['example.com'], 'notexample.com')).toMatchObject({ state: 'no' })
  })

  it('текстовый набор подсетей считает по CIDR и пропускает неразбираемые строки', async () => {
    const { opts } = net({})
    const svc = new RuleSetService(await newDir(), opts)
    const d: RuleSetDescriptor = {
      name: 'i',
      kind: 'inline',
      payload: ['не адрес', '10.0.0.0/8', '2001:db8::/32', '1.2.3.4/64'],
      behavior: 'ipcidr',
      format: 'yaml',
    }
    expect((await svc.match({ address: 'x', ip: '10.1.2.3' }, [d])).i).toMatchObject({
      state: 'yes',
    })
    expect((await svc.match({ address: 'x', ip: '2001:db8::1' }, [d])).i).toMatchObject({
      state: 'yes',
    })
    expect((await svc.match({ address: 'x', ip: '11.0.0.1' }, [d])).i).toMatchObject({ state: 'no' })
    // Строка с невозможной длиной префикса выброшена, а не растянута на весь мир
    expect((await svc.match({ address: 'x', ip: '1.2.3.4' }, [d])).i).toMatchObject({ state: 'no' })
  })

  it('подсеть без длины префикса — ровно один адрес', async () => {
    const { opts } = net({})
    const svc = new RuleSetService(await newDir(), opts)
    const d: RuleSetDescriptor = {
      name: 'i',
      kind: 'inline',
      payload: ['1.2.3.4'],
      behavior: 'ipcidr',
      format: 'yaml',
    }
    expect((await svc.match({ address: 'x', ip: '1.2.3.4' }, [d])).i).toMatchObject({
      state: 'yes',
    })
    expect((await svc.match({ address: 'x', ip: '1.2.3.5' }, [d])).i).toMatchObject({ state: 'no' })
  })

  it('404 даёт unavailable с кодом, а не «не совпало»', async () => {
    const { opts } = net({})
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'x' }, [http()])
    expect(answer.faceit).toMatchObject({ state: 'unavailable' })
    expect(reasonOf(answer.faceit)).toMatch(/404/)
  })

  it('битый файл даёт unavailable, а не исключение', async () => {
    const { opts } = net({ 'https://example.com/faceit.mrs': Buffer.from('мусор') })
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'x' }, [http()])
    expect(answer.faceit).toMatchObject({ state: 'unavailable' })
    expect(reasonOf(answer.faceit)).toMatch(/не распаковывается/)
  })

  it('вид из документа сверяется с видом из файла', async () => {
    const { opts } = net({ 'https://example.com/faceit.mrs': PRIVATE_IPS })
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'x', ip: '10.0.0.1' }, [http()])
    expect(answer.faceit).toMatchObject({ state: 'unavailable' })
    expect(reasonOf(answer.faceit)).toMatch(/«domain».+«ipcidr»/)
  })

  it('вид classical в формате mrs не считается', async () => {
    const { opts } = net({ 'https://example.com/faceit.mrs': classicalMrs() })
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'x' }, [http({ behavior: 'classical' })])
    expect(answer.faceit).toMatchObject({ state: 'unavailable' })
    expect(reasonOf(answer.faceit)).toMatch(/classical в формате mrs/)
  })

  it('mrs встроенным в документ не бывает', async () => {
    const { opts } = net({})
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'x' }, [
      { name: 'i', kind: 'inline', payload: [], behavior: 'domain', format: 'mrs' },
    ])
    expect(answer.i).toMatchObject({ state: 'unavailable' })
    expect(reasonOf(answer.i)).toMatch(/mrs не бывает встроенным/)
  })

  it('набор без ссылки — причина про ссылку, а не про сеть', async () => {
    const { opts, asked } = net({})
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'x' }, [http({ url: undefined })])
    expect(answer.faceit).toMatchObject({ state: 'unavailable' })
    expect(reasonOf(answer.faceit)).toMatch(/не указана ссылка/)
    expect(asked).toEqual([])
  })

  it('слишком длинный classical не отдаётся целиком', async () => {
    const lines = Array.from({ length: LIMITS.classicalLines + 1 }, (_, i) => `- DOMAIN,a${i}.com`)
    const yaml = Buffer.from(`payload:\n${lines.join('\n')}\n`)
    const { opts } = net({ 'https://example.com/c.yaml': yaml })
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'x' }, [
      http({ name: 'c', url: 'https://example.com/c.yaml', behavior: 'classical', format: 'yaml' }),
    ])
    expect(answer.c).toMatchObject({ state: 'unavailable' })
    expect(reasonOf(answer.c)).toMatch(String(LIMITS.classicalLines))
  })

  it('ровно предельное число строк classical ещё принимается', async () => {
    // Границу пиннем с обеих сторон: с одним только «на одну больше» сдвиг
    // сравнения с `>` на `>=` оставался бы зелёным
    const lines = Array.from({ length: LIMITS.classicalLines }, (_, i) => `- DOMAIN,a${i}.com`)
    const yaml = Buffer.from(`payload:\n${lines.join('\n')}\n`)
    const { opts } = net({ 'https://example.com/c.yaml': yaml })
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'x' }, [
      http({ name: 'c', url: 'https://example.com/c.yaml', behavior: 'classical', format: 'yaml' }),
    ])
    expect(answer.c).toMatchObject({ state: 'lines', count: LIMITS.classicalLines })
  })

  it('не наш отказ наружу не пересказывается', async () => {
    // Каталог кэша не создаётся: путь упирается в обычный файл. Отказ файловой
    // системы — наша ошибка, а не состояние набора
    const file = join(await newDir(), 'not-a-dir')
    writeFileSync(file, 'x')
    const { opts } = net({ 'https://example.com/faceit.mrs': FACEIT })
    const svc = new RuleSetService(file, opts)
    const answer = await svc.match({ address: 'x' }, [http()])
    expect(answer.faceit).toMatchObject({ state: 'unavailable' })
    expect(reasonOf(answer.faceit)).toBe('не удалось прочитать набор')
  })

  it('один упавший набор не отменяет ответы по остальным', async () => {
    // Сосед обязан быть ЕЩЁ В ПОЛЁТЕ в момент отказа. Со встроенным набором
    // тест был зелёным и на дефектном коде: у inline нет ни одного настоящего
    // await, и ответ по нему успевал лечь в первом же микротаске
    // Отказ обязан быть ТОЧЕЧНЫМ: сломав кэш целиком, мы уронили бы и соседа,
    // и тест снова доказывал бы не то. Подкладываем каталог ровно на то имя,
    // под которым кэш сохранит первый набор, — запись файла туда не пройдёт
    const dir = await newDir()
    const boomUrl = 'https://example.com/faceit.mrs'
    await mkdir(join(dir, 'rulesets', createHash('sha256').update(boomUrl).digest('hex')), {
      recursive: true,
    })
    const svc = new RuleSetService(dir, {
      lookupImpl: PUBLIC_LOOKUP,
      fetchImpl: (async (url: string) => {
        if (url.endsWith('slow.mrs')) {
          await new Promise((resolve) => setTimeout(resolve, 30))
          return new Response(new Uint8Array(FACEIT), { status: 200 })
        }
        return new Response(new Uint8Array(FACEIT), { status: 200 })
      }) as unknown as typeof fetch,
    })
    const answer = await svc.match({ address: 'faceit.com' }, [
      http({ name: 'boom' }),
      http({ name: 'slow', url: 'https://example.com/slow.mrs' }),
    ])
    expect(answer.boom).toMatchObject({ state: 'unavailable' })
    expect(answer.slow).toMatchObject({ state: 'yes' })
  })

  it('одна ссылка в документе скачивается один раз', async () => {
    // Наборы документа грузятся разом, и одна ссылка встречается в нём не раз:
    // без дедупликации это кратный трафик и запись в один файл кэша из
    // нескольких мест сразу
    const { opts, asked } = net({ 'https://example.com/faceit.mrs': FACEIT })
    const svc = new RuleSetService(await newDir(), opts)
    await svc.match({ address: 'faceit.com' }, [
      http({ name: 'a' }),
      http({ name: 'b' }),
      http({ name: 'c' }),
    ])
    expect(asked).toHaveLength(1)
  })

  it('второй запрос берёт файл из кэша', async () => {
    const { opts, asked } = net({ 'https://example.com/faceit.mrs': FACEIT })
    const svc = new RuleSetService(await newDir(), opts)
    await svc.match({ address: 'faceit.com' }, [http()])
    await svc.match({ address: 'other.com' }, [http()])
    expect(asked).toHaveLength(1)
  })

  it('через час набор перечитывается, а до часа — нет', async () => {
    const { opts, asked } = net({ 'https://example.com/faceit.mrs': FACEIT })
    const svc = new RuleSetService(await newDir(), opts)
    const t0 = Date.now()
    vi.useFakeTimers({ toFake: ['Date'], now: t0 })

    await svc.match({ address: 'faceit.com' }, [http()])
    vi.setSystemTime(t0 + 59 * 60 * 1000)
    await svc.match({ address: 'faceit.com' }, [http()])
    expect(asked).toHaveLength(1)

    vi.setSystemTime(t0 + 61 * 60 * 1000)
    await svc.match({ address: 'faceit.com' }, [http()])
    expect(asked).toHaveLength(2)
  })

  it('interval длиннее часа удерживает набор, а короче часа — не учащает загрузку', async () => {
    const { opts, asked } = net({ 'https://example.com/faceit.mrs': FACEIT })
    const svc = new RuleSetService(await newDir(), opts)
    const t0 = Date.now()
    vi.useFakeTimers({ toFake: ['Date'], now: t0 })

    // Час — нижняя граница: секунда из документа её не опускает
    await svc.match({ address: 'faceit.com' }, [http({ intervalSec: 1 })])
    vi.setSystemTime(t0 + 30 * 60 * 1000)
    await svc.match({ address: 'faceit.com' }, [http({ intervalSec: 1 })])
    expect(asked).toHaveLength(1)

    // А длинный interval из документа соблюдается как есть
    const long = http({ name: 'long', url: 'https://example.com/faceit.mrs', intervalSec: 24 * 3600 })
    vi.setSystemTime(t0 + 5 * 3600 * 1000)
    await svc.match({ address: 'faceit.com' }, [long])
    expect(asked).toHaveLength(1)
  })

  it('наборы сверх предела отвечают unavailable, но остальные считаются', async () => {
    const { opts } = net({ 'https://example.com/faceit.mrs': FACEIT })
    const svc = new RuleSetService(await newDir(), opts)
    const many = Array.from({ length: 70 }, (_, i) => http({ name: `n${i}` }))
    const answer = await svc.match({ address: 'faceit.com' }, many)
    expect(answer.n0).toMatchObject({ state: 'yes' })
    expect(answer.n63).toMatchObject({ state: 'yes' })
    expect(answer.n64).toMatchObject({ state: 'unavailable' })
    expect(answer.n69).toMatchObject({ state: 'unavailable' })
    expect(reasonOf(answer.n69)).toMatch(/64/)
  })

  it('внутренний адрес отклоняется защитой от SSRF', async () => {
    const svc = new RuleSetService(await newDir(), {
      lookupImpl: async () => [{ address: '127.0.0.1' }],
      fetchImpl: (async () => new Response('', { status: 200 })) as unknown as typeof fetch,
    })
    const answer = await svc.match({ address: 'x' }, [http({ url: 'https://internal/a.mrs' })])
    expect(answer.faceit).toMatchObject({ state: 'unavailable' })
    expect(reasonOf(answer.faceit)).toMatch(/внутреннюю сеть/)
  })
})
