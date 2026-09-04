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
  return fieldOf(err, 'details')
}

/**
 * Подсказка «что делать», если бэкенд смог опознать ситуацию. Причина отвечает
 * на «что сломалось», подсказка — на «что чинить».
 */
export function hintOf(err: unknown): string | undefined {
  return fieldOf(err, 'hint')
}

function fieldOf(err: unknown, key: 'details' | 'hint'): string | undefined {
  if (!(err instanceof ApiError)) return undefined
  const value = (err.details as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

export class ConflictError extends ApiError {
  constructor(
    message: string,
    /** Текущая версия из панели: профиль либо шаблон — сужает вызывающая сторона */
    public current: unknown,
    /** Хэш текущей версии; только у шаблонов — у профилей роль базы играет updatedAt */
    public hash?: string,
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
      const current = (body as { current?: unknown } | undefined)?.current
      if (current) throw new ConflictError(message, current, (body as { hash?: string }).hash)
    }
    throw new ApiError(res.status, message, body)
  }

  return body as T
}
