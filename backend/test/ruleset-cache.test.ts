import { mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RuleSetCache } from '../src/ruleset/cache.js'

const URL_A = 'https://example.com/a.mrs'
const newDir = () => mkdtemp(join(tmpdir(), 'ruleset-cache-'))

describe('кэш наборов', () => {
  it('записанное читается обратно', async () => {
    const cache = new RuleSetCache(await newDir(), { totalBytes: 1 << 20 })
    await cache.write(URL_A, new Uint8Array([1, 2, 3]))
    const hit = await cache.read(URL_A, 60_000)
    expect(hit && [...hit.bytes]).toEqual([1, 2, 3])
  })

  it('чужая ссылка не читает чужой файл', async () => {
    const cache = new RuleSetCache(await newDir(), { totalBytes: 1 << 20 })
    await cache.write(URL_A, new Uint8Array([1]))
    expect(await cache.read('https://example.com/b.mrs', 60_000)).toBeNull()
  })

  it('просроченное не отдаётся', async () => {
    const dir = await newDir()
    const cache = new RuleSetCache(dir, { totalBytes: 1 << 20 })
    await cache.write(URL_A, new Uint8Array([1]))
    const [name] = await readdir(dir)
    const old = new Date(Date.now() - 10 * 60_000)
    await utimes(join(dir, name!), old, old)
    expect(await cache.read(URL_A, 60_000)).toBeNull()
    // Но с большим TTL — отдаётся: дело в сроке, а не в порче файла
    expect(await cache.read(URL_A, 60 * 60_000)).not.toBeNull()
  })

  it('имя файла не содержит частей ссылки', async () => {
    const dir = await newDir()
    const cache = new RuleSetCache(dir, { totalBytes: 1 << 20 })
    await cache.write('https://example.com/../../etc/passwd', new Uint8Array([1]))
    const names = await readdir(dir)
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('переполнение вытесняет самое старое', async () => {
    const dir = await newDir()
    const cache = new RuleSetCache(dir, { totalBytes: 300 })
    await cache.write('https://example.com/1', new Uint8Array(200))
    const [first] = await readdir(dir)
    const old = new Date(Date.now() - 60_000)
    await utimes(join(dir, first!), old, old)
    await cache.write('https://example.com/2', new Uint8Array(200))
    const names = await readdir(dir)
    expect(names).toHaveLength(1)
    expect(names[0]).not.toBe(first)
  })

  it('мусор в каталоге не роняет чтение', async () => {
    const dir = await newDir()
    await writeFile(join(dir, 'не-хэш.txt'), 'мусор')
    const cache = new RuleSetCache(dir, { totalBytes: 1 << 20 })
    await expect(cache.read(URL_A, 60_000)).resolves.toBeNull()
  })
})
