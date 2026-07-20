import type { Profile } from './types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class AuthError extends ApiError {}

export class ConflictError extends ApiError {
  constructor(
    message: string,
    public current: Profile,
  ) {
    super(409, message)
    this.name = 'ConflictError'
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })
  } catch {
    throw new ApiError(0, 'Сервер недоступен')
  }

  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = undefined
  }

  if (!res.ok) {
    const message =
      (body as { message?: string } | undefined)?.message ?? `Ошибка сервера (${res.status})`
    if (res.status === 401) throw new AuthError(401, message)
    if (res.status === 409) {
      const current = (body as { current?: Profile } | undefined)?.current
      if (current) throw new ConflictError(message, current)
    }
    throw new ApiError(res.status, message, body)
  }

  return body as T
}
