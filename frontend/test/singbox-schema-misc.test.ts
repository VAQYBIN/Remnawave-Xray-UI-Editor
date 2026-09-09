import { describe, expect, it } from 'vitest'
import { CERTIFICATE_FIELDS, EXPERIMENTAL_FIELDS, LOG_FIELDS, NTP_FIELDS } from '../src/entities/singbox/schema/misc'

describe('схема log/ntp/certificate/experimental', () => {
  it('log: уровень перечислением', () => {
    expect(LOG_FIELDS.map((f) => f.key)).toEqual(['disabled', 'level', 'output', 'timestamp'])
    expect(LOG_FIELDS.find((f) => f.key === 'level')?.enum?.map((e) => e.value)).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic'])
  })

  it('ntp: сервер, порт, интервал и dial-поля', () => {
    expect(NTP_FIELDS.map((f) => f.key)).toEqual(expect.arrayContaining(['enabled', 'server', 'server_port', 'interval', 'detour']))
  })

  it('certificate: хранилище и списки', () => {
    expect(CERTIFICATE_FIELDS.map((f) => f.key)).toEqual(['store', 'certificate', 'certificate_path', 'certificate_directory_path'])
  })

  it('experimental: cache_file, clash_api и v2ray_api с листьями; store_rdrc устарел', () => {
    const cache = EXPERIMENTAL_FIELDS.find((f) => f.key === 'cache_file')!
    expect(cache.fields?.map((f) => f.key)).toEqual(expect.arrayContaining(['enabled', 'path', 'cache_id', 'store_fakeip', 'store_rdrc', 'rdrc_timeout', 'store_dns']))
    expect(cache.fields?.find((f) => f.key === 'store_rdrc')?.deprecated?.since).toBe('1.14.0')
    const clash = EXPERIMENTAL_FIELDS.find((f) => f.key === 'clash_api')!
    expect(clash.fields?.map((f) => f.key)).toEqual(expect.arrayContaining(['external_controller', 'external_ui', 'external_ui_download_url', 'external_ui_download_detour', 'secret', 'default_mode', 'access_control_allow_origin', 'access_control_allow_private_network']))
    expect(clash.fields?.find((f) => f.key === 'external_ui_download_detour')?.ref).toBe('outbound')
    const v2 = EXPERIMENTAL_FIELDS.find((f) => f.key === 'v2ray_api')!
    expect(v2.fields?.find((f) => f.key === 'stats')?.fields?.map((f) => f.key)).toEqual(['enabled', 'inbounds', 'outbounds', 'users'])
  })
})
