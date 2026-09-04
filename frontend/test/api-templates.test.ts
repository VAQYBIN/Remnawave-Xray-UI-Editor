import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, ConflictError } from '../src/shared/api'

afterEach(() => vi.restoreAllMocks())

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )
}

describe('конфликт сохранения', () => {
  it('409 от шаблона несёт и текущую версию, и её хэш', async () => {
    mockFetch(409, {
      message: 'Шаблон был изменён в панели после открытия',
      current: { uuid: 'u-1', name: 'Default', templateType: 'XRAY_JSON', templateJson: {} },
      hash: 'a'.repeat(64),
    })
    await expect(apiFetch('/api/templates/u-1', { method: 'PATCH', body: '{}' })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ConflictError &&
        err.hash === 'a'.repeat(64) &&
        (err.current as { name: string }).name === 'Default',
    )
  })

  it('409 от профиля по-прежнему несёт профиль, а хэша у него нет', async () => {
    mockFetch(409, { message: 'конфликт', current: { uuid: 'p-1', name: 'Profile' } })
    await expect(apiFetch('/api/profiles/p-1', { method: 'PATCH', body: '{}' })).rejects.toSatisfy(
      (err: unknown) => err instanceof ConflictError && err.hash === undefined,
    )
  })
})
