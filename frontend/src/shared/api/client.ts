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

/**
 * Причина сбоя, которую бэкенд кладёт в `details` тела ответа. Само сообщение
 * («Панель Remnawave недоступна») называет симптом, но не говорит, что
 * проверять; причина отвечает на это — её и показываем рядом.
 */
export function causeOf(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined
  const cause = (err.details as { details?: unknown } | undefined)?.details
  return typeof cause === 'string' && cause.trim() !== '' ? cause : undefined
}

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
  // content-type только при наличии тела: fastify отвечает 400 на пустое JSON-тело
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  }
  if (init.body !== undefined && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json'
  }
  let res: Response
  try {
    res = await fetch(path, { ...init, credentials: 'include', headers })
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
