import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, ConflictError, useCreateTemplate, useSaveTemplate } from '../src/shared/api'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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

/**
 * Обёртка через createElement, а не JSX: файл намеренно остаётся `.ts` —
 * переименование ради двух хуков утащило бы за собой историю правок конфликта
 * сохранения, которая живёт здесь с плана 1.
 */
function withClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

/** Тела запросов: что именно уходит в панель — единственное, что проверяется ниже */
function recordFetch(body: unknown) {
  // Параметры объявлены явно: без них у vi.fn пустой кортеж аргументов, и
  // fn.mock.calls[0][1] не типизируется — а именно тело запроса тут и нужно
  const fn = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

function bodyOf(fn: ReturnType<typeof recordFetch>): Record<string, unknown> {
  const init = fn.mock.calls[0]?.[1]
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
}

describe('хуки шаблонов', () => {
  it('сохранение YAML-типа шлёт encodedTemplateYaml и НЕ шлёт templateJson', async () => {
    const fn = recordFetch({ template: {}, hash: 'b'.repeat(64) })
    const { result } = renderHook(() => useSaveTemplate('u-1'), { wrapper: withClient() })
    result.current.mutate({ encodedTemplateYaml: 'YTog0LE=', expectedHash: 'a'.repeat(64) })
    await waitFor(() => expect(fn).toHaveBeenCalled())
    expect(bodyOf(fn).encodedTemplateYaml).toBe('YTog0LE=')
    // Бэкенд отвечает 400 на поле, не подходящее типу шаблона; отправив оба, мы
    // спрятали бы эту защиту от себя же
    expect('templateJson' in bodyOf(fn)).toBe(false)
    expect(bodyOf(fn).expectedHash).toBe('a'.repeat(64))
  })

  it('сохранение JSON-типа по-прежнему шлёт templateJson', async () => {
    const fn = recordFetch({ template: {}, hash: 'b'.repeat(64) })
    const { result } = renderHook(() => useSaveTemplate('u-1'), { wrapper: withClient() })
    result.current.mutate({ templateJson: { log: {} }, expectedHash: 'a'.repeat(64) })
    await waitFor(() => expect(fn).toHaveBeenCalled())
    expect(bodyOf(fn).templateJson).toEqual({ log: {} })
    expect('encodedTemplateYaml' in bodyOf(fn)).toBe(false)
  })

  // Тип панель менять не даёт, и каркас пустого шаблона зависит от него:
  // потеряться по дороге он не имеет права
  it('создание передаёт тип шаблона в панель', async () => {
    const fn = recordFetch({ template: { uuid: 'u-2' } })
    const { result } = renderHook(() => useCreateTemplate(), { wrapper: withClient() })
    result.current.mutate({ name: 'My Mihomo', templateType: 'MIHOMO' })
    await waitFor(() => expect(fn).toHaveBeenCalled())
    expect(bodyOf(fn)).toEqual({ name: 'My Mihomo', templateType: 'MIHOMO' })
  })
})
