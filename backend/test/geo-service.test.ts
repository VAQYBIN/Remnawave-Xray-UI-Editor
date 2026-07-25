import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { GeoService, DEFAULT_GEOSITE_URL } from '../src/geo/service.js'
import { encodeGeoIpList, encodeGeoSiteList } from '../src/geo/dat.js'

let dataDir: string

async function writeGeosite() {
  await mkdir(join(dataDir, 'geodata'), { recursive: true })
  await writeFile(
    join(dataDir, 'geodata', 'geosite.dat'),
    encodeGeoSiteList([
      { code: 'GOOGLE', domains: [{ type: 2, value: 'google.com', attributes: [] }] },
      { code: 'OPENAI', domains: [{ type: 2, value: 'openai.com', attributes: [] }] },
    ]),
  )
}

async function writeGeoip() {
  await mkdir(join(dataDir, 'geodata'), { recursive: true })
  await writeFile(
    join(dataDir, 'geodata', 'geoip.dat'),
    encodeGeoIpList([{ code: 'RU', cidrs: [{ ip: new Uint8Array([10, 0, 0, 0]), prefix: 8 }] }]),
  )
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'xui-geo-'))
})

describe('GeoService.status', () => {
  it('без файлов — present false и URL по умолчанию', async () => {
    const status = await new GeoService(dataDir).status()
    expect(status.geosite.present).toBe(false)
    expect(status.geosite.url).toBe(DEFAULT_GEOSITE_URL)
  })

  it('с файлом — размер, дата и число категорий', async () => {
    await writeGeosite()
    const status = await new GeoService(dataDir).status()
    expect(status.geosite.present).toBe(true)
    expect(status.geosite.categories).toBe(2)
    expect(status.geosite.sizeBytes).toBeGreaterThan(0)
    expect(status.geosite.loadedAt).toBeTruthy()
  })

  it('setUrls сохраняет ссылки и они видны после перезапуска сервиса', async () => {
    await new GeoService(dataDir).setUrls({ geositeUrl: 'https://example.test/dlc.dat' })
    const status = await new GeoService(dataDir).status()
    expect(status.geosite.url).toBe('https://example.test/dlc.dat')
  })

  it('нехттп-схема отвергается', async () => {
    await expect(
      new GeoService(dataDir).setUrls({ geositeUrl: 'file:///etc/passwd' }),
    ).rejects.toThrow(/http/i)
  })
})

describe('GeoService.match', () => {
  it('без файлов — loaded false, ответов нет', async () => {
    const res = await new GeoService(dataDir).match({
      domain: 'google.com',
      keys: ['geosite:google'],
    })
    expect(res.loaded).toBe(false)
    expect(res.answers).toEqual({})
  })

  it('домен в категории и не в категории', async () => {
    await writeGeosite()
    const res = await new GeoService(dataDir).match({
      domain: 'www.google.com',
      keys: ['geosite:google', 'geosite:openai'],
    })
    expect(res.loaded).toBe(true)
    expect(res.answers).toEqual({ 'geosite:google': true, 'geosite:openai': false })
    expect(res.missing).toEqual([])
  })

  it('регистр ключа не важен — код всё равно апперкейсится', async () => {
    await writeGeosite()
    const res = await new GeoService(dataDir).match({
      domain: 'google.com',
      keys: ['geosite:GOOGLE'],
    })
    expect(res.answers['geosite:GOOGLE']).toBe(true)
  })

  it('категории нет в базе — попадает в missing, а не в answers', async () => {
    await writeGeosite()
    const res = await new GeoService(dataDir).match({
      domain: 'google.com',
      keys: ['geosite:nosuch'],
    })
    expect(res.missing).toEqual(['geosite:nosuch'])
    expect(res.answers['geosite:nosuch']).toBeUndefined()
  })

  it('geoip отвечает по IP, негация инвертирует', async () => {
    await writeGeoip()
    const res = await new GeoService(dataDir).match({
      ip: '10.1.2.3',
      keys: ['geoip:ru', 'geoip:!ru'],
    })
    expect(res.answers).toEqual({ 'geoip:ru': true, 'geoip:!ru': false })
  })

  it('без IP на geoip-ключи не отвечаем вовсе', async () => {
    await writeGeoip()
    const res = await new GeoService(dataDir).match({ domain: 'google.com', keys: ['geoip:ru'] })
    expect(res.answers).toEqual({})
  })

  it('geosite-ключи отвечаются, даже если geoip-файла нет', async () => {
    await writeGeosite()
    const res = await new GeoService(dataDir).match({
      domain: 'google.com',
      ip: '10.1.2.3',
      keys: ['geosite:google', 'geoip:ru'],
    })
    expect(res.loaded).toBe(true)
    expect(res.answers['geosite:google']).toBe(true)
    expect(res.answers['geoip:ru']).toBeUndefined()
  })

  it('нераспознанные ключи (ext:) игнорируются', async () => {
    await writeGeosite()
    const res = await new GeoService(dataDir).match({
      domain: 'google.com',
      keys: ['ext:f.dat:x'],
    })
    expect(res.answers).toEqual({})
    expect(res.missing).toEqual([])
  })
})
